"use strict";

const { loadBlockBeatsPayload } = require("../blockbeats-core");

module.exports = async function handler(req, res) {
  try {
    const payload = await loadBlockBeatsPayload();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
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
};
