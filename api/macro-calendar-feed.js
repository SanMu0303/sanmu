"use strict";

const { loadMacroCalendarPayload } = require("../listing-feed-core");
const { applyCors } = require("./cors");

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) {
    return;
  }

  try {
    const payload = await loadMacroCalendarPayload();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.end(JSON.stringify(payload));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error: "failed to load macro calendar feed",
        detail: error instanceof Error ? error.message : String(error)
      })
    );
  }
};
