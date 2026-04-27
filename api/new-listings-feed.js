"use strict";

const { loadListingFeedPayload } = require("../listing-feed-core");

module.exports = async function handler(req, res) {
  try {
    const payload = await loadListingFeedPayload();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
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
};
