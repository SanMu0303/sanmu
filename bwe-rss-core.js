"use strict";

const BWE_RSS_URL = "https://rss-public.bwe-ws.com/";

async function loadBweRssPayload() {
  const response = await fetch(BWE_RSS_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/rss+xml, application/xml, text/xml"
    }
  });

  if (!response.ok) {
    throw new Error(`bwe rss request failed: ${response.status}`);
  }

  const xml = await response.text();
  const items = parseRssItems(xml)
    .slice(0, 240)
    .map((item) => {
      const layered = buildLayeredFeedContent(item.title || "", item.description || "", item.link || "#");
      return {
        primary: layered.primary,
        secondary: layered.secondary,
        metaLines: layered.metaLines,
        sourceLabel: layered.sourceLabel,
        sourceLink: layered.sourceLink,
        link: item.link || "#",
        publishTime: item.pubDate ? Date.parse(item.pubDate) : Date.now()
      };
    })
    .sort((a, b) => Number(b.publishTime || 0) - Number(a.publishTime || 0));

  return {
    source: "bwe-rss",
    sourceStatus: {
      BWEnews: "ok"
    },
    items
  };
}

function parseRssItems(xml) {
  const matches = [...String(xml || "").matchAll(/<item\b[\s\S]*?<\/item>/gi)];
  return matches.map((match) => {
    const block = match[0] || "";
    return {
      title: decodeXmlPreserveLines(getTagValue(block, "title")),
      link: decodeXml(getTagValue(block, "link")),
      pubDate: decodeXml(getTagValue(block, "pubDate")),
      description: normalizeMultilineText(stripCdata(decodeXml(getTagValue(block, "description"))))
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

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeMultilineText(value) {
  return String(value || "")
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join("\n");
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function decodeXmlPreserveLines(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function cleanFeedLine(value, maxLength = 96) {
  const text = normalizeText(value)
    .replace(/点击查看.*$/g, "")
    .replace(/阅读更多.*$/g, "")
    .replace(/^source:\s*/i, "source: ");

  return truncateText(text, maxLength);
}

function buildLayeredFeedContent(titleValue, descriptionValue, fallbackLink) {
  const rawTitleLines = String(titleValue || "")
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .filter((line) => line !== "————————————");

  const rawDescriptionLines = String(descriptionValue || "")
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);

  const combinedLines = [...rawTitleLines, ...rawDescriptionLines];
  let sourceLink = fallbackLink || "#";
  const contentLines = [];
  let timestampLine = "";

  combinedLines.forEach((line) => {
    if (/^source:\s*/i.test(line)) {
      sourceLink = line.replace(/^source:\s*/i, "").trim() || sourceLink;
      return;
    }

    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(line)) {
      timestampLine = line;
      return;
    }

    contentLines.push(line);
  });

  const primary = truncateText(contentLines[0] || "未命名事件", 88);
  const secondary = contentLines[1] ? truncateText(contentLines[1], 88) : "";
  const metaLines = contentLines
    .slice(2)
    .map((line) => cleanFeedLine(line, 110))
    .filter(Boolean)
    .slice(0, 2);

  if (timestampLine) {
    metaLines.push(timestampLine);
  }

  if (sourceLink && sourceLink !== fallbackLink) {
    metaLines.push(`source: ${sourceLink}`);
  }

  return {
    primary,
    secondary,
    metaLines,
    sourceLabel: "BWE",
    sourceLink
  };
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

module.exports = {
  loadBweRssPayload
};
