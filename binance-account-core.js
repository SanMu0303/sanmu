"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BINANCE_FAPI_ORIGINS = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi2.binance.com",
  "https://fapi3.binance.com",
  "https://fapi4.binance.com"
];

const PRIVATE_ENV_FILE = path.join(__dirname, "binance-private.env");

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

function signQuery(params, apiSecret) {
  const search = new URLSearchParams(params);
  const signature = crypto.createHmac("sha256", apiSecret).update(search.toString()).digest("hex");
  search.set("signature", signature);
  return search.toString();
}

async function signedFapiRequest(endpoint, params = {}) {
  const { apiKey, apiSecret } = getBinanceCredentials();
  const query = signQuery(
    {
      recvWindow: "8000",
      timestamp: String(Date.now()),
      ...params
    },
    apiSecret
  );

  const attempts = BINANCE_FAPI_ORIGINS.map(async (origin) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);

    try {
      const response = await fetch(`${origin}${endpoint}?${query}`, {
        signal: controller.signal,
        headers: {
          "Accept": "application/json",
          "User-Agent": "sanmu-trading-dashboard/1.0",
          "X-MBX-APIKEY": apiKey
        }
      });
      clearTimeout(timer);

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${origin} ${response.status} ${text.slice(0, 220)}`);
      }

      return JSON.parse(text);
    } catch (error) {
      throw new Error(`${origin}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  });

  try {
    return await Promise.any(attempts);
  } catch (error) {
    const details = error instanceof AggregateError
      ? error.errors.map((item) => (item instanceof Error ? item.message : String(item))).join(" | ")
      : error instanceof Error
        ? error.message
        : String(error);
    throw new Error(`all binance account upstreams failed: ${details}`);
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

async function loadBinanceAccountPayload() {
  const [account, income] = await Promise.all([
    signedFapiRequest("/fapi/v3/account"),
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

module.exports = {
  loadBinanceAccountPayload
};
