"use strict";

const BINANCE_FAPI_ORIGINS = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi2.binance.com",
  "https://fapi3.binance.com",
  "https://fapi4.binance.com"
];
const BINANCE_FAPI_BASE = BINANCE_FAPI_ORIGINS[0];
const ALLOWED_BINANCE_PATHS = new Set([
  "/fapi/v1/exchangeInfo",
  "/fapi/v1/ticker/24hr",
  "/fapi/v1/premiumIndex",
  "/fapi/v1/fundingInfo",
  "/fapi/v1/klines"
]);

function normalizeBinancePath(rawPath) {
  const path = typeof rawPath === "string" ? rawPath.trim() : "";

  if (!path.startsWith("/fapi/v1/")) {
    throw new Error("unsupported binance path");
  }

  const parsed = new URL(path, BINANCE_FAPI_BASE);
  if (!ALLOWED_BINANCE_PATHS.has(parsed.pathname)) {
    throw new Error("binance path is not allowed");
  }

  return `${parsed.pathname}${parsed.search}`;
}

async function loadBinanceProxyPayload(rawPath) {
  const path = normalizeBinancePath(rawPath);
  let lastError = null;

  for (const origin of BINANCE_FAPI_ORIGINS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);

    try {
      const response = await fetch(`${origin}${path}`, {
        signal: controller.signal,
        headers: {
          "Accept": "application/json",
          "User-Agent": "sanmu-trading-dashboard/1.0"
        }
      });
      clearTimeout(timer);

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${origin} ${response.status} ${text.slice(0, 180)}`);
      }

      return JSON.parse(text);
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
    }
  }

  throw new Error(`all binance upstreams failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

module.exports = {
  loadBinanceProxyPayload,
  normalizeBinancePath
};
