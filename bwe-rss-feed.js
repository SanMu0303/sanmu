"use strict";

const { loadBweRssPayload } = require("../bwe-rss-core");

module.exports = async function handler(req, res) {
  try {
    const payload = await loadBweRssPayload();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
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
};
