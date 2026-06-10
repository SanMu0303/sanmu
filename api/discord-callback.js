"use strict";

const { handleDiscordCallback } = require("../discord-auth-core");

module.exports = async function handler(req, res) {
  try {
    const requestUrl = new URL(req.url || "/", `https://${req.headers.host || "sanmu-trading.local"}`);
    const redirectTo = await handleDiscordCallback(requestUrl);
    res.statusCode = 302;
    res.setHeader("Location", redirectTo);
    res.end();
  } catch (error) {
    res.statusCode = error.statusCode || 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      error: "discord callback failed",
      detail: error instanceof Error ? error.message : String(error)
    }));
  }
};
