"use strict";

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");
const tls = require("tls");

const DEFAULT_BINANCE_FAPI_ORIGINS = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com"
];

const PRIVATE_ENV_FILE = path.join(__dirname, "binance-private.env");
const REQUEST_TIMEOUT_MS = 4500;
const ACCOUNT_CACHE_MS = 12000;
const STALE_CACHE_MS = 5 * 60 * 1000;

let serverTimeOffset = 0;
let serverTimeSyncedAt = 0;
let serverTimeInflight = null;
let cachedAccountPayload = null;
let cachedAccountAt = 0;
let inflightAccountLoad = null;

function loadLocalPrivateEnv() {
  if (!fs.existsSync(PRIVATE_ENV_FILE)) return;

  const text = fs.readFileSync(PRIVATE_ENV_FILE, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
    if (key && value && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function getBinanceCredentials() {
  loadLocalPrivateEnv();

  const apiKey = process.env.BINANCE_API_KEY || process.env.BINANCE_FUTURES_API_KEY || "";
  const apiSecret = process.env.BINANCE_API_SECRET || process.env.BINANCE_FUTURES_API_SECRET || "";

  if (!apiKey || !apiSecret) {
    throw new Error("missing BINANCE_API_KEY or BINANCE_API_SECRET");
  }

  return { apiKey, apiSecret };
}

function getBinanceFapiOrigins() {
  loadLocalPrivateEnv();

  const configuredOrigins = process.env.BINANCE_FAPI_ORIGINS || "";
  const origins = configuredOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length ? origins : DEFAULT_BINANCE_FAPI_ORIGINS;
}

function getBinanceProxyUrl() {
  loadLocalPrivateEnv();
  if (process.env.BINANCE_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
    return process.env.BINANCE_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  }

  return process.env.VERCEL ? "" : "http://127.0.0.1:7890";
}

function signQuery(params, apiSecret) {
  const search = new URLSearchParams(params);
  const signature = crypto.createHmac("sha256", apiSecret).update(search.toString()).digest("hex");
  search.set("signature", signature);
  return search.toString();
}

function requestJsonDirect(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);

  return fetch(url, {
    signal: controller.signal,
    headers: options.headers || {}
  })
    .then(async (response) => {
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${response.status} ${text.slice(0, 220)}`);
      }
      return JSON.parse(text);
    })
    .catch((error) => {
      if (error?.name === "AbortError") {
        throw new Error("request timeout");
      }
      throw error;
    })
    .finally(() => {
      clearTimeout(timer);
    });
}

function requestJsonViaProxy(url, options = {}) {
  const proxyUrl = getBinanceProxyUrl();
  if (!proxyUrl) return requestJsonDirect(url, options);

  const target = new URL(url);
  const proxy = new URL(proxyUrl);

  if (target.protocol !== "https:" || proxy.protocol !== "http:") {
    return requestJsonDirect(url, options);
  }

  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;
    const socket = net.connect(Number(proxy.port || 80), proxy.hostname);
    let settled = false;
    let connectBuffer = "";
    let timer = null;

    const finish = (error, payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      resolve(payload);
    };

    timer = setTimeout(() => finish(new Error("request timeout")), timeoutMs);

    socket.once("error", (error) => finish(error));
    socket.once("connect", () => {
      socket.write(
        `CONNECT ${target.hostname}:443 HTTP/1.1\r\n` +
        `Host: ${target.hostname}:443\r\n` +
        "Proxy-Connection: Keep-Alive\r\n" +
        "\r\n"
      );
    });

    socket.on("data", (chunk) => {
      connectBuffer += chunk.toString("latin1");
      if (!connectBuffer.includes("\r\n\r\n")) return;

      socket.removeAllListeners("data");
      const statusLine = connectBuffer.split("\r\n", 1)[0] || "";
      if (!statusLine.includes(" 200 ")) {
        finish(new Error(`proxy ${statusLine || "CONNECT failed"}`));
        return;
      }

      const secureSocket = tls.connect({
        socket,
        servername: target.hostname
      });
      let responseBuffer = "";

      secureSocket.once("error", (error) => finish(error));
      secureSocket.once("secureConnect", () => {
        const headers = {
          Host: target.hostname,
          Connection: "close",
          ...(options.headers || {})
        };
        const headerText = Object.entries(headers)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\r\n");
        secureSocket.write(`GET ${target.pathname}${target.search} HTTP/1.1\r\n${headerText}\r\n\r\n`);
      });
      secureSocket.on("data", (part) => {
        responseBuffer += part.toString("utf8");
      });
      secureSocket.on("end", () => {
        const splitAt = responseBuffer.indexOf("\r\n\r\n");
        const headerText = splitAt >= 0 ? responseBuffer.slice(0, splitAt) : "";
        const body = splitAt >= 0 ? responseBuffer.slice(splitAt + 4) : responseBuffer;
        const status = Number((headerText.match(/^HTTP\/\d\.\d\s+(\d+)/) || [])[1]);
        if (!status || status < 200 || status >= 300) {
          finish(new Error(`${status || "HTTP"} ${body.slice(0, 220)}`));
          return;
        }
        try {
          finish(null, JSON.parse(body));
        } catch (error) {
          finish(error);
        }
      });
    });
  });
}

async function requestJson(url, options = {}) {
  const proxyUrl = getBinanceProxyUrl();
  if (proxyUrl) {
    try {
      return await requestJsonViaProxy(url, options);
    } catch (error) {
      throw new Error(`${proxyUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    return await requestJsonDirect(url, options);
  } catch (error) {
    throw error;
  }
}

async function loadServerTimeOffset() {
  if (Date.now() - serverTimeSyncedAt < 5 * 60 * 1000) {
    return serverTimeOffset;
  }

  if (serverTimeInflight) {
    return serverTimeInflight;
  }

  serverTimeInflight = syncServerTimeOffset().finally(() => {
    serverTimeInflight = null;
  });

  return serverTimeInflight;
}

async function syncServerTimeOffset() {
  const errors = [];

  for (const origin of getBinanceFapiOrigins()) {
    try {
      const payload = await requestJson(`${origin}/fapi/v1/time`, {
        timeoutMs: 2500,
        headers: {
          "Accept": "application/json",
          "User-Agent": "sanmu-trading-dashboard/1.0"
        }
      });
      const serverTime = Number(payload.serverTime);
      if (Number.isFinite(serverTime)) {
        serverTimeOffset = serverTime - Date.now();
        serverTimeSyncedAt = Date.now();
        return serverTimeOffset;
      }
    } catch (error) {
      errors.push(`${origin}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  serverTimeSyncedAt = Date.now();
  return serverTimeOffset;
}

async function signedFapiRequest(endpoint, params = {}) {
  const { apiKey, apiSecret } = getBinanceCredentials();
  const timeOffset = await loadServerTimeOffset();
  const query = signQuery(
    {
      recvWindow: "10000",
      timestamp: String(Date.now() + timeOffset),
      ...params
    },
    apiSecret
  );

  const errors = [];
  for (const origin of getBinanceFapiOrigins()) {
    try {
      return await requestJson(`${origin}${endpoint}?${query}`, {
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: {
          "Accept": "application/json",
          "User-Agent": "sanmu-trading-dashboard/1.0",
          "X-MBX-APIKEY": apiKey
        }
      });
    } catch (error) {
      errors.push(`${origin}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`all binance account upstreams failed: ${errors.join(" | ")}`);
}

async function loadFuturesAccount() {
  try {
    return await signedFapiRequest("/fapi/v3/account");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("404") || message.includes("-5000") || message.includes("Unknown")) {
      return signedFapiRequest("/fapi/v2/account");
    }
    throw error;
  }
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toFixedDynamic(value, max = 4) {
  const number = toNumber(value);
  if (!number) return "0";
  if (Math.abs(number) >= 1000) return number.toFixed(2);
  if (Math.abs(number) >= 1) return number.toFixed(max);
  return number.toPrecision(4);
}

function formatSignedAmount(value) {
  const number = toNumber(value);
  const prefix = number > 0 ? "+" : "";
  return `${prefix}${toFixedDynamic(number, 4)}`;
}

function normalizePosition(position) {
  const amount = toNumber(position.positionAmt);
  const markPrice = toNumber(position.markPrice);
  const entryPrice = toNumber(position.entryPrice);
  const leverage = toNumber(position.leverage);
  const unrealizedProfit = toNumber(position.unRealizedProfit);

  return {
    symbol: position.symbol,
    side: amount > 0 ? "多" : "空",
    leverage: leverage ? `${leverage}x` : "--",
    amount: toFixedDynamic(Math.abs(amount), 6),
    entryPrice: entryPrice ? `$${toFixedDynamic(entryPrice, 6)}` : "--",
    markPrice: markPrice ? `$${toFixedDynamic(markPrice, 6)}` : "--",
    pnl: `${formatSignedAmount(unrealizedProfit)} USDT`,
    pnlValue: unrealizedProfit
  };
}

function normalizeIncome(item) {
  const income = toNumber(item.income);
  return {
    time: Number(item.time) || 0,
    symbol: item.symbol || "--",
    type: item.incomeType || "--",
    side: income >= 0 ? "收入" : "支出",
    open: "--",
    close: "--",
    pnl: `${formatSignedAmount(income)} USDT`,
    pnlValue: income
  };
}

function getPreviewHistory(now) {
  return [
    {
      time: now - 18 * 60 * 1000,
      symbol: "BTCUSDT",
      type: "REALIZED_PNL",
      side: "收入",
      open: "--",
      close: "--",
      pnl: "+42.8 USDT",
      pnlValue: 42.8
    },
    {
      time: now - 54 * 60 * 1000,
      symbol: "ETHUSDT",
      type: "COMMISSION",
      side: "支出",
      open: "--",
      close: "--",
      pnl: "-3.46 USDT",
      pnlValue: -3.46
    },
    {
      time: now - 112 * 60 * 1000,
      symbol: "SOLUSDT",
      type: "FUNDING_FEE",
      side: "收入",
      open: "--",
      close: "--",
      pnl: "+1.18 USDT",
      pnlValue: 1.18
    }
  ];
}

function getPreviewAccountPayload(error) {
  const now = Date.now();
  const warning = error instanceof Error ? error.message : String(error || "");

  return {
    source: "Local Preview",
    sourceStatus: "preview",
    updatedAt: now,
    preview: true,
    warning,
    summary: {
      totalEquity: "12,846.32 USDT",
      todayPnl: "+40.52 USDT",
      maxDrawdown: "-2.8%",
      winRate: "62.5%",
      walletBalance: "12,512.64 USDT",
      availableBalance: "8,934.10 USDT",
      unrealizedPnl: "+36.91 USDT"
    },
    equity: {
      current: 12846.32,
      returnRate: 0.32,
      profit: 40.52
    },
    positions: [
      {
        symbol: "BTCUSDT",
        side: "多",
        leverage: "5x",
        amount: "0.084",
        entryPrice: "$68,420.50",
        markPrice: "$68,931.20",
        pnl: "+42.91 USDT",
        pnlValue: 42.91
      },
      {
        symbol: "ETHUSDT",
        side: "空",
        leverage: "3x",
        amount: "1.250",
        entryPrice: "$3,756.80",
        markPrice: "$3,742.10",
        pnl: "+18.37 USDT",
        pnlValue: 18.37
      },
      {
        symbol: "SOLUSDT",
        side: "多",
        leverage: "2x",
        amount: "42.000",
        entryPrice: "$167.42",
        markPrice: "$166.83",
        pnl: "-24.78 USDT",
        pnlValue: -24.78
      }
    ],
    history: getPreviewHistory(now)
  };
}

async function buildBinanceAccountPayload() {
  const [account, income] = await Promise.all([
    loadFuturesAccount(),
    signedFapiRequest("/fapi/v1/income", { limit: "50" })
  ]);

  const assets = Array.isArray(account.assets) ? account.assets : [];
  const usdt = assets.find((asset) => asset.asset === "USDT") || {};
  const positions = (Array.isArray(account.positions) ? account.positions : [])
    .filter((position) => Math.abs(toNumber(position.positionAmt)) > 0)
    .map(normalizePosition)
    .sort((a, b) => Math.abs(b.pnlValue) - Math.abs(a.pnlValue));
  const incomeRows = (Array.isArray(income) ? income : [])
    .filter((item) => Math.abs(toNumber(item.income)) > 0)
    .map(normalizeIncome)
    .sort((a, b) => b.time - a.time)
    .slice(0, 30);

  const totalWalletBalance = toNumber(account.totalWalletBalance || usdt.walletBalance);
  const totalMarginBalance = toNumber(account.totalMarginBalance || usdt.marginBalance);
  const availableBalance = toNumber(account.availableBalance || usdt.availableBalance);
  const totalUnrealizedProfit = toNumber(account.totalUnrealizedProfit);
  const realizedToday = incomeRows
    .filter((row) => new Date(row.time).toDateString() === new Date().toDateString())
    .reduce((sum, row) => sum + row.pnlValue, 0);

  return {
    source: "Binance Futures",
    sourceStatus: "ok",
    updatedAt: Date.now(),
    summary: {
      totalEquity: `${toFixedDynamic(totalMarginBalance || totalWalletBalance, 2)} USDT`,
      todayPnl: `${formatSignedAmount(realizedToday + totalUnrealizedProfit)} USDT`,
      maxDrawdown: "--",
      winRate: "--",
      walletBalance: `${toFixedDynamic(totalWalletBalance, 2)} USDT`,
      availableBalance: `${toFixedDynamic(availableBalance, 2)} USDT`,
      unrealizedPnl: `${formatSignedAmount(totalUnrealizedProfit)} USDT`
    },
    equity: {
      current: totalMarginBalance || totalWalletBalance,
      returnRate: totalWalletBalance ? (totalUnrealizedProfit / totalWalletBalance) * 100 : 0,
      profit: totalUnrealizedProfit
    },
    positions,
    history: incomeRows
  };
}

async function loadBinanceAccountPayload(options = {}) {
  const now = Date.now();
  const maxCacheAge = options.maxCacheAge ?? ACCOUNT_CACHE_MS;
  const previewFallbackEnabled = options.previewFallback || process.env.BINANCE_ACCOUNT_PREVIEW_FALLBACK === "1";

  if (!options.forceRefresh && cachedAccountPayload && now - cachedAccountAt < maxCacheAge) {
    return {
      ...cachedAccountPayload,
      cached: true,
      cacheAgeMs: now - cachedAccountAt
    };
  }

  if (!inflightAccountLoad) {
    inflightAccountLoad = buildBinanceAccountPayload()
      .then((payload) => {
        cachedAccountPayload = payload;
        cachedAccountAt = Date.now();
        return payload;
      })
      .finally(() => {
        inflightAccountLoad = null;
      });
  }

  try {
    return await inflightAccountLoad;
  } catch (error) {
    if (cachedAccountPayload && now - cachedAccountAt < STALE_CACHE_MS) {
      return {
        ...cachedAccountPayload,
        sourceStatus: "stale",
        cached: true,
        stale: true,
        cacheAgeMs: now - cachedAccountAt,
        warning: error instanceof Error ? error.message : String(error)
      };
    }

    if (previewFallbackEnabled) {
      return getPreviewAccountPayload(error);
    }
    throw error;
  }
}

module.exports = {
  loadBinanceAccountPayload
};
