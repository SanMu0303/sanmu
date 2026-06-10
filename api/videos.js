"use strict";

const { addVideo, deleteVideo, listVideos } = require("../videos-core");
const { applyCors } = require("./cors");

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) {
    return;
  }

  try {
    let payload;

    if (req.method === "GET") {
      payload = await listVideos();
    } else if (req.method === "POST") {
      payload = await addVideo(await readJsonBody(req));
    } else if (req.method === "DELETE") {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      payload = await deleteVideo(url.searchParams.get("id") || "");
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
    res.end(JSON.stringify({ error: "video api failed", detail: error instanceof Error ? error.message : String(error) }));
  }
};
