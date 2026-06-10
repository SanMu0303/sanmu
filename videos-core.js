"use strict";

const fs = require("fs");
const path = require("path");

const LOCAL_VIDEOS_FILE = path.join(__dirname, "videos.json");
const LOCAL_ENV_FILES = [
  path.join(__dirname, ".env.local"),
  path.join(__dirname, ".env")
];
const DEFAULT_FILE_PATH = "videos.json";
const DEFAULT_VIDEO_CATEGORY = "视频课程";
const DEFAULT_VIDEO_CATEGORIES = ["视频课程", "技术指标", "形态分析", "交易策略", "技术模型"];

function isReadonlyServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || __dirname.startsWith("/var/task"));
}

function createPersistenceConfigError() {
  const error = new Error(
    "线上环境不能直接写入 videos.json。请在 Vercel 环境变量中配置 GITHUB_TOKEN、GITHUB_REPO、GITHUB_BRANCH 后重新部署。"
  );
  error.statusCode = 500;
  return error;
}

function loadLocalEnv() {
  for (const file of LOCAL_ENV_FILES) {
    if (!fs.existsSync(file)) continue;

    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...valueParts] = trimmed.split("=");
      const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

function normalizeVideo(video) {
  const id = String(video?.id || "").trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;
  const durationSeconds = normalizeDurationSeconds(video?.durationSeconds || video?.duration);
  const access = video?.access === "member" ? "member" : "free";

  return {
    id,
    title: String(video?.title || `YouTube 视频 ${id}`).trim(),
    category: String(video?.category || DEFAULT_VIDEO_CATEGORY).trim() || DEFAULT_VIDEO_CATEGORY,
    access,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
    createdAt: Number(video?.createdAt) || Date.now(),
    ...(durationSeconds ? {
      durationSeconds,
      duration: formatDuration(durationSeconds)
    } : {})
  };
}

function normalizeDurationSeconds(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  const text = String(value || "").trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number(text);
  if (!/^\d{1,2}(:\d{1,2}){1,2}$/.test(text)) return 0;

  const parts = text.split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return "";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainSeconds = total % 60;
  if (hours) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainSeconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainSeconds).padStart(2, "0")}`;
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractYoutubeTitle(html) {
  const metaTitle = html.match(/<meta\s+name="title"\s+content="([^"]+)"/i)?.[1];
  if (metaTitle) return decodeHtmlEntities(metaTitle).replace(/\s*-\s*YouTube\s*$/i, "").trim();

  const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1];
  if (ogTitle) return decodeHtmlEntities(ogTitle).trim();

  const pageTitle = html.match(/<title>(.*?)<\/title>/i)?.[1];
  return pageTitle ? decodeHtmlEntities(pageTitle).replace(/\s*-\s*YouTube\s*$/i, "").trim() : "";
}

async function loadYoutubeVideoMeta(id) {
  const safeId = String(id || "").trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(safeId)) return {};

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(safeId)}&hl=zh-CN`, {
    signal: controller.signal,
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
    }
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) throw new Error(`YouTube HTTP ${response.status}`);

  const html = await response.text();
  const durationSeconds = normalizeDurationSeconds(
    html.match(/"lengthSeconds"\s*:\s*"(\d+)"/)?.[1] ||
    html.match(/"lengthSeconds"\s*:\s*(\d+)/)?.[1]
  );

  return {
    title: extractYoutubeTitle(html),
    durationSeconds,
    duration: formatDuration(durationSeconds)
  };
}

async function enrichVideoMetadata(video, source = {}) {
  if (!video) return video;

  try {
    const meta = await loadYoutubeVideoMeta(video.id);
    const fallbackTitle = `YouTube 视频 ${video.id}`;
    const sourceTitle = String(source?.title || "").trim();
    return {
      ...video,
      title: sourceTitle && sourceTitle !== fallbackTitle ? sourceTitle : meta.title || video.title,
      ...(meta.durationSeconds ? {
        durationSeconds: meta.durationSeconds,
        duration: meta.duration
      } : {})
    };
  } catch (error) {
    return video;
  }
}

function normalizeStore(payload) {
  const source = Array.isArray(payload) ? payload : payload?.items;
  const items = (Array.isArray(source) ? source : [])
    .map(normalizeVideo)
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
  const managedCategories = Array.isArray(payload?.categories) ? payload.categories : DEFAULT_VIDEO_CATEGORIES;
  const categories = Array.from(
    new Set([
      DEFAULT_VIDEO_CATEGORY,
      ...managedCategories,
      ...items.map((item) => item.category)
    ].map((category) => String(category || "").trim()).filter(Boolean))
  );

  return { categories, items };
}

function getGithubConfig() {
  loadLocalEnv();

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

  if (isReadonlyServerlessRuntime()) {
    throw createPersistenceConfigError();
  }

  fs.writeFileSync(LOCAL_VIDEOS_FILE, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

function assertAdminToken(req) {
  loadLocalEnv();

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
  const baseVideo = normalizeVideo(video);
  if (!baseVideo) {
    const error = new Error("invalid YouTube video id");
    error.statusCode = 400;
    throw error;
  }
  const normalized = await enrichVideoMetadata(baseVideo, video);

  const store = await readVideoStore();
  const existing = store.items.find((item) => item.id === normalized.id);
  if (existing) {
    return store;
  }

  return writeVideoStore({ ...store, items: [normalized, ...store.items] });
}

async function deleteVideo(id) {
  const store = await readVideoStore();
  return writeVideoStore({ ...store, items: store.items.filter((item) => item.id !== id) });
}

async function addCategory(category) {
  const name = String(category || "").trim();
  if (!name) {
    const error = new Error("invalid category name");
    error.statusCode = 400;
    throw error;
  }

  const store = await readVideoStore();
  return writeVideoStore({
    ...store,
    categories: Array.from(new Set([...(store.categories || DEFAULT_VIDEO_CATEGORIES), name]))
  });
}

async function deleteCategory(category) {
  const name = String(category || "").trim();
  if (!name || name === DEFAULT_VIDEO_CATEGORY) {
    const error = new Error("default category cannot be deleted");
    error.statusCode = 400;
    throw error;
  }

  const store = await readVideoStore();
  return writeVideoStore({
    categories: (store.categories || DEFAULT_VIDEO_CATEGORIES).filter((item) => item !== name),
    items: store.items.map((item) => (item.category === name ? { ...item, category: DEFAULT_VIDEO_CATEGORY } : item))
  });
}

module.exports = {
  addCategory,
  addVideo,
  assertAdminToken,
  deleteCategory,
  deleteVideo,
  loadYoutubeVideoMeta,
  listVideos
};
