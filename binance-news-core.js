"use strict";

const BINANCE_NEWS_BASE_URL = "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query";
const BINANCE_NOTICE_URL = "https://www.binance.com/bapi/composite/v1/public/market/notice/get?page=1&rows=100";
const BINANCE_NEWS_PAGE_SIZE = 50;
const BINANCE_NEWS_PAGES = [1, 2, 3, 4, 5, 6];
const BINANCE_NEWS_CATALOG_IDS = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 128, 161];

async function loadBinanceNewsPayload() {
  try {
    const articles = await loadBinanceArticles();
    const items = articles.map((article) => ({
      title: normalizeText(article.title),
      summary: buildBinanceSummary(article),
      link: buildBinanceLink(article),
      publishTime: Number(article.releaseDate || article.publishDate || article.createTime || Date.now()),
      sourceTag: "BN"
    }));

    return {
      source: "binance-news",
      sourceStatus: {
        Binance: items.length ? "ok" : "failed"
      },
      items
    };
  } catch (error) {
    return {
      source: "binance-news",
      sourceStatus: {
        Binance: "failed"
      },
      items: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function loadBinanceArticles() {
  const articleMap = new Map();
  const loaders = [
    ...BINANCE_NEWS_PAGES.map((pageNo) => () => loadBinanceArticlePage({ pageNo })),
    ...BINANCE_NEWS_CATALOG_IDS.flatMap((catalogId) =>
      BINANCE_NEWS_PAGES.map((pageNo) => () => loadBinanceArticlePage({ catalogId, pageNo }))
    ),
    () => loadBinanceMarketNotices()
  ];

  const results = await Promise.allSettled(loaders.map((loader) => loader()));

  for (const result of results) {
    if (result.status !== "fulfilled") {
      continue;
    }

    for (const article of result.value || []) {
      const title = normalizeText(article?.title || article?.name || article?.noticeTitle || "");
      if (!title) {
        continue;
      }

      const key = normalizeText(`${article?.code || article?.id || ""} ${title}`.toLowerCase());
      if (!key) {
        continue;
      }

      articleMap.set(key, {
        ...article,
        title
      });
    }
  }

  return Array.from(articleMap.values())
    .sort((a, b) => {
      const importantDelta = Number(isImportantBinanceNews(b?.title || "")) - Number(isImportantBinanceNews(a?.title || ""));
      if (importantDelta !== 0) {
        return importantDelta;
      }

      return getArticleTime(b) - getArticleTime(a);
    })
    .slice(0, 180);
}

async function loadBinanceArticlePage({ catalogId, pageNo }) {
  const url = new URL(BINANCE_NEWS_BASE_URL);
  url.searchParams.set("type", "1");
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("pageSize", String(BINANCE_NEWS_PAGE_SIZE));
  if (catalogId) {
    url.searchParams.set("catalogId", String(catalogId));
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`binance article request failed: ${response.status}`);
  }

  const payload = await response.json();
  return extractArticleItems(payload);
}

async function loadBinanceMarketNotices() {
  const response = await fetch(BINANCE_NOTICE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`binance notice request failed: ${response.status}`);
  }

  const payload = await response.json();
  return extractNoticeItems(payload);
}

function extractArticleItems(payload) {
  const articles = [];
  const catalogs = payload?.data?.catalogs;

  if (Array.isArray(catalogs)) {
    for (const catalog of catalogs) {
      if (Array.isArray(catalog?.articles)) {
        articles.push(...catalog.articles);
      }
    }
  }

  const directCandidates = [payload?.data?.articles, payload?.data?.list, payload?.data?.rows, payload?.data];
  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) {
      articles.push(...candidate);
    }
  }

  return articles;
}

function extractNoticeItems(payload) {
  const candidates = [
    payload?.data?.noticeList,
    payload?.data?.list,
    payload?.data?.rows,
    payload?.data?.notices,
    payload?.data,
    payload?.noticeList
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map((item) => ({
        id: item?.id,
        code: item?.code || item?.catalogId || item?.id,
        title: normalizeText(item?.title || item?.name || item?.noticeTitle || ""),
        releaseDate: getArticleTime(item),
        publishDate: getArticleTime(item),
        url: item?.url || item?.link
      }));
    }
  }

  return [];
}

function buildBinanceLink(article) {
  const directUrl = article?.url || article?.link;
  if (directUrl) {
    return String(directUrl).startsWith("http") ? directUrl : `https://www.binance.com${directUrl}`;
  }

  if (article?.code) {
    return `https://www.binance.com/en/support/announcement/${article.code}`;
  }

  return "https://www.binance.com/en/support/announcement";
}

function isImportantBinanceNews(title) {
  const text = normalizeText(title).toLowerCase();
  const keywords = [
    "will list",
    "listing",
    "futures will launch",
    "will launch",
    "will delist",
    "delist",
    "new spot trading pairs",
    "spot trading pairs",
    "alpha",
    "hodler airdrops",
    "launchpool",
    "megadrop",
    "pre-market",
    "earn",
    "simple earn",
    "margin",
    "airdrop",
    "convert",
    "trading bot",
    "usd-m perpetual",
    "coin-m"
  ];

  return keywords.some((keyword) => text.includes(keyword));
}

function buildBinanceSummary(article) {
  const date = new Date(getArticleTime(article) || Date.now());
  const dateText = `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(
    date.getHours()
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const category = getBinanceCategory(article?.title || "");
  return [category, dateText].filter(Boolean).join(" · ");
}

function getBinanceCategory(title) {
  const text = normalizeText(title).toLowerCase();

  if (text.includes("will list") || text.includes("listing")) {
    return "上新";
  }
  if (text.includes("delist")) {
    return "下架";
  }
  if (text.includes("launchpool")) {
    return "Launchpool";
  }
  if (text.includes("hodler airdrops")) {
    return "HODLer";
  }
  if (text.includes("alpha")) {
    return "Alpha";
  }
  if (text.includes("futures") || text.includes("perpetual")) {
    return "合约";
  }
  if (text.includes("earn")) {
    return "Earn";
  }

  return "公告";
}

function getArticleTime(article) {
  return Number(
    article?.releaseDate ||
      article?.publishDate ||
      article?.createTime ||
      article?.ctime ||
      article?.time ||
      article?.date ||
      0
  );
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

module.exports = {
  loadBinanceNewsPayload
};
