"use strict";

const http = require("http");
const { loadListingFeedPayload } = require("./listing-feed-core");
const { loadBweRssPayload } = require("./bwe-rss-core");
const { loadBinanceNewsPayload } = require("./binance-news-core");
const { loadBlockBeatsPayload } = require("./blockbeats-core");

const PORT = 8787;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/new-listings-feed") {
    try {
      const payload = await loadListingFeedPayload();
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(payload));
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
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bwe-rss-feed") {
    try {
      const payload = await loadBweRssPayload();
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(payload));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: "failed to load bwe rss feed",
          detail: error instanceof Error ? error.message : String(error)
        })
      );
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/binance-news-feed") {
    try {
      const payload = await loadBinanceNewsPayload();
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
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
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/blockbeats-feed") {
    try {
      const payload = await loadBlockBeatsPayload();
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(payload));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: "failed to load blockbeats feed",
          detail: error instanceof Error ? error.message : String(error)
        })
      );
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, port: PORT }));
    return;
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local API server listening on http://127.0.0.1:${PORT}`);
});
