"use strict";

const { addCategory, deleteCategory, listVideos } = require("../videos-core");
const { applyCors } = require("./cors");

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) {
    return;
  }

  try {
    let payload;
    if (req.method === "GET") {
      payload = await listVideos();
    } else if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      payload = await addCategory(body.category || body.name || "");
    } else if (req.method === "DELETE") {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      payload = await deleteCategory(url.searchParams.get("category") || "");
    } else {
      res.statusCode = 405;
      payload = { error: "method not allowed" };
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(payload));
  } catch (error) {
    res.statusCode = error.statusCode || 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        error: "video category api failed",
        detail: error instanceof Error ? error.message : String(error)
      })
    );
  }
};
