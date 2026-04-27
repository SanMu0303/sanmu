"use strict";

const JIN10_MCP_URL = "https://mcp.jin10.com/mcp";
const JIN10_TOKEN =
  process.env.JIN10_MCP_TOKEN || "sk-Y3HrI9owWY_xsm0ocIEne51UsapxdSlEuRiTCE3PoJ0";

async function loadListingFeedPayload() {
  const results = await Promise.allSettled([fetchJin10FlashFeed()]);

  const items = results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .sort((a, b) => Number(b.publishTime || 0) - Number(a.publishTime || 0))
    .slice(0, 20);

  return {
    source: "jin10",
    sourceStatus: {
      Jin10: results[0].status === "fulfilled" ? "ok" : "failed",
      Binance: "paused",
      Telegram: "paused",
      OKX: "paused",
      Bybit: "paused",
      Coinbase: "paused",
      Upbit: "paused",
      Robinhood: "paused",
      Bithumb: "paused"
    },
    items
  };
}

async function fetchJin10FlashFeed() {
  const response = await callJin10Mcp("list_flash", {});
  const items = response?.data?.items || [];
  const normalizedItems = items.map((item) => {
    const title = normalizeTitle(item.title || item.content || "金十快讯");
    const content = normalizeTitle(item.content || "");

    return {
      exchange: "Jin10",
      title: title.length > 64 ? `${title.slice(0, 64)}...` : title,
      summary: content && content !== title ? content.slice(0, 96) : formatJin10Time(item.time),
      link: item.url || "https://flash.jin10.com/",
      symbols: extractSymbols(content || title),
      publishTime: item.time ? Date.parse(item.time) : Date.now(),
      importanceScore: getJin10ImportanceScore(title, content)
    };
  });

  const importantItems = normalizedItems
    .filter((item) => item.importanceScore >= 2)
    .sort((a, b) => Number(b.importanceScore) - Number(a.importanceScore) || Number(b.publishTime) - Number(a.publishTime))
    .slice(0, 8);

  return (importantItems.length ? importantItems : normalizedItems.slice(0, 6)).map((item) => ({
    exchange: item.exchange,
    title: item.title,
    summary: item.summary,
    link: item.link,
    symbols: item.symbols,
    publishTime: item.publishTime
  }));
}

async function callJin10Mcp(toolName, args) {
  if (!JIN10_TOKEN) {
    throw new Error("jin10 token missing");
  }

  const sessionId = await initJin10Session();
  const payload = await fetchMcpJson(sessionId, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args || {}
    }
  });

  const structured = payload?.result?.structuredContent;
  if (structured && typeof structured === "object") {
    return structured;
  }

  const textContent = payload?.result?.content?.find((item) => item.type === "text")?.text || "";
  return textContent ? JSON.parse(textContent) : {};
}

async function initJin10Session() {
  const payload = await fetchMcpResponse(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: {
          name: "sanmu-dashboard",
          version: "1.0.0"
        }
      }
    },
    {}
  );

  const sessionId = payload.sessionId;
  if (!sessionId) {
    throw new Error("jin10 mcp session missing");
  }

  return sessionId;
}

async function fetchMcpJson(sessionId, body) {
  const payload = await fetchMcpResponse(body, { "Mcp-Session-Id": sessionId });
  return payload.json;
}

async function fetchMcpResponse(body, extraHeaders) {
  const response = await fetch(JIN10_MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${JIN10_TOKEN}`,
      "Content-Type": "application/json",
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`jin10 mcp request failed: ${response.status}`);
  }

  const sessionId = response.headers.get("mcp-session-id") || "";
  const text = await response.text();
  const json = parseMcpSsePayload(text);

  if (!json) {
    throw new Error("jin10 mcp response parse failed");
  }

  return {
    sessionId,
    json
  };
}

function parseMcpSsePayload(text) {
  const match = String(text || "").match(/data:\s*(\{[\s\S]*\})/);
  if (!match) {
    return null;
  }

  return JSON.parse(match[1]);
}

async function fetchBinanceListingAnnouncements() {
  const catalogId = "48";
  const pageSize = 20;
  const url =
    "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query" +
    `?type=1&catalogId=${catalogId}&pageNo=1&pageSize=${pageSize}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`binance announcement request failed: ${response.status}`);
  }

  const payload = await response.json();
  const articles = payload?.data?.catalogs?.[0]?.articles || [];

  return articles
    .filter((article) => isListingTitle(article?.title || ""))
    .slice(0, 8)
    .map((article) => ({
      exchange: "Binance",
      title: normalizeTitle(article.title),
      summary: buildSummary(article.releaseDate || article.publishDate || 0, article.code),
      link: `https://www.binance.com/en/support/announcement/${article.code}`,
      symbols: extractSymbols(article.title),
      publishTime: article.releaseDate || article.publishDate || 0
    }));
}

async function fetchTelegramListingFeed() {
  const response = await fetch("https://t.me/s/NewListingsFeed", {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html"
    }
  });

  if (!response.ok) {
    throw new Error(`telegram listing request failed: ${response.status}`);
  }

  const html = await response.text();
  const matches = [...html.matchAll(/<a class="tgme_widget_message_date" href="([^"]+)"/g)];
  const textMatches = [...html.matchAll(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g)];
  const timeMatches = [...html.matchAll(/<time[^>]*datetime="([^"]+)"/g)];
  const items = [];

  for (let index = 0; index < Math.min(matches.length, textMatches.length, 12); index += 1) {
    const link = matches[index]?.[1];
    const rawHtml = textMatches[index]?.[1] || "";
    const text = normalizeTitle(stripHtml(rawHtml));
    if (!text || !isListingTitle(text)) {
      continue;
    }

    const isoTime = timeMatches[index]?.[1] || "";
    const publishTime = isoTime ? Date.parse(isoTime) : Date.now() - index * 1000;

    items.push({
      exchange: "Telegram",
      title: text,
      summary: "@NewListingsFeed",
      link,
      symbols: extractSymbols(text),
      publishTime
    });
  }

  return items.slice(0, 8);
}

async function fetchOkxListingAnnouncements() {
  const response = await fetch("https://www.okx.com/help", {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html"
    }
  });

  if (!response.ok) {
    throw new Error(`okx announcement request failed: ${response.status}`);
  }

  const html = await response.text();
  const matches = [...html.matchAll(/href="(\/help\/[^"]+)"[^>]*>([^<]*(?:list|launch|will list|pre-market)[^<]*)<\/a>/gi)];

  return matches.slice(0, 6).map((match, index) => ({
    exchange: "OKX",
    title: normalizeTitle(match[2]),
    summary: "OKX 官方帮助中心公告",
    link: `https://www.okx.com${match[1]}`,
    symbols: extractSymbols(match[2]),
    publishTime: Date.now() - index * 1000
  }));
}

async function fetchBybitListingAnnouncements() {
  const response = await fetch("https://announcements.bybit.com/en-US/", {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html"
    }
  });

  if (!response.ok) {
    throw new Error(`bybit announcement request failed: ${response.status}`);
  }

  const html = await response.text();
  const matches = [...html.matchAll(/href="(\/en-US\/article\/[^"]+)"[^>]*>([^<]*(?:list|launch|perpetual|spot trading)[^<]*)<\/a>/gi)];

  return matches.slice(0, 6).map((match, index) => ({
    exchange: "Bybit",
    title: normalizeTitle(match[2]),
    summary: "Bybit 官方公告",
    link: `https://announcements.bybit.com${match[1]}`,
    symbols: extractSymbols(match[2]),
    publishTime: Date.now() - 5000 - index * 1000
  }));
}

function isListingTitle(title) {
  const keywords = [
    "will list",
    "futures will launch",
    "launches usd",
    "launches coin",
    "new spot trading pairs",
    "pre-market",
    "will add",
    "adds",
    "listing",
    "上线",
    "上新"
  ];

  const lower = title.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

function normalizeTitle(title) {
  return String(title || "").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function extractSymbols(title) {
  const matches = normalizeTitle(title).match(/\b[A-Z0-9]{2,15}\b/g) || [];
  const blacklist = new Set([
    "BINANCE",
    "BYBIT",
    "OKX",
    "WILL",
    "LIST",
    "USD",
    "USDT",
    "FDUSD",
    "BTC",
    "ETH",
    "THE",
    "AND",
    "FOR",
    "WITH",
    "NEW",
    "SPOT",
    "PAIRS",
    "FUTURES",
    "LAUNCH",
    "LAUNCHES",
    "PRE",
    "MARKET",
    "PERPETUAL",
    "TELEGRAM"
  ]);

  return [...new Set(matches.filter((item) => !blacklist.has(item)).slice(0, 5).map((item) => `$${item}`))];
}

function buildSummary(timeValue, code) {
  const dateText = timeValue ? new Date(Number(timeValue)).toISOString().slice(0, 16).replace("T", " ") : "";
  const codeText = code ? `公告ID ${code}` : "";
  return [dateText, codeText].filter(Boolean).join(" · ");
}

function formatJin10Time(value) {
  if (!value) {
    return "";
  }

  return String(value).replace("T", " ").replace("+08:00", "");
}

function getJin10ImportanceScore(title, content) {
  const text = `${normalizeTitle(title)} ${normalizeTitle(content)}`;
  const lower = text.toLowerCase();
  let score = 0;

  const keywordGroups = [
    { score: 3, words: ["美联储", "fed", "鲍威尔", "fomc", "欧洲央行", "ecb", "日本央行", "英国央行", "中国人民银行", "央行"] },
    { score: 3, words: ["特朗普", "白宫", "国务院", "财政部", "sec", "证监会", "关税", "制裁", "停火", "战争", "袭击", "导弹", "伊朗", "俄罗斯", "乌克兰"] },
    { score: 2, words: ["openai", "微软", "英伟达", "苹果", "特斯拉", "谷歌", "亚马逊", "meta", "高盛", "摩根士丹利"] },
    { score: 2, words: ["财报", "净利润", "营收", "同比增长", "同比下降", "立案", "收购", "并购", "破产", "发行", "裁员"] },
    { score: 2, words: ["比特币", "btc", "以太坊", "eth", "sol", "xrp", "加密", "crypto", "稳定币", "etf"] },
    { score: 1, words: ["涨幅", "跌幅", "暴跌", "大涨", "新高", "新低", "盘前", "开盘", "收盘"] }
  ];

  keywordGroups.forEach((group) => {
    if (group.words.some((word) => lower.includes(String(word).toLowerCase()))) {
      score += group.score;
    }
  });

  if (/[涨跌](幅)?[超逾]\d+/.test(text) || /暴跌\d+/.test(text) || /大涨\d+/.test(text)) {
    score += 2;
  }

  if (/金十数据.*讯/.test(text) || /【.+】/.test(text)) {
    score += 1;
  }

  return score;
}

module.exports = {
  loadListingFeedPayload
};
