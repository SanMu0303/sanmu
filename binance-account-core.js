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
const EQUITY_HISTORY_FILE = path.join(__dirname, "live-equity-history.json");
const TRADE_HISTORY_FILE = path.join(__dirname, "live-trade-history.json");
const CLOSED_TRADES_FILE = path.join(__dirname, "live-closed-trades.json");
const REQUEST_TIMEOUT_MS = 4500;
const ACCOUNT_CACHE_MS = 12000;
const STALE_CACHE_MS = 5 * 60 * 1000;
const EQUITY_HISTORY_LIMIT = 2000;
const EQUITY_HISTORY_MIN_INTERVAL_MS = 60 * 1000;
const TRADE_HISTORY_LIMIT = 5000;
const TRADE_HISTORY_LOOKBACK_DAYS = 365;
const TRADE_HISTORY_PAGE_DAYS = 30;
const CLOSED_TRADES_LIMIT = 1000;
const CLOSED_TRADES_SYMBOL_LIMIT = 8;
const CLOSED_TRADES_LOOKBACK_DAYS = 56;
const CLOSED_TRADES_PAGE_DAYS = 7;

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

function getHistoryLookbackDays() {
  loadLocalPrivateEnv();
  const configured = Number(process.env.BINANCE_HISTORY_LOOKBACK_DAYS || process.env.LIVE_HISTORY_LOOKBACK_DAYS);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 3650) : TRADE_HISTORY_LOOKBACK_DAYS;
}

function getClosedTradesLookbackDays() {
  loadLocalPrivateEnv();
  const configured = Number(process.env.BINANCE_CLOSED_TRADES_LOOKBACK_DAYS || process.env.LIVE_CLOSED_TRADES_LOOKBACK_DAYS);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 3650) : CLOSED_TRADES_LOOKBACK_DAYS;
}

function buildIncomeKey(item) {
  return [
    Number(item?.time) || 0,
    item?.symbol || "",
    item?.incomeType || item?.type || "",
    item?.income ?? item?.pnlValue ?? "",
    item?.asset || "",
    item?.info || ""
  ].join("|");
}

function readTradeHistory() {
  return readTradeHistoryPayload().items;
}

function readTradeHistoryPayload() {
  try {
    if (!fs.existsSync(TRADE_HISTORY_FILE)) return { items: [], backfillCursor: 0 };
    const payload = JSON.parse(fs.readFileSync(TRADE_HISTORY_FILE, "utf8"));
    return {
      backfillCursor: Number(payload?.backfillCursor) || 0,
      items: (Array.isArray(payload?.items) ? payload.items : [])
      .filter((item) => Number(item?.time))
      .map((item) => ({
        ...item,
        rawKey: item.rawKey || buildIncomeKey(item)
      }))
    };
  } catch (error) {
    return { items: [], backfillCursor: 0 };
  }
}

function writeTradeHistory(items, meta = {}) {
  if (process.env.VERCEL) return;
  try {
    fs.writeFileSync(
      TRADE_HISTORY_FILE,
      `${JSON.stringify({ backfillCursor: Number(meta.backfillCursor) || 0, items: items.slice(0, TRADE_HISTORY_LIMIT) }, null, 2)}\n`,
      "utf8"
    );
  } catch (error) {
    console.warn("write trade history failed:", error instanceof Error ? error.message : String(error));
  }
}

function mergeTradeHistory(existingRows, incomingRows) {
  const map = new Map();
  for (const row of [...existingRows, ...incomingRows]) {
    if (!row?.time) continue;
    const key = row.rawKey || buildIncomeKey(row);
    map.set(key, { ...row, rawKey: key });
  }
  return Array.from(map.values())
    .sort((a, b) => Number(b.time || 0) - Number(a.time || 0))
    .slice(0, TRADE_HISTORY_LIMIT);
}

function readEquityHistory() {
  try {
    if (!fs.existsSync(EQUITY_HISTORY_FILE)) return [];
    const payload = JSON.parse(fs.readFileSync(EQUITY_HISTORY_FILE, "utf8"));
    return Array.isArray(payload?.items) ? payload.items.filter((item) => Number.isFinite(Number(item?.equity))) : [];
  } catch (error) {
    return [];
  }
}

function readClosedTrades() {
  try {
    if (!fs.existsSync(CLOSED_TRADES_FILE)) return [];
    const payload = JSON.parse(fs.readFileSync(CLOSED_TRADES_FILE, "utf8"));
    return Array.isArray(payload?.items) ? payload.items.filter((item) => item?.symbol && Number(item?.closeTime)) : [];
  } catch (error) {
    return [];
  }
}

function writeClosedTrades(items) {
  if (process.env.VERCEL) return;
  try {
    fs.writeFileSync(
      CLOSED_TRADES_FILE,
      `${JSON.stringify({ items: items.slice(0, CLOSED_TRADES_LIMIT) }, null, 2)}\n`,
      "utf8"
    );
  } catch (error) {
    console.warn("write closed trades failed:", error instanceof Error ? error.message : String(error));
  }
}

function mergeClosedTrades(existingRows, incomingRows) {
  const map = new Map();
  for (const row of [...existingRows, ...incomingRows]) {
    if (!row?.symbol || !row?.closeTime) continue;
    const key = row.id || `${row.symbol}|${row.openTime}|${row.closeTime}|${row.side}|${row.entryPrice}|${row.exitPrice}`;
    map.set(key, { ...row, id: key });
  }
  return Array.from(map.values())
    .sort((a, b) => Number(b.closeTime || 0) - Number(a.closeTime || 0))
    .slice(0, CLOSED_TRADES_LIMIT);
}

function writeEquityHistory(items) {
  if (process.env.VERCEL) return;
  try {
    fs.writeFileSync(
      EQUITY_HISTORY_FILE,
      `${JSON.stringify({ items: items.slice(-EQUITY_HISTORY_LIMIT) }, null, 2)}\n`,
      "utf8"
    );
  } catch (error) {
    console.warn("write equity history failed:", error instanceof Error ? error.message : String(error));
  }
}

function appendEquityHistoryPoint(point) {
  const equity = toNumber(point?.equity);
  if (!Number.isFinite(equity) || equity <= 0) return readEquityHistory();

  const time = Number(point.time) || Date.now();
  const history = readEquityHistory();
  const last = history[history.length - 1];
  const nextPoint = {
    time,
    equity,
    returnRate: toNumber(point.returnRate),
    profit: toNumber(point.profit)
  };

  if (last) {
    const lastTime = Number(last.time) || 0;
    const lastEquity = toNumber(last.equity);
    if (time - lastTime < EQUITY_HISTORY_MIN_INTERVAL_MS && Math.abs(lastEquity - equity) < 0.01) {
      return history;
    }
  }

  const nextHistory = [...history, nextPoint].slice(-EQUITY_HISTORY_LIMIT);
  const baseEquity = toNumber(nextHistory[0]?.equity, equity) || equity;
  const normalized = nextHistory.map((item) => {
    const itemEquity = toNumber(item.equity);
    const profit = itemEquity - baseEquity;
    return {
      ...item,
      equity: itemEquity,
      returnRate: baseEquity ? (profit / baseEquity) * 100 : 0,
      profit
    };
  });

  writeEquityHistory(normalized);
  return normalized;
}

function buildBackfilledEquityHistory(currentEquity, incomeRows, now) {
  const equity = toNumber(currentEquity);
  if (!Number.isFinite(equity) || equity <= 0) return [];

  const rows = (Array.isArray(incomeRows) ? incomeRows : [])
    .filter((row) => Number(row?.time) && Number.isFinite(Number(row?.pnlValue)))
    .sort((a, b) => Number(a.time) - Number(b.time));
  if (!rows.length) {
    return [{ time: now, equity, returnRate: 0, profit: 0 }];
  }

  const totalFlow = rows.reduce((sum, row) => sum + toNumber(row.pnlValue), 0);
  const baseEquity = equity - totalFlow;
  let runningEquity = baseEquity;
  const points = [{
    time: Number(rows[0].time) - 1,
    equity: runningEquity,
    returnRate: 0,
    profit: 0
  }];

  for (const row of rows) {
    runningEquity += toNumber(row.pnlValue);
    if (!Number.isFinite(runningEquity) || runningEquity <= 0) continue;
    points.push({
      time: Number(row.time),
      equity: runningEquity,
      returnRate: baseEquity ? ((runningEquity - baseEquity) / baseEquity) * 100 : 0,
      profit: runningEquity - baseEquity
    });
  }

  points.push({
    time: now,
    equity,
    returnRate: baseEquity ? ((equity - baseEquity) / baseEquity) * 100 : 0,
    profit: equity - baseEquity
  });

  const deduped = [];
  for (const point of points.sort((a, b) => a.time - b.time)) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.time - point.time) < 1000) {
      deduped[deduped.length - 1] = point;
    } else {
      deduped.push(point);
    }
  }

  return deduped.slice(-EQUITY_HISTORY_LIMIT);
}

function mergeEquityHistories(sampledHistory, backfilledHistory) {
  const map = new Map();
  for (const point of [...(backfilledHistory || []), ...(sampledHistory || [])]) {
    const time = Number(point?.time) || 0;
    const equity = toNumber(point?.equity);
    if (!time || !Number.isFinite(equity) || equity <= 0) continue;
    map.set(String(time), {
      time,
      equity,
      returnRate: toNumber(point.returnRate),
      profit: toNumber(point.profit)
    });
  }

  const merged = Array.from(map.values()).sort((a, b) => a.time - b.time).slice(-EQUITY_HISTORY_LIMIT);
  const baseEquity = toNumber(merged[0]?.equity, 0);
  if (!baseEquity) return merged;

  return merged.map((point) => ({
    ...point,
    returnRate: ((point.equity - baseEquity) / baseEquity) * 100,
    profit: point.equity - baseEquity
  }));
}

function buildPreviewEquityHistory(now) {
  const start = now - 7 * 60 * 60 * 1000;
  const values = [12720, 12764, 12738, 12802, 12791, 12828, 12846.32];
  const base = values[0];
  return values.map((equity, index) => {
    const profit = equity - base;
    return {
      time: start + index * 70 * 60 * 1000,
      equity,
      returnRate: base ? (profit / base) * 100 : 0,
      profit
    };
  });
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
    rawKey: buildIncomeKey(item),
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

async function loadIncomeWindow(startTime, endTime) {
  const rows = await signedFapiRequest("/fapi/v1/income", {
    startTime: String(startTime),
    endTime: String(endTime),
    limit: "1000"
  });

  return (Array.isArray(rows) ? rows : [])
    .filter((item) => Math.abs(toNumber(item.income)) > 0)
    .map(normalizeIncome);
}

async function backfillOneIncomeHistoryPage(existingRows, now, cursor = 0) {
  const lookbackMs = getHistoryLookbackDays() * 24 * 60 * 60 * 1000;
  const pageMs = TRADE_HISTORY_PAGE_DAYS * 24 * 60 * 60 * 1000;
  const oldestAllowed = Math.max(0, now - lookbackMs);
  const endTime = cursor ? Math.min(now, cursor - 1) : now;
  const startTime = Math.max(oldestAllowed, endTime - pageMs + 1);

  if (endTime <= oldestAllowed || startTime >= endTime) {
    return { items: existingRows, backfillCursor: oldestAllowed };
  }

  const rows = await loadIncomeWindow(startTime, endTime);
  return {
    items: mergeTradeHistory(existingRows, rows),
    backfillCursor: startTime
  };
}

async function syncIncomeHistory(recentRows, now) {
  const payload = readTradeHistoryPayload();
  const seeded = mergeTradeHistory(payload.items, recentRows);
  const latestTime = seeded.length ? Math.max(...seeded.map((row) => Number(row.time) || 0)) : now;
  const overlapStart = Math.max(0, latestTime - 24 * 60 * 60 * 1000);
  const incrementalRows = await loadIncomeWindow(overlapStart, now);
  const merged = mergeTradeHistory(seeded, incrementalRows);
  const backfilled = await backfillOneIncomeHistoryPage(merged, now, payload.backfillCursor);
  writeTradeHistory(backfilled.items, { backfillCursor: backfilled.backfillCursor });
  return backfilled.items;
}

async function loadUserTrades(symbol, startTime, endTime) {
  const pageMs = CLOSED_TRADES_PAGE_DAYS * 24 * 60 * 60 * 1000;
  const allRows = [];
  let cursor = startTime;

  while (cursor <= endTime) {
    const pageEnd = Math.min(endTime, cursor + pageMs - 1);
    const rows = await signedFapiRequest("/fapi/v1/userTrades", {
      symbol,
      startTime: String(cursor),
      endTime: String(pageEnd),
      limit: "1000"
    });
    allRows.push(...(Array.isArray(rows) ? rows : []));
    cursor = pageEnd + 1;
  }

  return allRows.map((trade) => ({
    id: String(trade.id || trade.orderId || `${trade.time}-${trade.price}-${trade.qty}`),
    orderId: String(trade.orderId || ""),
    symbol: trade.symbol || symbol,
    side: trade.side || "",
    positionSide: trade.positionSide || "BOTH",
    time: Number(trade.time) || 0,
    price: toNumber(trade.price),
    qty: toNumber(trade.qty),
    realizedPnl: toNumber(trade.realizedPnl),
    commission: Math.abs(toNumber(trade.commission)),
    buyer: Boolean(trade.buyer)
  })).filter((trade) => trade.time && trade.price && trade.qty);
}

function getFundingForWindow(incomeRows, symbol, startTime, endTime) {
  return incomeRows
    .filter((row) => row.symbol === symbol && row.type === "FUNDING_FEE" && row.time >= startTime && row.time <= endTime)
    .reduce((sum, row) => sum + toNumber(row.pnlValue), 0);
}

function reconstructClosedTradesForSymbol(symbol, trades, incomeRows) {
  const records = [];
  const position = {
    qty: 0,
    avgEntry: 0,
    openTime: 0,
    entryFee: 0
  };

  for (const trade of trades.sort((a, b) => a.time - b.time)) {
    const signedQty = trade.side === "BUY" ? trade.qty : -trade.qty;
    if (!signedQty) continue;

    if (!position.qty || Math.sign(position.qty) === Math.sign(signedQty)) {
      const currentAbs = Math.abs(position.qty);
      const nextAbs = currentAbs + Math.abs(signedQty);
      position.avgEntry = nextAbs ? ((position.avgEntry * currentAbs) + (trade.price * Math.abs(signedQty))) / nextAbs : trade.price;
      position.qty += signedQty;
      position.openTime = position.openTime || trade.time;
      position.entryFee += trade.commission;
      continue;
    }

    const beforeAbs = Math.abs(position.qty);
    const closeAbs = Math.min(beforeAbs, Math.abs(signedQty));
    const closeRatio = beforeAbs ? closeAbs / beforeAbs : 1;
    const entryFee = position.entryFee * closeRatio;
    const closeFee = trade.commission;
    const funding = getFundingForWindow(incomeRows, symbol, position.openTime, trade.time);
    const realizedPnl = trade.realizedPnl;
    const totalPnl = realizedPnl + funding - entryFee - closeFee;
    const side = position.qty > 0 ? "多" : "空";

    records.push({
      id: `${symbol}|${position.openTime}|${trade.time}|${side}|${trade.id}`,
      openTime: position.openTime,
      closeTime: trade.time,
      symbol,
      entryPrice: position.avgEntry,
      exitPrice: trade.price,
      side,
      realizedPnl,
      commission: entryFee + closeFee,
      funding,
      pnlValue: totalPnl,
      pnl: `${formatSignedAmount(totalPnl)} USDT`
    });

    position.qty += signedQty;
    position.entryFee = Math.max(0, position.entryFee - entryFee);

    if (Math.abs(position.qty) < 1e-12) {
      position.qty = 0;
      position.avgEntry = 0;
      position.openTime = 0;
      position.entryFee = 0;
    } else if (Math.sign(position.qty) === Math.sign(signedQty) && Math.abs(signedQty) > closeAbs) {
      position.avgEntry = trade.price;
      position.openTime = trade.time;
      position.entryFee = trade.commission * ((Math.abs(signedQty) - closeAbs) / Math.abs(signedQty));
    }
  }

  return records;
}

async function loadClosedTrades(incomeRows, now) {
  const existing = readClosedTrades();
  if (existing.length) {
    return existing;
  }

  const startTime = Math.max(0, now - getClosedTradesLookbackDays() * 24 * 60 * 60 * 1000);
  const symbols = Array.from(
    new Set(
      incomeRows
        .filter((row) => /^[A-Z0-9]+USDT$/.test(row.symbol || "") && ["REALIZED_PNL", "COMMISSION", "FUNDING_FEE"].includes(row.type))
        .map((row) => row.symbol)
    )
  ).slice(0, CLOSED_TRADES_SYMBOL_LIMIT);

  const reconstructed = [];
  for (const symbol of symbols) {
    try {
      const trades = await loadUserTrades(symbol, startTime, now);
      reconstructed.push(...reconstructClosedTradesForSymbol(symbol, trades, incomeRows));
    } catch (error) {
      console.warn(`load user trades failed for ${symbol}:`, error instanceof Error ? error.message : String(error));
    }
  }

  const merged = mergeClosedTrades(existing, reconstructed);
  writeClosedTrades(merged);
  return merged;
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
    equityHistory: buildPreviewEquityHistory(now),
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
    history: getPreviewHistory(now),
    closedTrades: [
      {
        openTime: now - 74 * 60 * 1000,
        closeTime: now - 18 * 60 * 1000,
        symbol: "BTCUSDT",
        entryPrice: 68420.5,
        exitPrice: 68931.2,
        side: "多",
        pnl: "+42.80 USDT",
        pnlValue: 42.8,
        realizedPnl: 48.12,
        commission: 4.14,
        funding: -1.18
      }
    ]
  };
}

async function buildBinanceAccountPayload() {
  const [account, income] = await Promise.all([
    loadFuturesAccount(),
    signedFapiRequest("/fapi/v1/income", { limit: "1000" })
  ]);

  const assets = Array.isArray(account.assets) ? account.assets : [];
  const usdt = assets.find((asset) => asset.asset === "USDT") || {};
  const positions = (Array.isArray(account.positions) ? account.positions : [])
    .filter((position) => Math.abs(toNumber(position.positionAmt)) > 0)
    .map(normalizePosition)
    .sort((a, b) => Math.abs(b.pnlValue) - Math.abs(a.pnlValue));
  const recentIncomeRows = (Array.isArray(income) ? income : [])
    .filter((item) => Math.abs(toNumber(item.income)) > 0)
    .map(normalizeIncome)
    .sort((a, b) => b.time - a.time)
    .slice(0, 1000);
  const now = Date.now();
  const incomeRows = await syncIncomeHistory(recentIncomeRows, now);
  const closedTrades = await loadClosedTrades(incomeRows, now);

  const totalWalletBalance = toNumber(account.totalWalletBalance || usdt.walletBalance);
  const totalMarginBalance = toNumber(account.totalMarginBalance || usdt.marginBalance);
  const availableBalance = toNumber(account.availableBalance || usdt.availableBalance);
  const totalUnrealizedProfit = toNumber(account.totalUnrealizedProfit);
  const realizedToday = incomeRows
    .filter((row) => new Date(row.time).toDateString() === new Date().toDateString())
    .reduce((sum, row) => sum + row.pnlValue, 0);

  const updatedAt = now;
  const currentEquity = totalMarginBalance || totalWalletBalance;
  const sampledEquityHistory = appendEquityHistoryPoint({
    time: updatedAt,
    equity: currentEquity,
    returnRate: totalWalletBalance ? (totalUnrealizedProfit / totalWalletBalance) * 100 : 0,
    profit: totalUnrealizedProfit
  });
  const backfilledEquityHistory = buildBackfilledEquityHistory(currentEquity, incomeRows, updatedAt);
  const equityHistory = mergeEquityHistories(sampledEquityHistory, backfilledEquityHistory);

  return {
    source: "Binance Futures",
    sourceStatus: "ok",
    updatedAt,
    summary: {
      totalEquity: `${toFixedDynamic(currentEquity, 2)} USDT`,
      todayPnl: `${formatSignedAmount(realizedToday + totalUnrealizedProfit)} USDT`,
      maxDrawdown: "--",
      winRate: "--",
      walletBalance: `${toFixedDynamic(totalWalletBalance, 2)} USDT`,
      availableBalance: `${toFixedDynamic(availableBalance, 2)} USDT`,
      unrealizedPnl: `${formatSignedAmount(totalUnrealizedProfit)} USDT`
    },
    equity: {
      current: currentEquity,
      returnRate: totalWalletBalance ? (totalUnrealizedProfit / totalWalletBalance) * 100 : 0,
      profit: totalUnrealizedProfit
    },
    equityHistory,
    positions,
    history: incomeRows,
    closedTrades
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
