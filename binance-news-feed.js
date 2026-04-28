"use strict";

const { loadBinanceNewsPayload } = require("../binance-news-core");

module.exports = async function handler(req, res) {
  try {
    const payload = await loadBinanceNewsPayload();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    res.end(JSON.stringify(payload));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error: "failed to load binance news feed",
        detail: error instanceof Error ? error.message : String(error)
      })
    );
  }
};
