"use strict";

const { loadBinanceProxyPayload } = require("../binance-proxy-core");
const { applyCors } = require("./cors");

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) {
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
