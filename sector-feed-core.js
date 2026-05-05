"use strict";

const { loadBweRssPayload } = require("./bwe-rss-core");
const { loadBlockBeatsPayload } = require("./blockbeats-core");
const { loadListingFeedPayload } = require("./listing-feed-core");
const { loadBinanceProxyPayload } = require("./binance-proxy-core");

const BINANCE_FUTURES_TICKER_24H = "https://fapi.binance.com/fapi/v1/ticker/24hr";
const BINANCE_SOCIAL_HYPE_URL =
  "https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/social/hype/rank/leaderboard/ai";
const BINANCE_UNIFIED_RANK_URL =
  "https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/unified/rank/list/ai";
const BINANCE_TOPIC_RUSH_URL =
  "https://web3.binance.com/bapi/defi/v2/public/wallet-direct/buw/wallet/market/token/social-rush/rank/list/ai";
const X_COUNTS_URL = "https://api.twitter.com/2/tweets/counts/recent";
const SOCIAL_TIMEOUT_MS = 6500;
const MAX_X_CANDIDATES = 18;
const MAX_OUTPUT_ITEMS = 18;
const SYMBOL_DENY_LIST = new Set([
  "AI",
  "API",
  "ATH",
  "CEO",
  "CEX",
  "CPI",
  "ETF",
  "GDP",
  "IPO",
  "JOLTS",
  "NFT",
  "PMI",
  "SEC",
  "USD",
  "USDT",
  "USDC",
  "VIP",
  "AMD",
  "BILL",
  "BOE",
  "CME",
  "FOMC",
  "NASDAQ",
  "NYSE",
  "QCOM",
  "UPBIT",
  "XAG",
  "XAU",
  "XPD",
  "XPT"
]);

async function loadSectorFeedPayload() {
  const [squareResult, marketResult, newsResult] = await Promise.allSettled([
    loadBinanceSquareSignals(),
    loadMarketCandidates(),
    loadNewsMentionSignals()
  ]);

  const squareItems = squareResult.status === "fulfilled" ? squareResult.value : [];
  const marketItems = marketResult.status === "fulfilled" ? marketResult.value : [];
  const newsItems = newsResult.status === "fulfilled" ? newsResult.value : [];
  const marketSymbols = new Set(marketItems.map((item) => item.symbol).filter(Boolean));
  const filteredNewsItems = marketSymbols.size
    ? newsItems.filter((item) => marketSymbols.has(item.symbol))
    : newsItems;
  const candidates = mergeSocialCandidates(squareItems, filteredNewsItems, marketItems);
  const xCounts = await loadXMentionCounts(candidates.slice(0, MAX_X_CANDIDATES).map((item) => item.symbol));
  const items = rankSocialItems(candidates, xCounts).slice(0, MAX_OUTPUT_ITEMS);
  const hasXToken = Boolean(getXBearerToken());

  return {
    source: hasXToken ? "binance-square+x+news" : "binance-square+news",
    sourceStatus: {
      BinanceSquare: squareItems.length ? "ok" : "failed",
      X: hasXToken ? (Object.keys(xCounts).length ? "ok" : "failed") : "disabled",
      NewsMentions: newsItems.length ? "ok" : "failed"
    },
    updatedAt: Date.now(),
    items
  };
}

async function loadBinanceSquareSignals() {
  const results = await Promise.allSettled([
    fetchSocialHypeRank("56"),
    fetchSocialHypeRank("CT_501"),
    fetchUnifiedRank({ rankType: 10, chainId: "56", period: 50, sortBy: 70, orderAsc: false, page: 1, size: 40 }),
    fetchUnifiedRank({ rankType: 10, chainId: "CT_501", period: 50, sortBy: 70, orderAsc: false, page: 1, size: 40 }),
    fetchTopicRushRank({ pageIndex: 1, pageSize: 40, timeRange: "1D" })
  ]);

  return results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((item) => item.symbol);
}

async function fetchSocialHypeRank(chainId) {
  const url = `${BINANCE_SOCIAL_HYPE_URL}?chainId=${encodeURIComponent(
    chainId
  )}&sentiment=All&socialLanguage=ALL&targetLanguage=en&timeRange=1`;
  const payload = await fetchJsonWithTimeout(url, {
    headers: getBinanceHeaders()
  });
  const rows = payload?.data?.leaderBoardList || [];
  const total = Math.max(rows.length, 1);
  return rows.map((item, index) => ({
    symbol: normalizeSymbol(item.symbol || item.tokenSymbol || item.baseAsset),
    squareScore: (total - index) / total,
    squareRank: index + 1,
    tags: ["广场社媒"],
    sourceTag: "Square"
  }));
}

async function fetchUnifiedRank(body) {
  const payload = await fetchJsonWithTimeout(BINANCE_UNIFIED_RANK_URL, {
    method: "POST",
    headers: getBinanceHeaders(),
    body: JSON.stringify(body)
  });
  const rows = payload?.data?.tokens || [];
  const total = Math.max(rows.length, 1);
  return rows.map((item, index) => ({
    symbol: normalizeSymbol(item.symbol || item.tokenSymbol || item.baseAsset),
    squareScore: (total - index) / total,
    squareRank: index + 1,
    priceChange24h: toNumber(item.percentChange24h),
    volume24h: toNumber(item.volume24h || item.volume1h),
    tags: ["广场趋势"],
    sourceTag: "Square"
  }));
}

async function fetchTopicRushRank(body) {
  const payload = await fetchJsonWithTimeout(BINANCE_TOPIC_RUSH_URL, {
    method: "POST",
    headers: getBinanceHeaders(),
    body: JSON.stringify(body)
  });
  const rows = payload?.data?.list || payload?.data?.tokens || payload?.data || [];
  const list = Array.isArray(rows) ? rows : [];
  const total = Math.max(list.length, 1);
  return list.map((item, index) => ({
    symbol: normalizeSymbol(item.symbol || item.tokenSymbol || item.baseAsset || item.coin),
    squareScore: (total - index) / total,
    squareRank: index + 1,
    tags: ["叙事热度"],
    sourceTag: "Square"
  }));
}

async function loadMarketCandidates() {
  let rows = [];
  try {
    rows = await loadBinanceProxyPayload("/fapi/v1/ticker/24hr");
  } catch (error) {
    rows = await fetchJsonWithTimeout(BINANCE_FUTURES_TICKER_24H, {
      headers: {
        Accept: "application/json",
        "User-Agent": "sanmu-trading-panel/1.0"
      }
    });
  }

  return (Array.isArray(rows) ? rows : [])
    .filter((item) => String(item.symbol || "").endsWith("USDT"))
    .sort((a, b) => toNumber(b.quoteVolume) - toNumber(a.quoteVolume))
    .slice(0, 80)
    .map((item, index) => ({
      symbol: normalizeSymbol(String(item.symbol || "").replace(/USDT$/, "")),
      marketScore: Math.max(0, 1 - index / 80),
      priceChange24h: toNumber(item.priceChangePercent),
      volume24h: toNumber(item.quoteVolume),
      tags: ["合约高成交"],
      sourceTag: "Market"
    }));
}

async function loadNewsMentionSignals() {
  const payloads = await Promise.allSettled([
    loadBweRssPayload(),
    loadBlockBeatsPayload(),
    loadListingFeedPayload()
  ]);
  const mentionMap = new Map();

  for (const result of payloads) {
    if (result.status !== "fulfilled") {
      continue;
    }
    const items = Array.isArray(result.value?.items) ? result.value.items : [];
    for (const item of items.slice(0, 60)) {
      const text = [
        item.title,
        item.primary,
        item.secondary,
        item.summary,
        item.description,
        ...(Array.isArray(item.metaLines) ? item.metaLines : [])
      ]
        .filter(Boolean)
        .join(" ");
      for (const symbol of extractSymbolsFromText(text)) {
        const current = mentionMap.get(symbol) || {
          symbol,
          mentionCount: 0,
          tags: new Set(),
          sourceTag: "News"
        };
        current.mentionCount += 1;
        current.tags.add("资讯提及");
        mentionMap.set(symbol, current);
      }
    }
  }

  const maxMentions = Math.max(...Array.from(mentionMap.values()).map((item) => item.mentionCount), 0);
  return Array.from(mentionMap.values()).map((item) => ({
    symbol: item.symbol,
    squareScore: maxMentions > 0 ? item.mentionCount / maxMentions : 0,
    newsMentions: item.mentionCount,
    tags: Array.from(item.tags),
    sourceTag: item.sourceTag
  }));
}

async function loadXMentionCounts(symbols) {
  const token = getXBearerToken();
  if (!token) {
    return {};
  }

  const uniqueSymbols = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
  const results = await mapWithConcurrency(uniqueSymbols, 3, async (symbol) => {
    try {
      const query = encodeURIComponent(`($${symbol} OR ${symbol}) lang:en -is:retweet`);
      const payload = await fetchJsonWithTimeout(`${X_COUNTS_URL}?query=${query}&granularity=day`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "sanmu-trading-panel/1.0"
        }
      });
      const count = (payload?.data || []).reduce((sum, item) => sum + toNumber(item.tweet_count), 0);
      return [symbol, count];
    } catch (error) {
      return [symbol, 0];
    }
  });

  return Object.fromEntries(results.filter(([, count]) => count > 0));
}

function mergeSocialCandidates(...groups) {
  const merged = new Map();

  for (const item of groups.flat()) {
    const symbol = normalizeSymbol(item.symbol);
    if (!symbol || symbol.length > 15 || SYMBOL_DENY_LIST.has(symbol)) {
      continue;
    }

    const existing = merged.get(symbol) || {
      symbol,
      squareScore: 0,
      marketScore: 0,
      newsMentions: 0,
      priceChange24h: 0,
      volume24h: 0,
      tags: [],
      sourceTag: ""
    };

    existing.squareScore = Math.max(existing.squareScore, toNumber(item.squareScore));
    existing.marketScore = Math.max(existing.marketScore, toNumber(item.marketScore));
    existing.newsMentions += toNumber(item.newsMentions);
    existing.squareRank = Math.min(existing.squareRank || Infinity, item.squareRank || Infinity);
    existing.priceChange24h = Number.isFinite(toNumber(item.priceChange24h)) && item.priceChange24h !== undefined
      ? toNumber(item.priceChange24h)
      : existing.priceChange24h;
    existing.volume24h = Math.max(existing.volume24h, toNumber(item.volume24h));
    existing.tags = [...new Set([...existing.tags, ...(item.tags || [])])].slice(0, 4);
    existing.sourceTag = existing.sourceTag ? `${existing.sourceTag}+${item.sourceTag || ""}` : item.sourceTag || "";
    merged.set(symbol, existing);
  }

  return Array.from(merged.values());
}

function rankSocialItems(candidates, xCounts) {
  const maxX = Math.max(...Object.values(xCounts), 0);

  return candidates
    .map((item) => {
      const xMentions = toNumber(xCounts[item.symbol]);
      const xScore = maxX > 0 ? Math.log1p(xMentions) / Math.log1p(maxX) : 0;
      const squareScore = toNumber(item.squareScore);
      const marketScore = toNumber(item.marketScore);
      const newsScore = Math.min(toNumber(item.newsMentions) / 8, 1);
      const score = Math.round(
        Math.min(100, 100 * (0.42 * squareScore + 0.32 * xScore + 0.18 * newsScore + 0.08 * marketScore))
      );

      return {
        symbol: item.symbol,
        score,
        xMentions,
        newsMentions: toNumber(item.newsMentions),
        squareScore: Math.round(squareScore * 100),
        squareRank: Number.isFinite(item.squareRank) ? item.squareRank : null,
        priceChange24h: toNumber(item.priceChange24h),
        volume24h: toNumber(item.volume24h),
        tags: item.tags || [],
        sourceTag: xMentions > 0 ? "X+Square" : item.newsMentions > 0 ? "News+Square" : "Square"
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.xMentions - a.xMentions || b.volume24h - a.volume24h);
}

function extractSymbolsFromText(text) {
  const raw = String(text || "");
  const symbols = new Set();
  const patterns = [
    /\$([A-Z0-9]{2,15})\b/g,
    /\(([A-Z0-9]{2,15})\)/g,
    /\b([A-Z0-9]{2,12})\s*(?:USDT|USD|上线|上新|LISTING|Listing|listing)\b/g
  ];

  for (const pattern of patterns) {
    for (const match of raw.matchAll(pattern)) {
      const symbol = normalizeSymbol(match[1]);
      if (symbol && !SYMBOL_DENY_LIST.has(symbol) && !/^\d+$/.test(symbol)) {
        symbols.add(symbol);
      }
    }
  }

  return symbols;
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SOCIAL_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = [];
  let index = 0;

  async function run() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function getBinanceHeaders() {
  return {
    Accept: "application/json",
    "Accept-Encoding": "identity",
    "Content-Type": "application/json",
    "User-Agent": "binance-web3/2.1 (SanmuPanel)"
  };
}

function getXBearerToken() {
  return process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN || process.env.TWITTER_TOKEN || "";
}

function normalizeSymbol(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/USDT$/, "")
    .trim();
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

module.exports = {
  loadSectorFeedPayload
};
