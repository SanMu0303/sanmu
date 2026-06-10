"use strict";

const { loadYoutubeVideoMeta } = require("../videos-core");
const { applyCors } = require("./cors");

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) {
    return;
  }

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const payload = await loadYoutubeVideoMeta(url.searchParams.get("id") || "");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(payload));
  } catch (error) {
    res.statusCode = error.statusCode || 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "youtube meta api failed", detail: error instanceof Error ? error.message : String(error) }));
  }
};
