"use strict";

const { loadBinanceProxyPayload } = require("../binance-proxy-core");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const requestUrl = new URL(req.url || "/", "https://sanmu-trading.local");
    const path = requestUrl.searchParams.get("path") || "";
    const payload = await loadBinanceProxyPayload(path);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=3, stale-while-revalidate=10");
    res.end(JSON.stringify(payload));
  } catch (error) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error: "failed to load binance data",
        detail: error instanceof Error ? error.message : String(error)
      })
    );
  }
};
