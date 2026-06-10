"use strict";

const { loadBinanceAccountPayload } = require("../binance-account-core");
const { applyCors } = require("./cors");

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) {
    return;
  }

  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const payload = await loadBinanceAccountPayload({
      previewFallback: url.searchParams.get("preview") === "1"
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(payload));
  } catch (error) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        error: "failed to load binance account data",
        detail: error instanceof Error ? error.message : String(error)
      })
    );
  }
};
