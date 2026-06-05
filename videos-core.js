"use strict";

const fs = require("fs");
const path = require("path");

const LOCAL_VIDEOS_FILE = path.join(__dirname, "videos.json");
const DEFAULT_FILE_PATH = "videos.json";

function normalizeVideo(video) {
  const id = String(video?.id || "").trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;

  return {
    id,
    title: String(video?.title || `YouTube 视频 ${id}`).trim(),
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
    createdAt: Number(video?.createdAt) || Date.now()
  };
}

function normalizeStore(payload) {
  const source = Array.isArray(payload) ? payload : payload?.items;
  const items = (Array.isArray(source) ? source : [])
    .map(normalizeVideo)
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);

  return { items };
}

function getGithubConfig() {
  return {
    token: process.env.GITHUB_TOKEN || process.env.VIDEO_GITHUB_TOKEN || "",
    repo: process.env.GITHUB_REPO || process.env.VIDEO_GITHUB_REPO || "",
    branch: process.env.GITHUB_BRANCH || process.env.VIDEO_GITHUB_BRANCH || "main",
    filePath: process.env.VIDEOS_FILE_PATH || DEFAULT_FILE_PATH
  };
}

function hasGithubStore() {
  const config = getGithubConfig();
  return Boolean(config.token && config.repo);
}

function toBase64(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

function fromBase64(text) {
  return Buffer.from(text || "", "base64").toString("utf8");
}

function encodeGithubPath(filePath) {
  return String(filePath || DEFAULT_FILE_PATH)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function fetchGithubFile() {
  const config = getGithubConfig();
  const url = `https://api.github.com/repos/${config.repo}/contents/${encodeGithubPath(config.filePath)}?ref=${encodeURIComponent(config.branch)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "User-Agent": "sanmu-trading-dashboard/1.0",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (response.status === 404) {
    return { store: { items: [] }, sha: "" };
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || `GitHub contents HTTP ${response.status}`);
  }

  return {
    store: normalizeStore(JSON.parse(fromBase64(payload.content || ""))),
    sha: payload.sha || ""
  };
}

async function saveGithubFile(store, sha) {
  const config = getGithubConfig();
  const url = `https://api.github.com/repos/${config.repo}/contents/${encodeGithubPath(config.filePath)}`;
  const body = {
    message: "Update video library",
    branch: config.branch,
    content: toBase64(`${JSON.stringify(store, null, 2)}\n`)
  };
  if (sha) body.sha = sha;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "User-Agent": "sanmu-trading-dashboard/1.0",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || `GitHub update HTTP ${response.status}`);
  }

  return store;
}

async function readVideoStore() {
  if (hasGithubStore()) {
    return (await fetchGithubFile()).store;
  }

  if (!fs.existsSync(LOCAL_VIDEOS_FILE)) {
    return { items: [] };
  }

  return normalizeStore(JSON.parse(fs.readFileSync(LOCAL_VIDEOS_FILE, "utf8")));
}

async function writeVideoStore(store) {
  const normalized = normalizeStore(store);

  if (hasGithubStore()) {
    const current = await fetchGithubFile();
    return saveGithubFile(normalized, current.sha);
  }

  fs.writeFileSync(LOCAL_VIDEOS_FILE, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

function assertAdminToken(req) {
  const required = process.env.VIDEO_ADMIN_TOKEN || "";
  if (!required) return;

  const headerToken = req.headers["x-admin-token"] || "";
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (headerToken !== required && bearer !== required) {
    const error = new Error("invalid admin token");
    error.statusCode = 401;
    throw error;
  }
}

async function listVideos() {
  return readVideoStore();
}

async function addVideo(video) {
  const normalized = normalizeVideo(video);
  if (!normalized) {
    const error = new Error("invalid YouTube video id");
    error.statusCode = 400;
    throw error;
  }

  const store = await readVideoStore();
  const existing = store.items.find((item) => item.id === normalized.id);
  if (existing) {
    return store;
  }

  return writeVideoStore({ items: [normalized, ...store.items] });
}

async function deleteVideo(id) {
  const store = await readVideoStore();
  return writeVideoStore({ items: store.items.filter((item) => item.id !== id) });
}

module.exports = {
  addVideo,
  assertAdminToken,
  deleteVideo,
  listVideos
};
