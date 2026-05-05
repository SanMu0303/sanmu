"use strict";

const COINGECKO_CATEGORIES_URL =
  "https://api.coingecko.com/api/v3/coins/categories?order=market_cap_change_24h_desc";
const COINMARKETCAP_CATEGORIES_URL =
  "https://pro-api.coinmarketcap.com/v1/cryptocurrency/categories";
const SECTOR_TIMEOUT_MS = 6500;

async function loadSectorFeedPayload() {
  const [coingeckoResult, cmcResult] = await Promise.allSettled([
    loadCoinGeckoSectors(),
    loadCoinMarketCapSectors()
  ]);

  const coingeckoItems = coingeckoResult.status === "fulfilled" ? coingeckoResult.value : [];
  const cmcItems = cmcResult.status === "fulfilled" ? cmcResult.value : [];
  const items = mergeSectorItems(coingeckoItems, cmcItems).slice(0, 16);

  return {
    source: cmcItems.length ? "coingecko+coinmarketcap" : "coingecko",
    sourceStatus: {
      CoinGecko: coingeckoItems.length ? "ok" : "failed",
      CoinMarketCap: cmcItems.length ? "ok" : process.env.CMC_API_KEY ? "failed" : "disabled"
    },
    updatedAt: Date.now(),
    items
  };
}

async function loadCoinGeckoSectors() {
  const apiKey = process.env.COINGECKO_API_KEY || process.env.CG_DEMO_API_KEY || "";
  const headers = {
    Accept: "application/json",
    "User-Agent": "sanmu-trading-panel/1.0"
  };
  if (apiKey) {
    headers["x-cg-demo-api-key"] = apiKey;
  }

  const data = await fetchJsonWithTimeout(COINGECKO_CATEGORIES_URL, {
    headers
  });

  return (Array.isArray(data) ? data : [])
    .map((item) => ({
      id: String(item.id || ""),
      name: normalizeText(item.name || "Unknown"),
      change24h: toNumber(item.market_cap_change_24h),
      marketCap: toNumber(item.market_cap),
      volume24h: toNumber(item.volume_24h),
      topCoins: Array.isArray(item.top_3_coins_id) ? item.top_3_coins_id.slice(0, 3) : [],
      sourceTag: "CG"
    }))
    .filter((item) => item.name && Number.isFinite(item.change24h))
    .sort((a, b) => Number(b.change24h || 0) - Number(a.change24h || 0));
}

async function loadCoinMarketCapSectors() {
  const apiKey = process.env.CMC_API_KEY || process.env.COINMARKETCAP_API_KEY || "";
  if (!apiKey) {
    return [];
  }

  const data = await fetchJsonWithTimeout(COINMARKETCAP_CATEGORIES_URL, {
    headers: {
      Accept: "application/json",
      "X-CMC_PRO_API_KEY": apiKey
    }
  });

  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows
    .map((item) => ({
      id: String(item.id || item.slug || item.name || ""),
      name: normalizeText(item.name || "Unknown"),
      change24h: toNumber(item.avg_price_change),
      marketCap: toNumber(item.market_cap),
      volume24h: toNumber(item.volume),
      topCoins: [],
      sourceTag: "CMC"
    }))
    .filter((item) => item.name && Number.isFinite(item.change24h))
    .sort((a, b) => Number(b.change24h || 0) - Number(a.change24h || 0));
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SECTOR_TIMEOUT_MS);

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

function mergeSectorItems(primaryItems, secondaryItems) {
  const merged = new Map();

  for (const item of [...primaryItems, ...secondaryItems]) {
    const key = normalizeKey(item.name || item.id);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      continue;
    }

    merged.set(key, {
      ...existing,
      change24h: Number.isFinite(item.change24h) ? item.change24h : existing.change24h,
      marketCap: Math.max(Number(existing.marketCap || 0), Number(item.marketCap || 0)),
      volume24h: Math.max(Number(existing.volume24h || 0), Number(item.volume24h || 0)),
      topCoins: existing.topCoins?.length ? existing.topCoins : item.topCoins || [],
      sourceTag: existing.sourceTag === item.sourceTag ? existing.sourceTag : `${existing.sourceTag}+${item.sourceTag}`
    });
  }

  return Array.from(merged.values()).sort((a, b) => {
    const changeDelta = Number(b.change24h || 0) - Number(a.change24h || 0);
    return changeDelta || Number(b.volume24h || 0) - Number(a.volume24h || 0);
  });
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

module.exports = {
  loadSectorFeedPayload
};
