"use strict";

const vm = require("vm");

const BLOCKBEATS_PAGE_URL = "https://www.theblockbeats.info/newsflash";
const BLOCKBEATS_FLASH_URLS = [
  "https://api.theblockbeats.news/v1/open-api/open-flash?size=50&page=1&type=0&lang=cn",
  "https://api.theblockbeats.news/v1/open-api/open-flash?size=50&page=1&type=1&lang=cn",
  "https://api.theblockbeats.news/v1/open-api/open-flash?size=50&page=1&type=&lang=cn",
  "https://api.theblockbeats.news/v1/open-api/open-flash?size=50&page=1&type=push&lang=cn",
  "https://api.theblockbeats.news/v1/open-api/open-flash?size=50&page=1&lang=cn"
];
const BLOCKBEATS_RSS_URLS = [
  "https://api.theblockbeats.news/v2/rss/all",
  "https://api.theblockbeats.news/v2/rss/newsflash",
  "https://api.theblockbeats.news/v2/rss/article",
  "https://api.theblockbeats.news/v1/open-api/home-xml"
];
const BLOCKBEATS_TIMEOUT_MS = 6000;

async function loadBlockBeatsPayload() {
  const flashItems = await fetchFirstAvailableFlash();
  if (flashItems.length) {
    return {
      source: "blockbeats-flash",
      sourceStatus: {
        BlockBeats: "ok"
      },
      items: flashItems
    };
  }

  const rssItems = await fetchFirstAvailableRssItems();
  if (rssItems.length) {
    return {
      source: "blockbeats-rss",
      sourceStatus: {
        BlockBeats: "ok"
      },
      items: rssItems
    };
  }

  const pageItems = await fetchBlockBeatsPageItems();

  return {
    source: "blockbeats-page",
    sourceStatus: {
      BlockBeats: pageItems.length ? "ok" : "failed"
    },
    items: pageItems
  };
}

async function loadBlockBeatsMacroCalendarPayload() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BLOCKBEATS_TIMEOUT_MS);

  try {
    const response = await fetch(BLOCKBEATS_PAGE_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html"
      }
    });

    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }

    const html = await response.text();
    const items = extractNuxtCalendarItems(html);
    return {
      source: "blockbeats-calendar",
      sourceStatus: {
        BlockBeatsCalendar: items.length ? "ok" : "failed"
      },
      items
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchFirstAvailableFlash() {
  const errors = [];

  for (const url of BLOCKBEATS_FLASH_URLS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BLOCKBEATS_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json",
          language: "cn"
        }
      });

      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }

      const payload = await response.json();
      const rawItems = extractFlashItems(payload);
      const items = rawItems
        .map((item) => ({
          title: normalizeText(item?.title || "律动快讯"),
          summary: truncateText(normalizeText(item?.content || item?.description || ""), 90),
          link: item?.link || item?.url || "https://www.theblockbeats.info",
          publishTime: Number(item?.create_time || 0) ? Number(item.create_time) * 1000 : Date.now(),
          sourceTag: "BB"
        }))
        .filter((item) => item.title)
        .sort((a, b) => Number(b.publishTime || 0) - Number(a.publishTime || 0));

      if (items.length) {
        return items;
      }

      throw new Error("flash contains no item");
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return [];
}

async function fetchFirstAvailableRssItems() {
  try {
    const xml = await fetchFirstAvailableRss();
    return parseRssItems(xml)
      .map((item) => ({
        title: normalizeText(item.title || "律动快讯"),
        summary: truncateText(normalizeText(item.description || ""), 90),
        link: item.link || item.guid || "https://www.theblockbeats.info",
        publishTime: item.pubDate ? Date.parse(item.pubDate) : Date.now(),
        sourceTag: "BB"
      }))
      .sort((a, b) => Number(b.publishTime || 0) - Number(a.publishTime || 0))
      .slice(0, 80);
  } catch (error) {
    return [];
  }
}

async function fetchBlockBeatsPageItems() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BLOCKBEATS_TIMEOUT_MS);

  try {
    const response = await fetch(BLOCKBEATS_PAGE_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html"
      }
    });

    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }

    const html = await response.text();
    return extractNuxtFlashItems(html);
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractNuxtFlashItems(html) {
  const nuxt = extractNuxtPayload(html);
  if (!nuxt) {
    return [];
  }

  const rawItems = [];
  collectFlashLikeItems(nuxt, rawItems);

  return rawItems
    .map((item) => ({
      title: normalizeText(item.title || "律动快讯"),
      summary: truncateText(normalizeText(stripHtml(item.content || item.abstract || "")), 90),
      link: item.article_id ? `https://www.theblockbeats.info/flash/${item.article_id}` : "https://www.theblockbeats.info/newsflash",
      publishTime: Number(item.add_time || 0) ? Number(item.add_time) * 1000 : Date.now(),
      sourceTag: "BB"
    }))
    .filter((item) => item.title)
    .reduce((items, item) => {
      const key = `${normalizeText(item.title).toLowerCase()}-${Math.floor(Number(item.publishTime || 0) / 60000)}`;
      const existingIndex = items.findIndex((current) => current.dedupeKey === key);
      const nextItem = { ...item, dedupeKey: key };
      if (existingIndex === -1) {
        items.push(nextItem);
        return items;
      }

      const existing = items[existingIndex];
      if (String(nextItem.summary || "").length > String(existing.summary || "").length) {
        items[existingIndex] = nextItem;
      }
      return items;
    }, [])
    .sort((a, b) => Number(b.publishTime || 0) - Number(a.publishTime || 0))
    .slice(0, 80)
    .map(({ dedupeKey, ...item }) => item);
}

function extractNuxtCalendarItems(html) {
  const nuxt = extractNuxtPayload(html);
  if (!nuxt) {
    return [];
  }

  const rawItems = [];
  collectCalendarLikeItems(nuxt, rawItems);

  return rawItems
    .map((item) => {
      const timestamp = parseCalendarTimestamp(item);
      return {
        title: normalizeText(item.event_title || item.title || item.name || "宏观事件"),
        eventTime: timestamp || Date.now(),
        timeText: formatCalendarTime(timestamp || Date.now()),
        dateText: formatCalendarDate(timestamp || Date.now()),
        importance: item.importance || item.level || item.star || item.is_hot || "",
        sourceTag: "BB",
        link: item.url || item.link || "https://www.theblockbeats.info/newsflash"
      };
    })
    .filter((item) => item.title)
    .reduce((items, item) => {
      const key = `${normalizeText(item.title).toLowerCase()}-${Math.floor(Number(item.eventTime || 0) / 60000)}`;
      if (!items.some((current) => current.dedupeKey === key)) {
        items.push({ ...item, dedupeKey: key });
      }
      return items;
    }, [])
    .sort((a, b) => Number(a.eventTime || 0) - Number(b.eventTime || 0))
    .slice(0, 12)
    .map(({ dedupeKey, ...item }) => item);
}

function extractNuxtPayload(html) {
  const match = String(html || "").match(/window\.__NUXT__=\(function[\s\S]*?\);\s*<\/script>/);
  if (!match) {
    return null;
  }

  const script = match[0].replace(/<\/script>$/, "");
  const sandbox = { window: {} };
  vm.runInNewContext(script, sandbox, { timeout: 1000 });
  return sandbox.window.__NUXT__;
}

function collectFlashLikeItems(value, output) {
  if (!value || output.length > 200) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object" && typeof item.title === "string" && (item.article_id || item.add_time)) {
        output.push(item);
      }
      collectFlashLikeItems(item, output);
    }
    return;
  }

  if (typeof value === "object") {
    for (const child of Object.values(value)) {
      collectFlashLikeItems(child, output);
    }
  }
}

function collectCalendarLikeItems(value, output) {
  if (!value || output.length > 100) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object" && typeof item.event_title === "string") {
        output.push(item);
      }
      collectCalendarLikeItems(item, output);
    }
    return;
  }

  if (typeof value === "object") {
    for (const child of Object.values(value)) {
      collectCalendarLikeItems(child, output);
    }
  }
}

function extractFlashItems(payload) {
  const candidates = [
    payload?.data?.data,
    payload?.data?.list,
    payload?.data?.items,
    payload?.data?.flash,
    payload?.data
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

async function fetchFirstAvailableRss() {
  const errors = [];

  for (const url of BLOCKBEATS_RSS_URLS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BLOCKBEATS_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/rss+xml, application/xml, text/xml",
          language: "cn"
        }
      });

      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }

      const xml = await response.text();
      if (/<item\b/i.test(xml)) {
        return xml;
      }

      throw new Error("rss contains no item");
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error(errors.join("; "));
}

function parseRssItems(xml) {
  const matches = [...String(xml || "").matchAll(/<item\b[\s\S]*?<\/item>/gi)];
  return matches.map((match) => {
    const block = match[0] || "";
    return {
      title: decodeXml(getTagValue(block, "title")),
      description: normalizeText(stripCdata(decodeXml(getTagValue(block, "description")))),
      link: decodeXml(getTagValue(block, "link")),
      guid: decodeXml(getTagValue(block, "guid")),
      pubDate: decodeXml(getTagValue(block, "pubDate"))
    };
  });
}

function getTagValue(block, tag) {
  const match = String(block).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

function stripCdata(value) {
  return String(value || "").replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function stripHtml(value) {
  return decodeXml(value).replace(/\s+/g, " ").trim();
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function parseCalendarTimestamp(item) {
  const candidates = [
    item?.event_time,
    item?.start_time,
    item?.start_date,
    item?.date_time,
    item?.date,
    item?.time,
    item?.publish_time
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") {
      continue;
    }

    if (typeof candidate === "number") {
      return candidate > 100000000000 ? candidate : candidate * 1000;
    }

    const parsed = Date.parse(String(candidate).replace(/-/g, "/"));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function formatCalendarDate(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(timestamp));
}

function formatCalendarTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(timestamp));
}

module.exports = {
  loadBlockBeatsPayload,
  loadBlockBeatsMacroCalendarPayload
};
