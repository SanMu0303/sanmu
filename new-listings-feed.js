module.exports = async function handler(req, res) {
  try {
    const results = await Promise.allSettled([
      fetchBinanceListingAnnouncements(),
      fetchOkxListingAnnouncements(),
      fetchBybitListingAnnouncements()
    ]);

    const items = results
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .sort((a, b) => Number(b.publishTime || 0) - Number(a.publishTime || 0))
      .slice(0, 20);

    const sourceStatus = {
      Binance: results[0].status === "fulfilled" ? "ok" : "failed",
      OKX: results[1].status === "fulfilled" ? "ok" : "failed",
      Bybit: results[2].status === "fulfilled" ? "ok" : "failed",
      Coinbase: "pending",
      Upbit: "pending",
      Robinhood: "pending",
      Bithumb: "pending"
    };

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.end(JSON.stringify({ source: "multi-exchange", sourceStatus, items }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error: "failed to load listing feeds",
        detail: error instanceof Error ? error.message : String(error)
      })
    );
  }
};

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
    "adds"
  ];

  const lower = title.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

function normalizeTitle(title) {
  return String(title || "").replace(/\s+/g, " ").trim();
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
    "PERPETUAL"
  ]);

  return [...new Set(matches.filter((item) => !blacklist.has(item)).slice(0, 5).map((item) => `$${item}`))];
}

function buildSummary(timeValue, code) {
  const dateText = timeValue ? new Date(Number(timeValue)).toISOString().slice(0, 16).replace("T", " ") : "";
  const codeText = code ? `公告ID ${code}` : "";
  return [dateText, codeText].filter(Boolean).join(" · ");
}
