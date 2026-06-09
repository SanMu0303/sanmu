const DASHBOARD_REFRESH_MS = 30000;
const LISTING_REFRESH_MS = 30000;
const HOT_FEED_REFRESH_MS = 30000;
const SECTOR_FEED_REFRESH_MS = 60000;
const MACRO_CALENDAR_REFRESH_MS = 300000;
const FRESH_NEWS_WINDOW_MS = 5 * 60 * 1000;
const ALERT_REPEAT_SUPPRESS_MS = 60 * 60 * 1000;
const CHART_POLL_REFRESH_MS = 5000;
const REQUEST_TIMEOUT_MS = 8000;
const KLINE_CONCURRENCY = 6;
const MIN_24H_QUOTE_VOLUME = 10000000;
const MIN_VOLUME_ALERT_QUOTE_VOLUME = 500000;
const PERIODS = {
  p5m: "5m",
  p15m: "15m",
  p24h: "1d"
};

const CHAIN_MAP = {
  ADA: "Cardano",
  APE: "Ethereum",
  ARB: "Arbitrum",
  AVAX: "Avalanche",
  BNB: "BNB Chain",
  BTC: "Bitcoin",
  DOGE: "Dogecoin",
  DOT: "Polkadot",
  ENA: "Ethereum",
  ETH: "Ethereum",
  FIL: "Filecoin",
  INJ: "Injective",
  LINK: "Ethereum",
  LTC: "Litecoin",
  OP: "Optimism",
  PEPE: "Ethereum",
  SAND: "Ethereum",
  SEI: "Sei",
  SOL: "Solana",
  SUI: "Sui",
  TON: "TON",
  TRX: "TRON",
  UNI: "Ethereum",
  WLD: "Optimism",
  XRP: "XRP Ledger"
};

const refreshButton = document.getElementById("refreshButton");
const themeToggleButton = document.getElementById("themeToggleButton");
const refreshStateNode = document.getElementById("refreshState");
const updateTimeNode = document.getElementById("updateTime");
const fetchStatusNode = document.getElementById("fetchStatus");
const tradingviewPanel = document.getElementById("tradingviewPanel");
const volumeTopStrip = document.getElementById("volumeTopStrip");
const heatTitle = document.getElementById("heatTitle");
const moversTitle = document.getElementById("moversTitle");
const moversTable = document.getElementById("moversTable");
const fundingTitle = document.getElementById("fundingTitle");
const fundingTable = document.getElementById("fundingTable");
const marketListTable = document.getElementById("marketListTable");
const marketListStatus = document.getElementById("marketListStatus");
const volumeAlertList = document.getElementById("volumeAlertList");
const shockHistoryList = document.getElementById("shockHistoryList");
const volumeHistoryList = document.getElementById("volumeHistoryList");
const hotEventFeed = document.getElementById("hotEventFeed");
const listingFeed = document.getElementById("listingFeed");
const reserveFeed = document.getElementById("reserveFeed");
const sectorFeed = document.getElementById("sectorFeed");
const newsHubFeed = document.getElementById("newsHubFeed");
const macroCalendarFeed = document.getElementById("macroCalendarFeed");
const bweStatusBar = document.getElementById("bweStatusBar");
const jin10StatusBar = document.getElementById("jin10StatusBar");
const binanceNewsStatusBar = document.getElementById("binanceNewsStatusBar");
const sectorStatusBar = document.getElementById("sectorStatusBar");
const newsHubStatusBar = document.getElementById("newsHubStatusBar");
const macroCalendarStatusBar = document.getElementById("macroCalendarStatusBar");
const SHOCK_HISTORY_KEY = "dashboard_shock_history_v1";
const VOLUME_HISTORY_KEY = "dashboard_volume_history_v1";
const THEME_STORAGE_KEY = "dashboard_theme_mode_v1";
const HEAT_SCORE_STORAGE_KEY = "dashboard_heat_score_state_v1";
const HEAT_SCORE_SMOOTHING = 0.32;
const HEAT_SCORE_MAX_STEP = 4;
const HEAT_SCORE_STORAGE_LIMIT = 260;
const HEAT_WEIGHTS = {
  trend: 0.22,
  volume: 0.17,
  move: 0.14,
  listing: 0.05,
  socialHype: 0.13,
  smartMoney: 0.10,
  meme: 0.07,
  x: 0.07,
  square: 0.05
};
const MAX_NEGATIVE_FUNDING_BONUS = 8;
const NEGATIVE_FUNDING_FULL_BONUS_RATE_PCT = 0.05;
const state = {
  rows: [],
  selectedChartSymbol: "",
  selectedChartInterval: "15m",
  chart: null,
  candleSeries: null,
  volumeSeries: null,
  currentCandleOpenTime: 0,
  latestChartPrice: null,
  symbolMetaMap: new Map(),
  chartRefreshTimer: null,
  chartWatchdogTimer: null,
  chartRequestId: 0,
  chartSocket: null,
  chartSocketKey: "",
  chartLastMessageAt: 0,
  newsItems: [],
  newsStatus: "idle",
  listingItems: [],
  listingStatus: "idle",
  listingUpdatedAt: "",
  reserveItems: [],
  reserveStatus: "idle",
  reserveUpdatedAt: "",
  sectorItems: [],
  sectorStatus: "idle",
  sectorUpdatedAt: "",
  macroCalendarItems: [],
  macroCalendarStatus: "idle",
  macroCalendarUpdatedAt: "",
  dashboardRefreshTimer: null,
  listingRefreshTimer: null,
  hotFeedRefreshTimer: null,
  reserveFeedRefreshTimer: null,
  sectorFeedRefreshTimer: null,
  macroCalendarRefreshTimer: null,
  clockTimer: null,
  freshNewsTimer: null,
  dashboardLoading: false,
  heatScoreMap: loadHeatScoreState(),
  heatMode: "default",
  newsHubMode: "all",
  heatBoards: {
    default: [],
    combined: [],
    contracts: [],
    onchain: []
  },
  moversMode: "gainers",
  moversGainers: [],
  moversLosers: [],
  fundingMode: "negative",
  positiveFunding: [],
  negativeFunding: [],
  marketSort: {
    key: "quoteVolume",
    direction: "desc"
  },
  marketLongMetrics: new Map(),
  marketLongMetricsLoading: false,
  localBinanceProxyFailed: false,
  activeShockSymbols: new Set(),
  activeVolumeSymbols: new Set()
};

function setStatus(text) {
  fetchStatusNode.textContent = text;
}

function setRefreshState(text) {
  if (refreshStateNode) {
    refreshStateNode.textContent = text;
  }
}

function getCurrentTheme() {
  if (window.SanmuTheme) {
    return window.SanmuTheme.get();
  }
  return document.documentElement.classList.contains("theme-dark") || document.body.classList.contains("theme-dark")
    ? "dark"
    : "light";
}

function updateThemeToggleLabel() {
  if (!themeToggleButton) {
    return;
  }
  const isDark = getCurrentTheme() === "dark";
  themeToggleButton.textContent = isDark ? "☀" : "☾";
  themeToggleButton.setAttribute("aria-label", isDark ? "切换到亮色模式" : "切换到暗色模式");
  themeToggleButton.setAttribute("title", isDark ? "切换到亮色模式" : "切换到暗色模式");
}

function applyTheme(theme) {
  if (window.SanmuTheme) {
    window.SanmuTheme.apply(theme);
  } else {
    document.documentElement.classList.toggle("theme-dark", theme === "dark");
    document.body.classList.toggle("theme-dark", theme === "dark");
    updateThemeToggleLabel();
  }

  applyChartTheme(theme);
}

function applyChartTheme(theme) {
  if (state.chart) {
    const isDark = theme === "dark";
    state.chart.applyOptions({
      layout: {
        background: { type: window.LightweightCharts.ColorType.Solid, color: isDark ? "#172133" : "#ffffff" },
        textColor: isDark ? "#c7d2e5" : "#475569"
      },
      grid: {
        vertLines: { color: isDark ? "#243146" : "#eef2f7" },
        horzLines: { color: isDark ? "#243146" : "#eef2f7" }
      },
      rightPriceScale: {
        borderColor: isDark ? "#314158" : "#e7ebf3"
      },
      timeScale: {
        borderColor: isDark ? "#314158" : "#e7ebf3",
        timeVisible: true
      }
    });
  } else if (state.selectedChartSymbol && tradingviewPanel?.querySelector(".tv-tradingview-embed")) {
    const matchedRow = state.rows.find((row) => row.symbol === state.selectedChartSymbol);
    if (matchedRow) {
      renderTradingViewChart(matchedRow);
    }
  }
}

function initializeTheme() {
  if (window.SanmuTheme) {
    applyChartTheme(window.SanmuTheme.get());
    window.SanmuTheme.onChange(applyChartTheme);
    return;
  }

  let savedTheme = "light";
  try {
    savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY) || "light";
  } catch (error) {
    savedTheme = "light";
  }
  applyTheme(savedTheme === "dark" ? "dark" : "light");
}

function updateTime() {
  const now = new Date();
  updateTimeNode.textContent = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(
    now.getDate()
  ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(
    2,
    "0"
  )}:${String(now.getSeconds()).padStart(2, "0")}`;
}

function startClock() {
  updateTime();

  if (state.clockTimer) {
    window.clearInterval(state.clockTimer);
  }

  state.clockTimer = window.setInterval(() => {
    if (!document.hidden) {
      updateTime();
    }
  }, 1000);
}

function formatTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(
    date.getSeconds()
  ).padStart(2, "0")}`;
}

function formatShortDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(
    date.getHours()
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function getUtc8DateFromSeconds(seconds) {
  return new Date(Number(seconds) * 1000 + 8 * 60 * 60 * 1000);
}

function formatChartTimeUtc8(time) {
  const date = getUtc8DateFromSeconds(time);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function formatChartTickUtc8(time, interval) {
  const date = getUtc8DateFromSeconds(time);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  if (interval === "1d") {
    return `${month}/${day}`;
  }

  if (interval === "4h" || interval === "1h") {
    return `${month}/${day} ${hours}:00`;
  }

  return `${hours}:${minutes}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatFundingInterval(hours) {
  if (!Number.isFinite(hours) || hours <= 0) {
    return "8H";
  }
  return `${hours}H`;
}

function formatPrice(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const digits = value >= 1000 ? 2 : value >= 1 ? 4 : 6;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits
  })}`;
}

function getTickSizeMeta(symbol) {
  return state.symbolMetaMap.get(symbol) || null;
}

function getPriceFormatConfig(symbol) {
  const tickMeta = getTickSizeMeta(symbol);
  const tickSizeRaw = tickMeta?.tickSizeRaw || "";
  const tickSize = Number(tickMeta?.tickSize || 0);
  if (!Number.isFinite(tickSize) || tickSize <= 0) {
    return {
      precision: 4,
      minMove: 0.0001
    };
  }

  const normalized = tickSizeRaw || tickSize.toString();
  const decimalPart = normalized.includes(".") ? normalized.split(".")[1].replace(/0+$/, "") : "";
  const precision = decimalPart.length;

  return {
    precision,
    minMove: tickSize
  };
}

function formatChartAxisPrice(symbol, value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  const { precision } = getPriceFormatConfig(symbol);
  return value.toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
    useGrouping: false
  });
}

function formatPercent(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function formatCompact(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: digits
  }).format(value);
}

function formatMarketCap(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "--";
  return formatCompact(num);
}

function formatCompactKMB(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (absValue >= 1e9) {
    return `${sign}${(absValue / 1e9).toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")}B`;
  }
  if (absValue >= 1e6) {
    return `${sign}${(absValue / 1e6).toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")}M`;
  }
  if (absValue >= 1e3) {
    return `${sign}${(absValue / 1e3).toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")}K`;
  }

  return `${sign}${absValue.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")}`;
}

function formatSectorMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) {
    return "--";
  }
  return `$${formatCompactKMB(number, 2)}`;
}

function formatFunding(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(4)}%`;
}

function annualizeFunding(rate) {
  if (!Number.isFinite(rate)) {
    return "--";
  }
  return `${(rate * 3 * 365 * 100).toFixed(2)}%`;
}

function getDeltaClass(value) {
  if (!Number.isFinite(value)) {
    return "";
  }
  return value >= 0 ? "up" : "down";
}

function getVolumeMultipleClass(value) {
  if (!Number.isFinite(value)) {
    return "";
  }
  if (value >= 10) {
    return "alert-red";
  }
  if (value >= 5) {
    return "alert-amber";
  }
  if (value >= 3) {
    return "up";
  }
  return "";
}

function getChainName(baseAsset) {
  return CHAIN_MAP[baseAsset] || "Unknown";
}

function getTradingViewPageUrl(symbol) {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`BINANCE:${symbol}.P`)}`;
}

function getTradingViewWidgetSymbol(symbol) {
  const cleaned = String(symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned ? `BINANCE:${cleaned}.P` : "BINANCE:BTCUSDT.P";
}

function getTradingViewWidgetTheme() {
  return getCurrentTheme() === "dark" ? "dark" : "light";
}

function getIntervalDurationMs(interval) {
  const intervalMap = {
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000
  };
  return intervalMap[interval] || 15 * 60 * 1000;
}

function formatCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "00:00";
  }

  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getHeatScore(row) {
  const volumeScore = Math.min(Math.max(Math.log10(Math.max(row.quoteVolume, 1)) * 12, 0), 100);
  const momentumScore = Math.min(Math.max((row.change24h + 10) * 4, 0), 100);
  const shortTermScore = Math.min(Math.max(Math.abs(row.change15m) * 10, 0), 100);
  return Math.round(volumeScore * 0.4 + momentumScore * 0.35 + shortTermScore * 0.25);
}

function loadHeatScoreState() {
  try {
    const raw = window.localStorage.getItem(HEAT_SCORE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? new Map(Object.entries(parsed)) : new Map();
  } catch (error) {
    return new Map();
  }
}

function saveHeatScoreState(rows) {
  try {
    const payload = {};
    rows
      .slice()
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, HEAT_SCORE_STORAGE_LIMIT)
      .forEach((row) => {
        payload[row.symbol] = {
          score: row.heatScore,
          updatedAt: Date.now()
        };
      });
    window.localStorage.setItem(HEAT_SCORE_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error("save heat score state failed", error);
  }
}

function getStableHeatScore(row) {
  const rawScore = getHeatScore(row);
  const previous = state.heatScoreMap.get(row.symbol);
  const previousScore = Number(previous?.score);

  if (!Number.isFinite(previousScore)) {
    return rawScore;
  }

  const blendedScore = previousScore + (rawScore - previousScore) * HEAT_SCORE_SMOOTHING;
  const limitedDelta = Math.max(-HEAT_SCORE_MAX_STEP, Math.min(HEAT_SCORE_MAX_STEP, blendedScore - previousScore));
  return Math.round(Math.max(0, Math.min(100, previousScore + limitedDelta)));
}

function percentileScore(sortedValues, value) {
  if (!sortedValues.length) {
    return 0;
  }

  let low = 0;
  let high = sortedValues.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sortedValues[mid] <= value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low / sortedValues.length;
}

function contractNegativeFundingBonus(fundingRate) {
  const rate = Number(fundingRate || 0);
  if (rate >= 0) {
    return 0;
  }

  const fundingRatePct = Math.abs(rate) * 100;
  const scaled = Math.min(fundingRatePct / NEGATIVE_FUNDING_FULL_BONUS_RATE_PCT, 1);
  return scaled * MAX_NEGATIVE_FUNDING_BONUS;
}

function computeWeightedHeatScore(metrics) {
  return Math.round(
    Math.max(
      0,
      Math.min(
        100,
        100 *
          (HEAT_WEIGHTS.trend * metrics.trendScore +
            HEAT_WEIGHTS.volume * metrics.volumeScore +
            HEAT_WEIGHTS.move * metrics.moveScore +
            HEAT_WEIGHTS.listing * metrics.listingScore +
            HEAT_WEIGHTS.socialHype * metrics.socialHypeScore +
            HEAT_WEIGHTS.smartMoney * metrics.smartMoneyScore +
            HEAT_WEIGHTS.meme * metrics.memeScore +
            HEAT_WEIGHTS.x * metrics.xScore +
            HEAT_WEIGHTS.square * metrics.squareScore)
      )
    )
  );
}

function buildHeatBoards(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const volumeValues = sourceRows.map((row) => Number(row.quoteVolume || 0)).sort((a, b) => a - b);
  const moveValues = sourceRows.map((row) => Math.abs(Number(row.change24h || 0))).sort((a, b) => a - b);
  const shortMoveValues = sourceRows.map((row) => Math.abs(Number(row.change15m || 0))).sort((a, b) => a - b);
  const volumeMultipleValues = sourceRows.map((row) => Number(row.volumeMultiple || 0)).sort((a, b) => a - b);

  const enrichedRows = sourceRows.map((row) => {
    const volumeScore = percentileScore(volumeValues, Number(row.quoteVolume || 0));
    const moveScore = percentileScore(moveValues, Math.abs(Number(row.change24h || 0)));
    const shortMoveScore = percentileScore(shortMoveValues, Math.abs(Number(row.change15m || 0)));
    const volumeMultipleScore = percentileScore(volumeMultipleValues, Number(row.volumeMultiple || 0));
    const trendScore = Math.max(0, Math.min(1, (Number(row.change24h || 0) + 20) / 60));
    const listingScore = Math.min(Number(row.listingMentions || 0) / 3, 1);
    const socialHypeScore = Number(row.socialHype || 0) || shortMoveScore;
    const smartMoneyScore = Number(row.smartMoney || 0) || volumeMultipleScore;
    const memeScore = Number(row.memeRush || 0) || Math.max(0, Math.min(1, Math.abs(Number(row.change24h || 0)) / 80));
    const xScore = Number(row.xScore || 0);
    const squareScore = Number(row.squareScore || 0);
    const combinedScore = computeWeightedHeatScore({
      trendScore,
      volumeScore,
      moveScore,
      listingScore,
      socialHypeScore,
      smartMoneyScore,
      memeScore,
      xScore,
      squareScore
    });
    const contractScore = Math.round(Math.min(100, combinedScore + contractNegativeFundingBonus(row.fundingRate)));
    const onchainScore = Math.round(
      Math.max(
        0,
        Math.min(
          100,
          100 *
            (0.2 * trendScore +
              0.13 * volumeScore +
              0.18 * moveScore +
              0.18 * shortMoveScore +
              0.16 * socialHypeScore +
              0.1 * smartMoneyScore +
              0.05 * memeScore)
        )
      )
    );

    return {
      ...row,
      combinedHeatScore: combinedScore,
      contractHeatScore: contractScore,
      onchainHeatScore: onchainScore
    };
  });

  return {
    default: [...enrichedRows].sort((a, b) => b.heatScore - a.heatScore || b.quoteVolume - a.quoteVolume).slice(0, 10),
    combined: [...enrichedRows]
      .map((row) => ({ ...row, heatScore: row.combinedHeatScore }))
      .sort((a, b) => b.heatScore - a.heatScore || b.quoteVolume - a.quoteVolume)
      .slice(0, 10),
    contracts: [...enrichedRows]
      .map((row) => ({ ...row, heatScore: row.contractHeatScore }))
      .sort((a, b) => b.heatScore - a.heatScore || b.quoteVolume - a.quoteVolume)
      .slice(0, 10),
    onchain: [...enrichedRows]
      .map((row) => ({ ...row, heatScore: row.onchainHeatScore }))
      .sort((a, b) => b.heatScore - a.heatScore || b.quoteVolume - a.quoteVolume)
      .slice(0, 10)
  };
}

function isFreshNews(publishTime) {
  const timestamp = Number(publishTime || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return false;
  }
  return Date.now() - timestamp <= FRESH_NEWS_WINDOW_MS;
}

function getFreshNewsClass(publishTime) {
  return isFreshNews(publishTime) ? " feed-item--fresh" : "";
}

async function fetchJson(path, options = {}) {
  const { retries = 1, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  let lastError = null;
  const endpoints = getBinanceApiEndpoints(path);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    for (const endpoint of endpoints) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        window.clearTimeout(timer);

        if (!response.ok) {
          throw new Error(`请求失败: ${response.status}`);
        }
        return response.json();
      } catch (error) {
        window.clearTimeout(timer);
        lastError = error;
        if (endpoint.startsWith("http://127.0.0.1:8787")) {
          state.localBinanceProxyFailed = true;
        }
      }
    }

    if (attempt < retries) {
      await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
    }
  }

  throw lastError || new Error("请求失败");
}

function getBinanceApiEndpoints(path) {
  const isLocalPage =
    window.location.protocol === "file:" || ["127.0.0.1", "localhost"].includes(window.location.hostname);
  const proxyPath = `/api/binance-proxy?path=${encodeURIComponent(path)}`;
  const apiOrigin = getConfiguredApiOrigin();
  const endpoints = [];

  if (isLocalPage) {
    if (!state.localBinanceProxyFailed) endpoints.push(`http://127.0.0.1:8787${proxyPath}`);
    if (apiOrigin) endpoints.push(`${apiOrigin}${proxyPath}`);
    return endpoints;
  }

  endpoints.push(apiOrigin ? `${apiOrigin}${proxyPath}` : proxyPath);
  return endpoints;
}

function getBinanceApiEndpoint(path) {
  return getBinanceApiEndpoints(path)[0];
}

function getConfiguredApiOrigin() {
  const origin = window.DASHBOARD_CONFIG?.apiOrigin;
  if (typeof origin !== "string" || !origin.trim()) {
    return "";
  }
  return origin.trim().replace(/\/+$/, "");
}

function getBinanceFailureHint() {
  const isLocalFile = window.location.protocol === "file:";
  const isGithubPages = window.location.hostname.endsWith(".github.io");
  const apiOrigin = getConfiguredApiOrigin();

  if (isLocalFile) {
    return "本地 file:// 页面需要保持 127.0.0.1:8787 本地 API 服务运行。";
  }

  if (isGithubPages && !apiOrigin) {
    return "GitHub Pages 不能运行 /api 后端，请在 config.js 填写 Vercel API 域名，或直接访问 Vercel 部署地址。";
  }

  return "请检查 Vercel /api/binance-proxy 是否部署成功，或币安上游接口是否可访问。";
}

async function fetchJsonOrDefault(path, fallbackValue, options = {}) {
  try {
    return await fetchJson(path, options);
  } catch (error) {
    console.error(`optional request failed: ${path}`, error);
    return fallbackValue;
  }
}

async function fetchKlineChange(symbol, interval) {
  const klines = await fetchJson(`/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=2`, { retries: 1 });
  const previousOpen = Number(klines[0]?.[1]);
  const latestClose = Number(klines[1]?.[4] ?? klines[0]?.[4]);
  if (!Number.isFinite(previousOpen) || !Number.isFinite(latestClose) || previousOpen === 0) {
    return 0;
  }
  return ((latestClose - previousOpen) / previousOpen) * 100;
}

async function fetchKlineSnapshot(symbol, interval) {
  const klines = await fetchJson(`/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=2`, { retries: 1 });
  const previous = klines[0];
  const latest = klines[1] ?? klines[0];
  const latestOpen = Number(latest?.[1] || 0);
  const latestClose = Number(latest?.[4] || 0);
  const latestChangePercent =
    latestOpen > 0 && Number.isFinite(latestClose) ? ((latestClose - latestOpen) / latestOpen) * 100 : 0;

  return {
    previousOpen: Number(previous?.[1] || 0),
    latestClose: Number(latest?.[4] || 0),
    previousVolume: Number(previous?.[5] || 0),
    latestVolume: Number(latest?.[5] || 0),
    previousQuoteVolume: Number(previous?.[7] || 0),
    latestQuoteVolume: Number(latest?.[7] || 0),
    latestChangePercent
  };
}

async function fetchIntervalMetrics(symbol) {
  const [change5m, change1h, kline15m] = await Promise.all([
    fetchKlineChange(symbol, PERIODS.p5m),
    fetchKlineChange(symbol, "1h"),
    fetchKlineSnapshot(symbol, PERIODS.p15m)
  ]);

  const previousOpen15m = Number(kline15m.previousOpen || 0);
  const latestClose15m = Number(kline15m.latestClose || 0);
  const change15m =
    previousOpen15m > 0 && Number.isFinite(latestClose15m) ? ((latestClose15m - previousOpen15m) / previousOpen15m) * 100 : 0;

  return {
    change5m,
    change1h,
    change15m,
    ...kline15m
  };
}

function calculateChangeFromOpen(currentPrice, openPrice) {
  const current = Number(currentPrice);
  const open = Number(openPrice);
  if (!Number.isFinite(current) || !Number.isFinite(open) || open <= 0) {
    return null;
  }
  return ((current - open) / open) * 100;
}

async function fetchLongHorizonMetrics(row) {
  const klines = await fetchJson(`/fapi/v1/klines?symbol=${row.symbol}&interval=1d&limit=370`, {
    retries: 0,
    timeoutMs: 12000
  });
  const currentPrice = Number(row.lastPrice || 0);
  const now = new Date();
  const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1);

  const open5d = Number(klines[Math.max(0, klines.length - 6)]?.[1]);
  const open30d = Number(klines[Math.max(0, klines.length - 31)]?.[1]);
  const ytdKline = klines.find((item) => Number(item?.[0]) >= yearStart) || klines[0];

  return {
    marketCap: state.marketLongMetrics.get(row.symbol)?.marketCap || "--",
    marketCapValue: state.marketLongMetrics.get(row.symbol)?.marketCapValue || null,
    change5d: calculateChangeFromOpen(currentPrice, open5d),
    change30d: calculateChangeFromOpen(currentPrice, open30d),
    changeYtd: calculateChangeFromOpen(currentPrice, Number(ytdKline?.[1]))
  };
}

async function enrichMarketCaps(rows) {
  try {
    const pages = await Promise.all(
      [1, 2, 3].map((page) =>
        fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`, {
          headers: {
            Accept: "application/json"
          }
        }).then((response) => {
          if (!response.ok) throw new Error(`coingecko ${response.status}`);
          return response.json();
        })
      )
    );
    const capBySymbol = new Map();
    pages.flat().forEach((item) => {
      const symbol = String(item.symbol || "").toUpperCase();
      const marketCap = Number(item.market_cap || 0);
      if (!symbol || !Number.isFinite(marketCap) || marketCap <= 0) return;
      const existing = capBySymbol.get(symbol);
      if (!existing || marketCap > existing.marketCapValue) {
        capBySymbol.set(symbol, {
          marketCap: formatMarketCap(marketCap),
          marketCapValue: marketCap
        });
      }
    });

    rows.forEach((row) => {
      const cap = capBySymbol.get(row.baseAsset);
      if (!cap) return;
      state.marketLongMetrics.set(row.symbol, {
        ...(state.marketLongMetrics.get(row.symbol) || {}),
        ...cap
      });
    });
    renderMarketList(rows);
  } catch (error) {
    console.error("market cap enrichment failed", error);
  }
}

async function enrichMarketLongMetrics(rows) {
  if (state.marketLongMetricsLoading || !Array.isArray(rows) || !rows.length) {
    return;
  }

  state.marketLongMetricsLoading = true;
  const pendingRows = rows.filter((row) => {
    const metrics = state.marketLongMetrics.get(row.symbol);
    return !metrics || !Number.isFinite(Number(metrics.change30d));
  });
  const total = pendingRows.length;

  try {
    enrichMarketCaps(rows);
    for (let index = 0; index < pendingRows.length; index += 12) {
      const batch = pendingRows.slice(index, index + 12);
      await mapWithConcurrency(batch, 3, async (row) => {
        try {
          state.marketLongMetrics.set(row.symbol, await fetchLongHorizonMetrics(row));
        } catch (error) {
          console.error(`long metrics failed for ${row.symbol}`, error);
          state.marketLongMetrics.set(row.symbol, {
            marketCap: "--",
            marketCapValue: null,
            change5d: null,
            change30d: null,
            changeYtd: null
          });
        }
      });
      if (marketListStatus) {
        marketListStatus.textContent = `长周期数据补全 ${Math.min(index + batch.length, total)}/${total}`;
      }
      renderMarketList(rows);
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  } finally {
    state.marketLongMetricsLoading = false;
    if (marketListStatus) {
      marketListStatus.textContent = `已加载 ${rows.length} 个USDT永续合约`;
    }
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function fetchChartCandles(symbol, interval, limit = 240) {
  const klines = await fetchJson(`/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  return klines.map((item) => ({
    time: Math.floor(Number(item[0]) / 1000),
    open: Number(item[1]),
    high: Number(item[2]),
    low: Number(item[3]),
    close: Number(item[4]),
    volume: Number(item[7] || item[5] || 0)
  }));
}

function rowBaseTemplate(row, extraCells) {
  return `
    <div class="table-row">
      <div class="symbol-cell">
        <div>
          <button class="symbol-main symbol-trigger" type="button" data-chart-symbol="${row.symbol}">${row.baseAsset}</button>
        </div>
      </div>
      ${extraCells}
    </div>
  `;
}

function getHeaderTemplate(type) {
  if (type === "heat") {
    return `
      <div class="table-row table-head">
        <div class="cell symbol-head">标的</div>
        <div class="cell right">价格</div>
        <div class="cell right">15m%</div>
        <div class="cell right">24H%</div>
        <div class="cell right">成交量</div>
        <div class="cell right">热度</div>
      </div>
    `;
  }

  if (type === "chain") {
    return `
      <div class="table-row table-head">
        <div class="cell symbol-head">标的</div>
        <div class="cell center">公链</div>
        <div class="cell right">15m%</div>
        <div class="cell right">24H%</div>
        <div class="cell right">成交量</div>
        <div class="cell right">热度</div>
      </div>
    `;
  }

  if (type === "movers") {
    return `
      <div class="table-row table-head">
        <div class="cell symbol-head">标的</div>
        <div class="cell right">价格</div>
        <div class="cell right">15m%</div>
        <div class="cell right">24H%</div>
        <div class="cell right">成交量</div>
      </div>
    `;
  }

  return `
    <div class="table-row table-head">
      <div class="cell symbol-head">标的</div>
      <div class="cell right">价格</div>
      <div class="cell right">资金费率/时间</div>
      <div class="cell right">年化</div>
      <div class="cell right">24H%</div>
      <div class="cell right">成交量</div>
    </div>
  `;
}

function renderTable(targetId, rows, type) {
  const target = document.getElementById(targetId);

  if (!rows.length) {
    target.innerHTML = `<div class="table-row"><div class="cell">暂无数据</div></div>`;
    return;
  }

  const content = rows
    .map((row) => {
      if (type === "heat") {
        return rowBaseTemplate(
          row,
          `
            <div class="cell right">${formatPrice(row.lastPrice)}</div>
            <div class="cell right ${getDeltaClass(row.change15m)}">${formatPercent(row.change15m)}</div>
            <div class="cell right ${getDeltaClass(row.change24h)}">${formatPercent(row.change24h)}</div>
            <div class="cell right">${formatCompact(row.quoteVolume)}</div>
            <div class="cell right">${row.heatScore}</div>
          `
        );
      }

      if (type === "chain") {
        return rowBaseTemplate(
          row,
          `
            <div class="cell center">${getChainName(row.baseAsset)}</div>
            <div class="cell right ${getDeltaClass(row.change15m)}">${formatPercent(row.change15m)}</div>
            <div class="cell right ${getDeltaClass(row.change24h)}">${formatPercent(row.change24h)}</div>
            <div class="cell right">${formatCompact(row.quoteVolume)}</div>
            <div class="cell right">${row.heatScore}</div>
          `
        );
      }

      if (type === "movers") {
        return rowBaseTemplate(
          row,
          `
            <div class="cell right">${formatPrice(row.lastPrice)}</div>
            <div class="cell right ${getDeltaClass(row.change15m)}">${formatPercent(row.change15m)}</div>
            <div class="cell right ${getDeltaClass(row.change24h)}">${formatPercent(row.change24h)}</div>
            <div class="cell right">${formatCompact(row.quoteVolume)}</div>
          `
        );
      }

      const fundingTimeText = row.fundingCountdownText || formatFundingInterval(row.fundingIntervalHours || 8);

      return rowBaseTemplate(
        row,
        `
          <div class="cell right">${formatPrice(row.lastPrice)}</div>
          <div class="cell right">
            <div class="funding-meta">
              <strong class="${getDeltaClass(row.fundingRate)}">${formatFunding(row.fundingRate)}/${fundingTimeText}</strong>
            </div>
          </div>
          <div class="cell right ${getDeltaClass(row.fundingRate)}">${annualizeFunding(row.fundingRate)}</div>
          <div class="cell right ${getDeltaClass(row.change24h)}">${formatPercent(row.change24h)}</div>
          <div class="cell right">${formatCompact(row.quoteVolume)}</div>
        `
      );
    })
    .join("");

  target.innerHTML = `<div class="table table-${type}">${getHeaderTemplate(type)}${content}</div>`;
}

function renderHeatRanking() {
  const rows = state.heatBoards[state.heatMode] || state.heatBoards.default || [];
  const titleMap = {
    default: "币安合约综合热度榜前10",
    combined: "综合热度榜前10",
    contracts: "合约热度榜前10",
    onchain: "链上热度榜前10"
  };

  if (heatTitle) {
    heatTitle.textContent = titleMap[state.heatMode] || titleMap.default;
  }

  document.querySelectorAll("[data-heat-mode]").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-heat-mode") === state.heatMode);
  });

  renderTable("heatTable", rows, "heat");
}

function renderMoversRanking() {
  if (!moversTable) {
    return;
  }

  const isLosers = state.moversMode === "losers";
  const rows = isLosers ? state.moversLosers : state.moversGainers;

  if (moversTitle) {
    moversTitle.textContent = isLosers ? "币安合约跌幅榜 top10" : "币安合约涨幅榜 top10";
  }

  document.querySelectorAll("[data-movers-mode]").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-movers-mode") === state.moversMode);
  });

  renderTable("moversTable", rows, "movers");
}

function renderFundingRanking() {
  if (!fundingTable) {
    return;
  }

  const isPositive = state.fundingMode === "positive";
  const rows = isPositive ? state.positiveFunding : state.negativeFunding;

  if (fundingTitle) {
    fundingTitle.textContent = isPositive ? "币安合约正资金费率 top10" : "币安合约负资金费率 top10";
  }

  document.querySelectorAll("[data-funding-mode]").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-funding-mode") === state.fundingMode);
  });

  renderTable("fundingTable", rows, "funding");
}

function renderMarketList(rows = state.rows) {
  if (!marketListTable) {
    return;
  }

  const sourceRows = Array.isArray(rows) ? rows : [];
  const headerColumns = [
    ["rank", "序号"],
    ["baseAsset", "标的"],
    ["lastPrice", "最新价格"],
    ["change24h", "24小时涨跌幅度"],
    ["quoteVolume", "成交量"],
    ["change5m", "5分钟涨跌"],
    ["change1h", "1小时涨跌"],
    ["fundingRate", "资金费率（资金费率/时间）"],
    ["annualFunding", "年化资金费率"],
    ["marketCap", "市值"],
    ["change5d", "5日涨幅"],
    ["change30d", "30日涨幅"],
    ["changeYtd", "年初至今"]
  ];
  const headerHtml = `
    <div class="binance-market-row binance-market-head">
      ${headerColumns
        .map(([key, label]) => `<button type="button" data-market-sort="${key}">${label}${getMarketSortMark(key)}</button>`)
        .join("")}
    </div>
  `;

  if (marketListStatus) {
    if (!state.marketLongMetricsLoading) {
      marketListStatus.textContent = sourceRows.length ? `已加载 ${sourceRows.length} 个USDT永续合约` : "等待币安合约数据";
    }
  }

  if (!sourceRows.length) {
    marketListTable.innerHTML = `
      <div class="binance-market-table-wrap">
        <div class="binance-market-table">
          ${headerHtml}
          <div class="market-list-empty">当前未能拉取币安合约数据，请检查网络或接口可访问性。</div>
        </div>
      </div>
    `;
    return;
  }

  const sortedRows = sortMarketRows(sourceRows);

  marketListTable.innerHTML = `
    <div class="binance-market-table-wrap">
      <div class="binance-market-table">
        ${headerHtml}
        <div class="binance-market-body">
          ${sortedRows
            .map(
              (row) => {
                const longMetrics = state.marketLongMetrics.get(row.symbol) || {};
                return `
                <button class="binance-market-row binance-market-item symbol-trigger" type="button" data-chart-symbol="${row.symbol}">
                  <div>${sourceRows.findIndex((item) => item.symbol === row.symbol) + 1}</div>
                  <div><strong>${row.baseAsset}</strong><span>${row.symbol}</span></div>
                  <div>${formatPrice(row.lastPrice)}</div>
                  <div class="${getDeltaClass(row.change24h)}">${formatPercent(row.change24h)}</div>
                  <div>${formatCompact(row.quoteVolume)} USDT</div>
                  <div class="${getDeltaClass(row.change5m)}">${formatPercent(row.change5m)}</div>
                  <div class="${getDeltaClass(row.change1h)}">${formatPercent(row.change1h)}</div>
                  <div class="${getDeltaClass(row.fundingRate)}">${formatFunding(row.fundingRate)}/${row.fundingCountdownText || formatFundingInterval(row.fundingIntervalHours || 8)}</div>
                  <div class="${getDeltaClass(row.fundingRate)}">${annualizeFunding(row.fundingRate)}</div>
                  <div>${longMetrics.marketCap || "--"}</div>
                  <div class="${getDeltaClass(longMetrics.change5d)}">${formatOptionalPercent(longMetrics.change5d)}</div>
                  <div class="${getDeltaClass(longMetrics.change30d)}">${formatOptionalPercent(longMetrics.change30d)}</div>
                  <div class="${getDeltaClass(longMetrics.changeYtd)}">${formatOptionalPercent(longMetrics.changeYtd)}</div>
                </button>
              `;
              }
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}

function getMarketSortMark(key) {
  if (state.marketSort.key !== key) return "";
  return state.marketSort.direction === "asc" ? " ↑" : " ↓";
}

function getMarketSortValue(row, key) {
  const longMetrics = state.marketLongMetrics.get(row.symbol) || {};
  const valueMap = {
    rank: state.rows.findIndex((item) => item.symbol === row.symbol) + 1,
    baseAsset: row.baseAsset,
    lastPrice: row.lastPrice,
    change24h: row.change24h,
    quoteVolume: row.quoteVolume,
    change5m: row.change5m,
    change1h: row.change1h,
    fundingRate: row.fundingRate,
    annualFunding: row.fundingRate,
    marketCap: longMetrics.marketCapValue,
    change5d: longMetrics.change5d,
    change30d: longMetrics.change30d,
    changeYtd: longMetrics.changeYtd
  };
  return valueMap[key];
}

function sortMarketRows(rows) {
  const { key, direction } = state.marketSort;
  const modifier = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = getMarketSortValue(a, key);
    const bv = getMarketSortValue(b, key);
    if (typeof av === "string" || typeof bv === "string") {
      return String(av || "").localeCompare(String(bv || "")) * modifier;
    }
    const an = Number(av);
    const bn = Number(bv);
    if (!Number.isFinite(an) && !Number.isFinite(bn)) return 0;
    if (!Number.isFinite(an)) return 1;
    if (!Number.isFinite(bn)) return -1;
    return (an - bn) * modifier;
  });
}

function formatOptionalPercent(value) {
  return Number.isFinite(Number(value)) ? formatPercent(value) : "--";
}

function renderVolumeTopStrip(rows) {
  if (!volumeTopStrip) {
    return;
  }

  if (!rows.length) {
    volumeTopStrip.innerHTML = `<div class="volume-chip"><div class="volume-chip-symbol">暂无数据</div></div>`;
    return;
  }

  volumeTopStrip.innerHTML = rows
    .slice(0, 10)
    .map(
      (row) => `
        <button class="volume-chip symbol-trigger" type="button" data-chart-symbol="${row.symbol}">
          <div class="volume-chip-price">${formatPrice(row.lastPrice)}</div>
          <div class="volume-chip-symbol">${row.baseAsset}</div>
          <div class="volume-chip-change ${getDeltaClass(row.change24h)}">${formatPercent(row.change24h)}</div>
        </button>
      `
    )
    .join("");
}

function renderTradingViewChart(row) {
  if (!tradingviewPanel) {
    return;
  }

  if (!row) {
    tradingviewPanel.innerHTML = `<div class="tv-fallback">暂无图表数据</div>`;
    return;
  }

  stopChartRealtime();
  const widgetSymbol = getTradingViewWidgetSymbol(row.symbol);
  tradingviewPanel.innerHTML = `
    <div class="tv-single tv-tradingview-embed">
      <div class="tradingview-widget-container">
        <div class="tradingview-widget-container__widget"></div>
        <a class="kline-open-fallback" href="${getTradingViewPageUrl(row.symbol)}" target="_blank" rel="noopener noreferrer">打开 TradingView 完整图表</a>
      </div>
    </div>
  `;

  const script = document.createElement("script");
  script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
  script.async = true;
  script.textContent = JSON.stringify({
    autosize: true,
    symbol: widgetSymbol,
    interval: "15",
    timezone: "Asia/Shanghai",
    theme: getTradingViewWidgetTheme(),
    style: "1",
    locale: "zh_CN",
    allow_symbol_change: true,
    calendar: false,
    details: true,
    hide_side_toolbar: false,
    hide_top_toolbar: false,
    hotlist: false,
    save_image: true,
    studies: ["Volume@tv-basicstudies"],
    support_host: "https://www.tradingview.com",
    withdateranges: true
  });
  tradingviewPanel.querySelector(".tradingview-widget-container")?.appendChild(script);
}

async function loadEmbeddedChart(symbol, interval) {
  const container = document.getElementById("chartCanvas");
  if (!container) {
    return;
  }

  if (!window.LightweightCharts) {
    container.innerHTML = `<div class="tv-fallback">图表库未加载，请刷新页面重试</div>`;
    return;
  }

  container.innerHTML = "";

  try {
    const requestId = ++state.chartRequestId;
    const data = await fetchChartCandles(symbol, interval, 240);
    if (requestId !== state.chartRequestId) {
      return;
    }
    state.currentCandleOpenTime = data.length ? Number(data[data.length - 1].time) * 1000 : 0;
    state.latestChartPrice = data.length ? Number(data[data.length - 1].close) : null;

    const { createChart, CandlestickSeries, HistogramSeries, ColorType } = window.LightweightCharts;
    const priceFormat = getPriceFormatConfig(symbol);

    if (state.chart) {
      state.chart.remove();
      state.chart = null;
      state.candleSeries = null;
      state.volumeSeries = null;
    }

    state.chart = createChart(container, {
      width: container.clientWidth || 640,
      height: container.clientHeight || 360,
      layout: {
        background: { type: ColorType.Solid, color: getCurrentTheme() === "dark" ? "#172133" : "#ffffff" },
        textColor: getCurrentTheme() === "dark" ? "#c7d2e5" : "#475569"
      },
      localization: {
        locale: "en-US",
        priceFormatter: (price) => formatChartAxisPrice(symbol, price),
        timeFormatter: (time) => formatChartTimeUtc8(time)
      },
      grid: {
        vertLines: { color: getCurrentTheme() === "dark" ? "#243146" : "#eef2f7" },
        horzLines: { color: getCurrentTheme() === "dark" ? "#243146" : "#eef2f7" }
      },
      crosshair: {
        mode: 0
      },
      rightPriceScale: {
        borderColor: getCurrentTheme() === "dark" ? "#314158" : "#e7ebf3"
      },
      timeScale: {
        borderColor: getCurrentTheme() === "dark" ? "#314158" : "#e7ebf3",
        timeVisible: true,
        tickMarkFormatter: (time) => formatChartTickUtc8(time, interval)
      }
    });

    state.candleSeries = state.chart.addSeries(CandlestickSeries, {
      upColor: "#22b35d",
      downColor: "#f06565",
      wickUpColor: "#22b35d",
      wickDownColor: "#f06565",
      borderVisible: false,
      priceFormat: {
        type: "price",
        precision: priceFormat.precision,
        minMove: priceFormat.minMove
      }
    });
    state.candleSeries.setData(data);
    state.volumeSeries = state.chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: "custom",
        formatter: (value) => formatCompactKMB(value, 2)
      },
      priceScaleId: "",
      color: "#cbd5e1"
      ,
      lastValueVisible: false,
      priceLineVisible: false
    });
    state.volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0
      }
    });
    state.volumeSeries.setData(
      data.map((item) => ({
        time: item.time,
        value: item.volume,
        color: item.close >= item.open ? "rgba(34, 179, 93, 0.45)" : "rgba(240, 101, 101, 0.45)"
      }))
    );
    state.chart.timeScale().fitContent();

    window.requestAnimationFrame(() => {
      state.chart.applyOptions({
        width: container.clientWidth || 640,
        height: container.clientHeight || 360
      });
    });

    startChartRealtime(symbol, interval);
  } catch (error) {
    console.error(error);
    container.innerHTML = `<div class="tv-fallback">K线加载失败，请打开完整 TradingView 查看</div>`;
  }
}

function stopChartRealtime() {
  if (state.chartRefreshTimer) {
    window.clearInterval(state.chartRefreshTimer);
    state.chartRefreshTimer = null;
  }

  if (state.chartWatchdogTimer) {
    window.clearInterval(state.chartWatchdogTimer);
    state.chartWatchdogTimer = null;
  }

  if (state.chartSocket) {
    state.chartSocket.close();
    state.chartSocket = null;
  }

  state.chartSocketKey = "";
  state.chartLastMessageAt = 0;
  state.currentCandleOpenTime = 0;
  state.latestChartPrice = null;
}

async function refreshCurrentChart() {
  if (!state.candleSeries || !state.selectedChartSymbol) {
    return;
  }

  try {
    const requestId = ++state.chartRequestId;
    const data = await fetchChartCandles(state.selectedChartSymbol, state.selectedChartInterval, 240);
    if (requestId !== state.chartRequestId || !state.candleSeries) {
      return;
    }
    state.currentCandleOpenTime = data.length ? Number(data[data.length - 1].time) * 1000 : 0;
    state.latestChartPrice = data.length ? Number(data[data.length - 1].close) : null;
    state.candleSeries.setData(data);
    if (state.volumeSeries) {
      state.volumeSeries.setData(
        data.map((item) => ({
          time: item.time,
          value: item.volume,
          color: item.close >= item.open ? "rgba(34, 179, 93, 0.45)" : "rgba(240, 101, 101, 0.45)"
        }))
      );
    }
  } catch (error) {
    console.error("refresh chart failed", error);
  }
}

function startChartPollingFallback(socketKey) {
  if (state.chartRefreshTimer) {
    window.clearInterval(state.chartRefreshTimer);
  }

  state.chartRefreshTimer = window.setInterval(() => {
    if (state.chartSocketKey !== socketKey || document.hidden) {
      return;
    }
    refreshCurrentChart();
  }, CHART_POLL_REFRESH_MS);
}

function startChartRealtime(symbol, interval) {
  stopChartRealtime();

  const socketKey = `${symbol}:${interval}`;
  state.chartSocketKey = socketKey;
  state.chartLastMessageAt = Date.now();
  startChartPollingFallback(socketKey);

  const wsUrl = `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${interval}`;

  try {
    const socket = new WebSocket(wsUrl);
    state.chartSocket = socket;

    socket.addEventListener("open", () => {
      if (state.chartSocketKey !== socketKey) {
        return;
      }
      state.chartLastMessageAt = Date.now();
      refreshCurrentChart();
    });

    socket.addEventListener("message", (event) => {
      if (state.chartSocketKey !== socketKey || !state.candleSeries) {
        return;
      }

      try {
        const payload = JSON.parse(event.data);
        const k = payload?.k;
        if (!k) {
          return;
        }

        state.chartLastMessageAt = Date.now();
        state.currentCandleOpenTime = Number(k.t);
        state.latestChartPrice = Number(k.c);

        state.candleSeries.update({
          time: Math.floor(Number(k.t) / 1000),
          open: Number(k.o),
          high: Number(k.h),
          low: Number(k.l),
          close: Number(k.c)
        });
        if (state.volumeSeries) {
          state.volumeSeries.update({
            time: Math.floor(Number(k.t) / 1000),
            value: Number(k.q || k.v || 0),
            color: Number(k.c) >= Number(k.o) ? "rgba(34, 179, 93, 0.45)" : "rgba(240, 101, 101, 0.45)"
          });
        }
      } catch (error) {
        console.error("chart websocket parse failed", error);
      }
    });

    socket.addEventListener("close", () => {
      if (state.chartSocketKey !== socketKey) {
        return;
      }
      window.setTimeout(() => {
        if (state.chartSocketKey === socketKey) {
          refreshCurrentChart().then(() => startChartRealtime(symbol, interval));
        }
      }, 3000);
    });

    socket.addEventListener("error", () => {
      try {
        socket.close();
      } catch (error) {
        console.error("chart websocket close failed", error);
      }
    });

    state.chartWatchdogTimer = window.setInterval(() => {
      if (state.chartSocketKey !== socketKey) {
        return;
      }

      const stalledFor = Date.now() - state.chartLastMessageAt;
      if (stalledFor < 10000) {
        return;
      }

      try {
        socket.close();
      } catch (error) {
        console.error("chart websocket watchdog close failed", error);
      }
    }, 4000);
  } catch (error) {
    console.error("chart websocket init failed", error);
  }
}

function updateTradingViewSelection(symbol) {
  if (!symbol || !state.rows.length) {
    return;
  }

  const matchedRow = state.rows.find((row) => row.symbol === symbol);
  if (!matchedRow) {
    return;
  }

  state.selectedChartSymbol = symbol;
  renderTradingViewChart(matchedRow);
}

function ensureChartSelection(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return;
  }

  const selectedRow = rows.find((row) => row.symbol === state.selectedChartSymbol);
  if (selectedRow) {
    return;
  }

  const fallbackRow = [...rows].sort((a, b) => b.heatScore - a.heatScore)[0];
  if (!fallbackRow) {
    return;
  }

  state.selectedChartSymbol = fallbackRow.symbol;
  renderTradingViewChart(fallbackRow);
}

function renderShockList(rows) {
  const target = document.getElementById("shockList");
  if (!target) {
    return;
  }

  renderAlertTable(target, mergeAlertRows(rows, "shock"), {
    emptyText: "暂无价格异动",
    columns: ["时间", "标的", "价格", "24小时涨跌", "异动数据"]
  });
}

function loadHistory(key) {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function saveHistory(key, items) {
  try {
    window.localStorage.setItem(key, JSON.stringify(items.slice(0, 50)));
  } catch (error) {
    console.error("save history failed", error);
  }
}

function updateHistory(records, type) {
  const key = type === "shock" ? SHOCK_HISTORY_KEY : VOLUME_HISTORY_KEY;
  const existing = loadHistory(key);
  const merged = dedupeAlertHistory([...records, ...existing]).slice(0, 50);
  saveHistory(key, merged);
}

function dedupeAlertHistory(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = [item.type || "", item.chartSymbol || item.symbol || "", item.alertValue || item.detail || ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeAlertRows(rows, type) {
  const historyKey = type === "shock" ? SHOCK_HISTORY_KEY : VOLUME_HISTORY_KEY;
  const historyItems = loadHistory(historyKey).map((item) => normalizeHistoryAlertRow(item, type));
  return dedupeAlertHistory(historyItems)
    .sort((a, b) => Number(b.timeMs || 0) - Number(a.timeMs || 0))
    .slice(0, 50);
}

function hasRecentStoredAlert(row, type) {
  const key = type === "shock" ? SHOCK_HISTORY_KEY : VOLUME_HISTORY_KEY;
  const now = Date.now();
  return loadHistory(key).some((item) => {
    if ((item.type || type) !== type) return false;
    if ((item.chartSymbol || "") !== row.symbol) return false;
    const timeMs = Number(item.timeMs || 0);
    return timeMs > 0 && now - timeMs <= ALERT_REPEAT_SUPPRESS_MS;
  });
}

function normalizeLiveAlertRow(row, type) {
  const now = Date.now();
  const isVolume = type === "volume";
  const alertValue = isVolume ? `${row.volumeMultiple.toFixed(2)}x` : formatPercent(row.change5m);
  return {
    type,
    symbol: row.baseAsset,
    chartSymbol: row.symbol,
    price: formatPrice(row.lastPrice),
    change24h: formatPercent(row.change24h),
    change24hClass: getDeltaClass(row.change24h),
    alertValue,
    alertClass: isVolume ? getVolumeMultipleClass(row.volumeMultiple) : getDeltaClass(row.change5m),
    volume: isVolume ? `${formatCompact(row.latest15mQuoteVolume)} USDT` : "",
    timeMs: now,
    timeText: row.shockTimeText || formatTime(new Date()),
    fresh: true
  };
}

function normalizeHistoryAlertRow(item, type) {
  const timeMs = Number(item.timeMs || 0);
  return {
    type: item.type || type,
    symbol: item.symbol || "--",
    chartSymbol: item.chartSymbol || "",
    price: item.price || "--",
    change24h: item.change24h || "--",
    change24hClass: item.change24hClass || "",
    alertValue: item.alertValue || item.detail || "--",
    alertClass: item.alertClass || "",
    volume: item.volume || "--",
    timeMs,
    timeText: item.timeText || "--",
    fresh: timeMs ? Date.now() - timeMs <= FRESH_NEWS_WINDOW_MS : false
  };
}

function renderAlertTable(target, rows, options) {
  if (!target) {
    return;
  }

  if (!rows.length) {
    target.innerHTML = `
      <div class="market-alert-table ${options.volume ? "market-alert-table-volume" : ""}">
        <div class="market-alert-row market-alert-head">
          ${options.columns.map((column) => `<div>${column}</div>`).join("")}
        </div>
        <div class="alert-empty-state">${options.emptyText}</div>
      </div>
    `;
    return;
  }

  target.innerHTML = `
    <div class="market-alert-table ${options.volume ? "market-alert-table-volume" : ""}">
      <div class="market-alert-row market-alert-head">
        ${options.columns.map((column) => `<div>${column}</div>`).join("")}
      </div>
      <div class="market-alert-body">
        ${rows
          .map(
            (row) => `
              <button class="market-alert-row market-alert-item symbol-trigger ${row.fresh ? "market-alert-fresh" : ""}" type="button" data-chart-symbol="${row.chartSymbol}">
                <div>${row.timeText}</div>
                <div><strong>${row.symbol}</strong></div>
                <div>${row.price}</div>
                <div class="${row.change24hClass}">${row.change24h}</div>
                <div class="${row.alertClass}">${row.alertValue}</div>
                ${options.volume ? `<div>${row.volume}</div>` : ""}
              </button>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function clearHistory(type) {
  const key = type === "shock" ? SHOCK_HISTORY_KEY : VOLUME_HISTORY_KEY;
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.error("clear history failed", error);
  }
  renderHistory(type);
}

function renderHistory(type) {
  const target = type === "shock" ? shockHistoryList : volumeHistoryList;
  if (!target) {
    return;
  }

  const key = type === "shock" ? SHOCK_HISTORY_KEY : VOLUME_HISTORY_KEY;
  const items = loadHistory(key);

  if (!items.length) {
    target.innerHTML = `<div class="history-item"><strong>暂无留存</strong><span class="history-time">等待触发</span></div>`;
    return;
  }

  target.innerHTML = `<div class="history-list">${items
    .slice(0, 50)
    .map((item) => {
      const resolvedChartSymbol =
        item.chartSymbol || state.rows.find((row) => row.baseAsset === item.symbol)?.symbol || "";
      return `
        <button class="history-item symbol-trigger" type="button" data-chart-symbol="${resolvedChartSymbol}">
          <div><strong>${item.symbol}</strong> ${item.detail}</div>
          <span class="history-time">${item.timeText}</span>
        </button>
      `;
    })
    .join("")}</div>`;
}

function renderVolumeAlertList(rows) {
  if (!volumeAlertList) {
    return;
  }

  renderAlertTable(volumeAlertList, mergeAlertRows(rows, "volume"), {
    emptyText: "暂无异常放量",
    columns: ["时间", "标的", "价格", "24小时涨跌", "异动数据", "交易量"],
    volume: true
  });
}

function renderBottomFeeds() {
  renderNewsHubFeed();
}

function getNewsSourceStatus(status) {
  return status === "live" ? "正常" : status === "failed" ? "异常" : "加载中";
}

function getNewsStatusDotClass(status) {
  return status === "live" ? "ok" : status === "failed" ? "failed" : "";
}

function normalizeNewsHubItems() {
  const bweItems = state.newsItems.map((item) => ({
    source: "方程式",
    sourceKey: "bwe",
    sourceTag: item.sourceLabel || "BWE",
    title: item.primary || "未命名事件",
    summary: [item.secondary, ...(Array.isArray(item.metaLines) ? item.metaLines : [])].filter(Boolean).join(" · "),
    link: item.link || "#",
    publishTime: Number(item.publishTime || 0)
  }));
  const jin10Items = state.listingItems.map((item) => ({
    source: "金十",
    sourceKey: "jin10",
    sourceTag: "J10",
    title: item.title || "未命名快讯",
    summary: `[${item.exchange || "Jin10"}] ${Array.isArray(item.symbols) ? item.symbols.join(" ") : ""} ${item.summary || ""}`.trim(),
    link: item.link || "#",
    publishTime: Number(item.publishTime || 0)
  }));
  const blockbeatsItems = state.reserveItems.map((item) => ({
    source: "律动",
    sourceKey: "blockbeats",
    sourceTag: item.sourceTag || "BB",
    title: item.title || "未命名快讯",
    summary: item.summary || "",
    link: item.link || "#",
    publishTime: Number(item.publishTime || 0)
  }));

  return [...bweItems, ...jin10Items, ...blockbeatsItems].sort((a, b) => b.publishTime - a.publishTime);
}

function updateNewsHubStatusBar() {
  if (!newsHubStatusBar) {
    return;
  }

  const sources = [
    ["方程式", state.newsStatus],
    ["金十", state.listingStatus],
    ["律动", state.reserveStatus]
  ];
  newsHubStatusBar.innerHTML = sources
    .map(
      ([label, status]) => `
        <span class="feed-health-inline news-source-health">
          <span class="feed-health-dot ${getNewsStatusDotClass(status)}"></span>
          <span class="feed-health-text">${label}</span>
          <span class="feed-health-time">${getNewsSourceStatus(status)}</span>
        </span>
      `
    )
    .join("");
}

function renderNewsHubFeed() {
  if (!newsHubFeed) {
    return;
  }

  updateNewsHubStatusBar();

  const mode = state.newsHubMode || "all";
  const items = normalizeNewsHubItems().filter((item) => mode === "all" || item.sourceKey === mode);

  if (!items.length) {
    const loadingText = mode === "all" ? "正在读取新闻聚合。" : `正在读取${mode === "bwe" ? "方程式新闻" : mode === "jin10" ? "金十数据" : "律动快讯"}。`;
    newsHubFeed.innerHTML = `
      <div class="feed-item feed-item--compact">
        <div class="feed-title">${loadingText}</div>
        <div class="feed-meta">全部模式会混合展示方程式、金十、律动，并标注来源。</div>
      </div>
    `;
    return;
  }

  newsHubFeed.innerHTML = items
    .slice(0, mode === "all" ? 24 : 14)
    .map(
      (item) => `
        <a class="feed-item feed-item--compact news-hub-item${getFreshNewsClass(item.publishTime)}" href="${escapeHtml(item.link || "#")}" target="_blank" rel="noreferrer">
          <div class="feed-title feed-line-clamp-2">
            <span class="feed-source-tag news-source-label">${escapeHtml(item.source)}</span>
            ${escapeHtml(item.title)}
          </div>
          ${item.summary ? `<div class="feed-meta feed-line-clamp-1">${escapeHtml(item.summary)}</div>` : ""}
          <div class="feed-meta">
            <span class="feed-source-tag">${escapeHtml(item.sourceTag)}</span>
            <span>${formatShortDateTime(item.publishTime || 0)}</span>
          </div>
        </a>
      `
    )
    .join("");
}

function renderReserveFeedLoading() {
  if (!reserveFeed) {
    renderNewsHubFeed();
    return;
  }

  if (state.reserveItems.length) {
    return;
  }

  reserveFeed.innerHTML = `
    <div class="feed-item feed-item--compact">
      <div class="feed-title">正在读取律动快讯。</div>
      <div class="feed-meta">来自 BlockBeats 官方 RSS-v2 快讯源。</div>
    </div>
  `;
}

function renderReserveFeed() {
  if (!reserveFeed) {
    return;
  }

  if (!state.reserveItems.length) {
    reserveFeed.innerHTML = `
      <div class="feed-item feed-item--compact">
        <div class="feed-title">暂未获取到律动快讯。</div>
        <div class="feed-meta">当前接口暂无可展示内容。</div>
      </div>
    `;
    return;
  }

  reserveFeed.innerHTML = state.reserveItems
    .map(
      (item) => `
        <a class="feed-item feed-item--compact${getFreshNewsClass(item.publishTime)}" href="${item.link}" target="_blank" rel="noreferrer">
          <div class="feed-title feed-line-clamp-2">${escapeHtml(item.title || "未命名公告")}</div>
          <div class="feed-meta">
            <span class="feed-source-tag">${escapeHtml(item.sourceTag || "BN")}</span>
            <span class="feed-line-clamp-1">${escapeHtml(item.summary || "")}</span>
            <span>${formatShortDateTime(item.publishTime || 0)}</span>
          </div>
        </a>
      `
    )
    .join("");
}

function renderHotEventFeed() {
  if (!hotEventFeed) {
    return;
  }

  const statusClass = state.newsStatus === "live" ? "ok" : state.newsStatus === "failed" ? "failed" : "pending";
  const statusText = state.newsStatus === "live" ? "正常" : state.newsStatus === "failed" ? "异常" : "加载中";
  if (bweStatusBar) {
    bweStatusBar.innerHTML = `
      <span class="feed-health-inline">
        <span class="feed-health-dot ${statusClass === "ok" ? "ok" : statusClass === "failed" ? "failed" : ""}"></span>
        <span class="feed-health-text">${statusText}</span>
        <span class="feed-health-time">BWE RSS</span>
      </span>
    `;
  }

  if (!state.newsItems.length) {
    hotEventFeed.innerHTML = `
      <div class="feed-item">
        <div class="feed-title">正在读取 BWEnews RSS。</div>
        <div class="feed-meta">加载成功后，这里会显示最近的热点事件</div>
      </div>
    `;
    return;
  }

  hotEventFeed.innerHTML =
    state.newsItems
      .slice(0, 8)
      .map(
        (item) => `
          <a class="feed-item${getFreshNewsClass(item.publishTime)}" href="${escapeHtml(item.link || "#")}" target="_blank" rel="noreferrer">
            <div class="feed-title">${escapeHtml(item.primary || "未命名事件")}</div>
            ${item.secondary ? `<div class="feed-subtitle">${escapeHtml(item.secondary)}</div>` : ""}
            <div class="feed-summary-stack">
              ${Array.isArray(item.metaLines)
                ? item.metaLines
                    .map((line) =>
                      /^source:\s*/i.test(line)
                        ? `<div class="feed-source-line">${escapeHtml(line)}</div>`
                        : `<div class="feed-summary-line">${escapeHtml(line)}</div>`
                    )
                    .join("")
                : ""}
            </div>
            <div class="feed-meta feed-meta-stack">
              <span class="feed-source-tag">${escapeHtml(item.sourceLabel || "BWE")}</span>
              <span>${formatShortDateTime(item.publishTime || 0)}</span>
            </div>
          </a>
        `
      )
      .join("");
}

function renderSectorFeed() {
  if (!sectorFeed) {
    return;
  }

  updateSectorStatusBar();

  if (!state.sectorItems.length) {
    sectorFeed.innerHTML = `
      <div class="feed-item feed-item--compact">
        <div class="feed-title">${state.sectorStatus === "failed" ? "暂时无法读取社媒热度。" : "正在读取社媒热度。"}</div>
        <div class="feed-meta">${state.sectorStatus === "failed" ? "请检查 /api/sector-feed 或 X/Binance Square 源" : "数据源：Binance Square / X 可选"}</div>
      </div>
    `;
    return;
  }

  sectorFeed.innerHTML = state.sectorItems
    .slice(0, 12)
    .map((item) => {
      const tags = Array.isArray(item.tags) && item.tags.length ? item.tags.join(" / ") : "社媒";
      const xText = Number(item.xMentions || 0) > 0 ? `X ${formatCompactKMB(Number(item.xMentions || 0), 0)}` : "X 未接入";
      const squareText = `广场 ${Number(item.squareScore || 0)}`;
      const newsText = Number(item.newsMentions || 0) > 0 ? `资讯 ${Number(item.newsMentions || 0)}` : "资讯 0";
      return `
        <div class="sector-item">
          <div class="sector-name">${escapeHtml(item.symbol || "Unknown")}</div>
          <div class="sector-change">${Number(item.score || 0)}</div>
          <div class="sector-meta">
            ${xText} · ${squareText} · ${newsText} · 24H <span class="${getDeltaClass(Number(item.priceChange24h || 0))}">${formatPercent(Number(item.priceChange24h || 0))}</span> · ${escapeHtml(tags)}
          </div>
        </div>
      `;
    })
    .join("");
}

function updateSectorStatusBar() {
  if (!sectorStatusBar) {
    return;
  }

  const statusClass = state.sectorStatus === "live" ? "ok" : state.sectorStatus === "failed" ? "failed" : "";
  const statusText = state.sectorStatus === "live" ? "正常" : state.sectorStatus === "failed" ? "异常" : "加载中";
  sectorStatusBar.innerHTML = `
    <span class="feed-health-inline">
      <span class="feed-health-dot ${statusClass}"></span>
      <span class="feed-health-text">${statusText}</span>
      <span class="feed-health-time">${state.sectorUpdatedAt ? `${state.sectorUpdatedAt} 更新` : "Square/X"}</span>
    </span>
  `;
}

function getLocalApiEndpoint(path) {
  const isLocalPage =
    window.location.protocol === "file:" || ["127.0.0.1", "localhost"].includes(window.location.hostname);
  if (isLocalPage) {
    return `http://127.0.0.1:8787${path}`;
  }

  const apiOrigin = getConfiguredApiOrigin();
  return apiOrigin ? `${apiOrigin}${path}` : path;
}

async function loadHotEventFeed() {
  if (!hotEventFeed && !newsHubFeed) {
    return;
  }

  state.newsStatus = "connecting";
  renderHotEventFeed();
  renderNewsHubFeed();

  try {
    const endpoint = getLocalApiEndpoint("/api/bwe-rss-feed");
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`hot feed status ${response.status}`);
    }

    const payload = await response.json();
    state.newsItems = Array.isArray(payload.items) ? payload.items : [];
    state.newsStatus = "live";
    renderHotEventFeed();
    renderNewsHubFeed();
  } catch (error) {
    console.error("load BWE RSS failed", error);
    state.newsStatus = "failed";
    renderHotEventFeed();
    renderNewsHubFeed();
  }
}

function startHotFeedAutoRefresh() {
  if (state.hotFeedRefreshTimer) {
    window.clearInterval(state.hotFeedRefreshTimer);
  }

  state.hotFeedRefreshTimer = window.setInterval(() => {
    if (!document.hidden) {
      loadHotEventFeed();
    }
  }, HOT_FEED_REFRESH_MS);
}

async function loadSectorFeed() {
  if (!sectorFeed) {
    return;
  }

  if (!state.sectorItems.length) {
    state.sectorStatus = "connecting";
  }
  renderSectorFeed();

  try {
    const endpoint = getLocalApiEndpoint("/api/sector-feed");
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`sector feed status ${response.status}`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : [];
    const squareStatus = String(payload?.sourceStatus?.BinanceSquare || "").toLowerCase();
    const newsStatus = String(payload?.sourceStatus?.NewsMentions || "").toLowerCase();
    state.sectorStatus = items.length && (squareStatus !== "failed" || newsStatus === "ok") ? "live" : "failed";
    state.sectorUpdatedAt = formatTime(new Date());
    if (items.length) {
      state.sectorItems = items;
    }
    renderSectorFeed();
  } catch (error) {
    console.error("load sector feed failed", error);
    state.sectorStatus = "failed";
    renderSectorFeed();
  }
}

function startSectorFeedAutoRefresh() {
  if (state.sectorFeedRefreshTimer) {
    window.clearInterval(state.sectorFeedRefreshTimer);
  }

  state.sectorFeedRefreshTimer = window.setInterval(() => {
    if (!document.hidden) {
      loadSectorFeed();
    }
  }, SECTOR_FEED_REFRESH_MS);
}

function startFreshNewsTimer() {
  if (state.freshNewsTimer) {
    window.clearInterval(state.freshNewsTimer);
  }

  state.freshNewsTimer = window.setInterval(() => {
    if (!document.hidden) {
      renderReserveFeed();
      renderHotEventFeed();
      renderBottomFeeds();
    }
  }, 60000);
}

async function loadReserveFeed() {
  if (!reserveFeed && !newsHubFeed) {
    return;
  }

  if (!state.reserveItems.length) {
    state.reserveStatus = "connecting";
  }
  renderReserveFeedLoading();
  updateReserveStatusBar();
  renderNewsHubFeed();

  try {
    const endpoint = getLocalApiEndpoint("/api/blockbeats-feed");
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`reserve feed status ${response.status}`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : [];
    const sourceStatus = String(payload?.sourceStatus?.BlockBeats || "live").toLowerCase();
    state.reserveStatus = sourceStatus === "failed" ? "failed" : "live";
    state.reserveUpdatedAt = formatTime(new Date());
    if (items.length) {
      state.reserveItems = items;
    }
    updateReserveStatusBar();
    renderReserveFeed();
    renderNewsHubFeed();
  } catch (error) {
    console.error("load binance news failed", error);
    state.reserveStatus = "failed";
    updateReserveStatusBar();
    if (!state.reserveItems.length) {
      if (reserveFeed) {
        reserveFeed.innerHTML = `
        <div class="feed-item feed-item--compact">
        <div class="feed-title">暂时无法读取律动快讯。</div>
          <div class="feed-meta">请检查本地 8787 接口或线上 /api/blockbeats-feed 是否可访问。</div>
        </div>
      `;
      }
    }
    renderNewsHubFeed();
  }
}

function updateReserveStatusBar() {
  if (!binanceNewsStatusBar) {
    return;
  }

  const statusClass = state.reserveStatus === "live" ? "ok" : state.reserveStatus === "failed" ? "failed" : "";
  const statusText = state.reserveStatus === "live" ? "正常" : state.reserveStatus === "failed" ? "异常" : "加载中";
  binanceNewsStatusBar.innerHTML = `
    <span class="feed-health-inline">
      <span class="feed-health-dot ${statusClass}"></span>
      <span class="feed-health-text">${statusText}</span>
      <span class="feed-health-time">${state.reserveUpdatedAt ? `${state.reserveUpdatedAt} 更新` : "BlockBeats"}</span>
    </span>
  `;
}

function startReserveFeedAutoRefresh() {
  if (state.reserveFeedRefreshTimer) {
    window.clearInterval(state.reserveFeedRefreshTimer);
  }

  state.reserveFeedRefreshTimer = window.setInterval(() => {
    if (!document.hidden) {
      loadReserveFeed();
    }
  }, LISTING_REFRESH_MS);
}

function renderMacroCalendarFeed() {
  if (!macroCalendarFeed) {
    return;
  }

  if (!state.macroCalendarItems.length) {
    macroCalendarFeed.innerHTML = `
        <div class="macro-event-item">
        <div class="macro-event-title">正在读取宏观日历。</div>
        <div class="macro-event-meta">来自 Jin10 重要财经日历</div>
      </div>
    `;
    return;
  }

  macroCalendarFeed.innerHTML = state.macroCalendarItems
    .slice(0, 8)
    .map((item) => {
      const isImportant = String(item.importance || "").toLowerCase() === "true" || Number(item.importance || 0) >= 2;
      return `
        <a class="macro-event-item" href="${escapeHtml(item.link || "#")}" target="_blank" rel="noreferrer">
          <div class="macro-event-top">
            <span class="macro-event-time">${escapeHtml(item.timeText || "--:--")}</span>
            <span class="macro-event-badge ${isImportant ? "important" : ""}">${isImportant ? "重要" : "日历"}</span>
          </div>
          <div class="macro-event-title feed-line-clamp-2">${escapeHtml(item.title || "宏观事件")}</div>
          ${item.summary ? `<div class="macro-event-summary feed-line-clamp-1">${escapeHtml(item.summary)}</div>` : ""}
          <div class="macro-event-meta">
            <span>${escapeHtml(item.dateText || "")}</span>
            <span>${escapeHtml(item.sourceTag || "BB")}</span>
          </div>
        </a>
      `;
    })
    .join("");
}

function updateMacroCalendarStatusBar() {
  if (!macroCalendarStatusBar) {
    return;
  }

  const statusClass = state.macroCalendarStatus === "live" ? "ok" : state.macroCalendarStatus === "failed" ? "failed" : "";
  const statusText = state.macroCalendarStatus === "live" ? "正常" : state.macroCalendarStatus === "failed" ? "异常" : "加载中";
  macroCalendarStatusBar.innerHTML = `
    <span class="feed-health-inline">
      <span class="feed-health-dot ${statusClass}"></span>
      <span class="feed-health-text">${statusText}</span>
      <span class="feed-health-time">${state.macroCalendarUpdatedAt ? `${state.macroCalendarUpdatedAt} 更新` : "Calendar"}</span>
    </span>
  `;
}

async function loadMacroCalendarFeed() {
  if (!macroCalendarFeed) {
    return;
  }

  if (!state.macroCalendarItems.length) {
    state.macroCalendarStatus = "connecting";
    renderMacroCalendarFeed();
  }
  updateMacroCalendarStatusBar();

  try {
    const endpoint = getLocalApiEndpoint("/api/macro-calendar-feed");
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`macro calendar status ${response.status}`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : [];
    const sourceStatus = String(payload?.sourceStatus?.Jin10Calendar || "failed").toLowerCase();
    state.macroCalendarStatus = sourceStatus === "ok" ? "live" : "failed";
    state.macroCalendarUpdatedAt = formatTime(new Date());
    if (items.length) {
      state.macroCalendarItems = items;
    }
    updateMacroCalendarStatusBar();
    renderMacroCalendarFeed();
  } catch (error) {
    console.error("load macro calendar failed", error);
    state.macroCalendarStatus = "failed";
    updateMacroCalendarStatusBar();
    if (!state.macroCalendarItems.length) {
      macroCalendarFeed.innerHTML = `
        <div class="macro-event-item">
          <div class="macro-event-title">暂时无法读取宏观日历。</div>
          <div class="macro-event-meta">请检查本地 8787 接口或线上 /api/macro-calendar-feed</div>
        </div>
      `;
    }
  }
}

function startMacroCalendarAutoRefresh() {
  if (state.macroCalendarRefreshTimer) {
    window.clearInterval(state.macroCalendarRefreshTimer);
  }

  state.macroCalendarRefreshTimer = window.setInterval(() => {
    if (!document.hidden) {
      loadMacroCalendarFeed();
    }
  }, MACRO_CALENDAR_REFRESH_MS);
}

async function loadListingFeed() {
  if (!listingFeed && !newsHubFeed) {
    return;
  }

  state.listingStatus = "connecting";
  renderNewsHubFeed();

  try {
    const endpoint = getLocalApiEndpoint("/api/new-listings-feed");
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`feed status ${response.status}`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : [];
    const sourceStatus = payload?.sourceStatus || {};
    const jin10Status = String(sourceStatus.Jin10 || "failed").toLowerCase();
    const updatedAt = formatTime(new Date());
    state.listingStatus = jin10Status === "ok" ? "live" : "failed";
    state.listingUpdatedAt = updatedAt;
    state.listingItems = items;
    if (jin10StatusBar) {
      jin10StatusBar.innerHTML = `
        <span class="feed-health-inline">
          <span class="feed-health-dot ${jin10Status === "ok" ? "ok" : "failed"}"></span>
          <span class="feed-health-text">${jin10Status === "ok" ? "正常" : "异常"}</span>
          <span class="feed-health-time">${updatedAt} 更新</span>
        </span>
      `;
    }

    if (!items.length) {
      if (listingFeed) {
        listingFeed.innerHTML = `
        <div class="feed-item feed-item--compact">
          <div class="feed-title">暂未获取到推送内容。</div>
          <div class="feed-meta">当前来源：Jin10 快讯</div>
        </div>
      `;
      }
      renderNewsHubFeed();
      return;
    }

    if (listingFeed) {
      listingFeed.innerHTML = items
        .map(
          (item) => `
          <a class="feed-item feed-item--compact${getFreshNewsClass(item.publishTime)}" href="${item.link}" target="_blank" rel="noreferrer">
            <div class="feed-title feed-line-clamp-2">${item.title}</div>
            <div class="feed-meta feed-line-clamp-1">[${item.exchange}] ${item.symbols.join(" ")} ${item.summary || ""}</div>
          </a>
        `
        )
        .join("");
    }
    renderNewsHubFeed();
  } catch (error) {
    state.listingStatus = "failed";
    if (jin10StatusBar) {
      jin10StatusBar.innerHTML = `
        <span class="feed-health-inline">
          <span class="feed-health-dot failed"></span>
          <span class="feed-health-text">异常</span>
          <span class="feed-health-time">更新失败</span>
        </span>
      `;
    }
    if (listingFeed) {
      listingFeed.innerHTML = `
      <div class="feed-item feed-item--compact">
        <div class="feed-title">暂时无法读取推送内容。</div>
        <div class="feed-meta">请确认本地 8787 接口、Jin10 配置或线上 API 是否已启动</div>
      </div>
    `;
    }
    renderNewsHubFeed();
  }
}

async function loadDashboard() {
  if (state.dashboardLoading) {
    return;
  }

  state.dashboardLoading = true;
  refreshButton.disabled = true;
  setStatus("加载中...");

  try {
    const [exchangeInfo, tickers, premiumIndex, fundingInfo] = await Promise.all([
      fetchJson("/fapi/v1/exchangeInfo", { retries: 2 }),
      fetchJson("/fapi/v1/ticker/24hr", { retries: 2 }),
      fetchJsonOrDefault("/fapi/v1/premiumIndex", [], { retries: 1 }),
      fetchJsonOrDefault("/fapi/v1/fundingInfo", [], { retries: 1 })
    ]);

    const symbols = exchangeInfo.symbols.filter(
      (item) => item.contractType === "PERPETUAL" && item.quoteAsset === "USDT" && item.status === "TRADING"
    );

    const symbolMap = new Map(symbols.map((item) => [item.symbol, item]));
    const fundingMap = new Map(premiumIndex.map((item) => [item.symbol, item]));
    const fundingInfoMap = new Map(
      (Array.isArray(fundingInfo) ? fundingInfo : []).map((item) => [item.symbol, Number(item.fundingIntervalHours)])
    );

    state.symbolMetaMap = new Map(
      symbols.map((item) => {
        const priceFilter = (item.filters || []).find((filter) => filter.filterType === "PRICE_FILTER");
        const tickSizeRaw = priceFilter?.tickSize || "0.0001";
        return [
          item.symbol,
          {
            tickSize: Number(tickSizeRaw),
            tickSizeRaw
          }
        ];
      })
    );

    const allBaseRows = tickers
      .filter((item) => symbolMap.has(item.symbol))
      .map((item) => {
        const info = symbolMap.get(item.symbol);
        const funding = fundingMap.get(item.symbol) || {};
        return {
          symbol: item.symbol,
          baseAsset: info.baseAsset,
          lastPrice: Number(item.lastPrice),
          quoteVolume: Number(item.quoteVolume),
          change24h: Number(item.priceChangePercent),
          fundingRate: Number(funding.lastFundingRate || 0),
          nextFundingTime: Number(funding.nextFundingTime || 0),
          fundingIntervalHours: fundingInfoMap.get(item.symbol) || 8,
          fundingCountdownText: formatFundingInterval(fundingInfoMap.get(item.symbol) || 8)
        };
      });

    const eligibleBaseRows = allBaseRows.sort((a, b) => b.quoteVolume - a.quoteVolume);

    const detailedRows = await mapWithConcurrency(eligibleBaseRows, KLINE_CONCURRENCY, async (row) => {
      try {
        const metrics = await fetchIntervalMetrics(row.symbol);

        const fullRow = {
          ...row,
          change5m: metrics.change5m,
          change1h: metrics.change1h,
          change15m: metrics.change15m,
          heatScore: 0,
          shockTimeText: formatTime(new Date()),
          fundingCountdownText: formatFundingInterval(row.fundingIntervalHours),
          previous15mVolume: metrics.previousVolume,
          latest15mVolume: metrics.latestVolume,
          previous15mQuoteVolume: metrics.previousQuoteVolume,
          latest15mQuoteVolume: metrics.latestQuoteVolume,
          volumeKlineChange: metrics.latestChangePercent
        };

        fullRow.volumeMultiple =
          fullRow.previous15mVolume > 0 ? fullRow.latest15mVolume / fullRow.previous15mVolume : 0;
        fullRow.heatScore = getStableHeatScore(fullRow);
        return fullRow;
      } catch (error) {
        console.error(`metrics failed for ${row.symbol}`, error);
        const fallbackRow = {
          ...row,
          change5m: 0,
          change1h: 0,
          change15m: 0,
          heatScore: 0,
          shockTimeText: formatTime(new Date()),
          fundingCountdownText: formatFundingInterval(row.fundingIntervalHours),
          previous15mVolume: 0,
          latest15mVolume: 0,
          previous15mQuoteVolume: 0,
          latest15mQuoteVolume: 0,
          volumeKlineChange: 0,
          volumeMultiple: 0
        };
        fallbackRow.heatScore = getStableHeatScore(fallbackRow);
        return fallbackRow;
      }
    });

    const volumeTop = [...detailedRows].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 10);
    const gainers = [...detailedRows].sort((a, b) => b.change24h - a.change24h).slice(0, 10);
    const losers = [...detailedRows].sort((a, b) => a.change24h - b.change24h).slice(0, 10);
    const positiveFunding = [...eligibleBaseRows]
      .sort((a, b) => b.fundingRate - a.fundingRate)
      .slice(0, 10)
      .map((row) => ({
        ...row,
        fundingCountdownText: row.fundingCountdownText || formatFundingInterval(row.fundingIntervalHours || 8)
      }));
    const negativeFunding = [...eligibleBaseRows]
      .sort((a, b) => a.fundingRate - b.fundingRate)
      .slice(0, 10)
      .map((row) => ({
        ...row,
        fundingCountdownText: row.fundingCountdownText || formatFundingInterval(row.fundingIntervalHours || 8)
      }));
    const shocks = [...detailedRows]
      .filter((row) => Math.abs(row.change5m) >= 5)
      .sort((a, b) => Math.abs(b.change5m) - Math.abs(a.change5m))
      .slice(0, 12);
    const volumeAlerts = [...detailedRows]
      .filter((row) => row.volumeMultiple >= 3 && row.latest15mQuoteVolume >= MIN_VOLUME_ALERT_QUOTE_VOLUME)
      .sort((a, b) => b.volumeMultiple - a.volumeMultiple)
      .slice(0, 12);

    const shockRecords = shocks
      .filter((row) => !state.activeShockSymbols.has(row.symbol) && !hasRecentStoredAlert(row, "shock"))
      .map((row) => ({
        type: "shock",
        symbol: row.baseAsset,
        chartSymbol: row.symbol,
        price: formatPrice(row.lastPrice),
        change24h: formatPercent(row.change24h),
        change24hClass: getDeltaClass(row.change24h),
        alertValue: formatPercent(row.change5m),
        alertClass: getDeltaClass(row.change5m),
        detail: `${formatPercent(row.change5m)} / 24H ${formatPercent(row.change24h)}`,
        timeMs: Date.now(),
        timeText: formatShortDateTime(new Date())
      }));
    const volumeRecords = volumeAlerts
      .filter((row) => !state.activeVolumeSymbols.has(row.symbol) && !hasRecentStoredAlert(row, "volume"))
      .map((row) => ({
        type: "volume",
        symbol: row.baseAsset,
        chartSymbol: row.symbol,
        price: formatPrice(row.lastPrice),
        change24h: formatPercent(row.change24h),
        change24hClass: getDeltaClass(row.change24h),
        alertValue: `${row.volumeMultiple.toFixed(2)}x`,
        alertClass: getVolumeMultipleClass(row.volumeMultiple),
        volume: `${formatCompact(row.latest15mQuoteVolume)} USDT`,
        detail: `${row.volumeMultiple.toFixed(2)}x / ${formatPercent(row.volumeKlineChange)}`,
        timeMs: Date.now(),
        timeText: formatShortDateTime(new Date())
      }));

    state.activeShockSymbols = new Set(shocks.map((row) => row.symbol));
    state.activeVolumeSymbols = new Set(volumeAlerts.map((row) => row.symbol));

    state.rows = detailedRows;
    state.heatBoards = buildHeatBoards(detailedRows);
    state.heatScoreMap = new Map(detailedRows.map((row) => [row.symbol, { score: row.heatScore, updatedAt: Date.now() }]));
    saveHeatScoreState(detailedRows);
    state.moversGainers = gainers;
    state.moversLosers = losers;
    state.positiveFunding = positiveFunding;
    state.negativeFunding = negativeFunding;
    renderVolumeTopStrip(volumeTop);
    renderHeatRanking();
    renderMarketList(detailedRows);
    enrichMarketLongMetrics(detailedRows);
    ensureChartSelection(detailedRows);
    if (shockRecords.length) {
      updateHistory(shockRecords, "shock");
    }
    if (volumeRecords.length) {
      updateHistory(volumeRecords, "volume");
    }
    renderShockList(shocks);
    renderVolumeAlertList(volumeAlerts);
    renderBottomFeeds();

    updateTime();
    setStatus(`已更新 ${detailedRows.length} 个合约`);
    setRefreshState(`自动刷新：${Math.round(DASHBOARD_REFRESH_MS / 1000)}秒 · 上次 ${formatTime(new Date())}`);
  } catch (error) {
    console.error(error);
    const isLocalFile = window.location.protocol === "file:";
    const errorHint = getBinanceFailureHint();
    setStatus("加载失败");
    const failHtml = `<div class="table-row"><div class="cell">当前未能拉取币安数据，请检查网络或接口可访问性。</div></div>`;
    document.getElementById("heatTable").innerHTML = failHtml;
    renderMarketList([]);
    if (volumeTopStrip) {
      volumeTopStrip.innerHTML = `<div class="volume-chip"><div class="volume-chip-symbol">加载失败</div><div class="volume-chip-price">${isLocalFile ? "file环境受限" : "请检查网络"}</div></div>`;
    }
    if (tradingviewPanel) {
      tradingviewPanel.innerHTML = `<div class="tv-fallback">${errorHint}</div>`;
    }
    renderAlertTable(document.getElementById("shockList"), [], {
      emptyText: "加载失败，无法获取异动列表",
      columns: ["时间", "标的", "价格", "24小时涨跌", "异动数据"]
    });
    if (volumeAlertList) {
      renderAlertTable(volumeAlertList, [], {
        emptyText: "加载失败，无法获取放量列表",
        columns: ["时间", "标的", "价格", "24小时涨跌", "异动数据", "交易量"],
        volume: true
      });
    }
    renderHistory("shock");
    renderHistory("volume");
    renderBottomFeeds();
    setRefreshState(`自动刷新：${Math.round(DASHBOARD_REFRESH_MS / 1000)}秒 · 当前异常`);
  } finally {
    state.dashboardLoading = false;
    refreshButton.disabled = false;
  }
}

function startDashboardAutoRefresh() {
  if (state.dashboardRefreshTimer) {
    window.clearInterval(state.dashboardRefreshTimer);
  }

  state.dashboardRefreshTimer = window.setInterval(() => {
    if (!document.hidden) {
      loadDashboard();
    }
  }, DASHBOARD_REFRESH_MS);
}

function startListingAutoRefresh() {
  if (state.listingRefreshTimer) {
    window.clearInterval(state.listingRefreshTimer);
  }

  state.listingRefreshTimer = window.setInterval(() => {
    if (!document.hidden) {
      loadListingFeed();
    }
  }, LISTING_REFRESH_MS);
}

refreshButton.addEventListener("click", loadDashboard);
document.addEventListener("click", (event) => {
  const heatTrigger = event.target.closest("[data-heat-mode]");
  if (heatTrigger) {
    const mode = heatTrigger.getAttribute("data-heat-mode");
    if (["default", "combined", "contracts", "onchain"].includes(mode)) {
      state.heatMode = mode;
      renderHeatRanking();
    }
    return;
  }

  const moversTrigger = event.target.closest("[data-movers-mode]");
  if (moversTrigger) {
    const mode = moversTrigger.getAttribute("data-movers-mode");
    if (mode === "gainers" || mode === "losers") {
      state.moversMode = mode;
      renderMoversRanking();
    }
    return;
  }

  const fundingTrigger = event.target.closest("[data-funding-mode]");
  if (fundingTrigger) {
    const mode = fundingTrigger.getAttribute("data-funding-mode");
    if (mode === "positive" || mode === "negative") {
      state.fundingMode = mode;
      renderFundingRanking();
    }
    return;
  }

  const newsTrigger = event.target.closest("[data-news-mode]");
  if (newsTrigger) {
    const mode = newsTrigger.getAttribute("data-news-mode");
    if (["all", "bwe", "jin10", "blockbeats"].includes(mode)) {
      state.newsHubMode = mode;
      document.querySelectorAll("[data-news-mode]").forEach((button) => {
        button.classList.toggle("active", button === newsTrigger);
      });
      renderNewsHubFeed();
    }
    return;
  }

  const marketSortTrigger = event.target.closest("[data-market-sort]");
  if (marketSortTrigger) {
    const key = marketSortTrigger.getAttribute("data-market-sort");
    if (key) {
      state.marketSort = {
        key,
        direction: state.marketSort.key === key && state.marketSort.direction === "desc" ? "asc" : "desc"
      };
      renderMarketList();
    }
    return;
  }

  const trigger = event.target.closest(".symbol-trigger");
  if (trigger) {
    const symbol = trigger.getAttribute("data-chart-symbol");
    updateTradingViewSelection(symbol);
    return;
  }

  const intervalTrigger = event.target.closest("[data-chart-interval]");
  if (intervalTrigger) {
    const interval = intervalTrigger.getAttribute("data-chart-interval");
    if (interval) {
      state.selectedChartInterval = interval;
      const currentSymbol = state.selectedChartSymbol || state.rows[0]?.symbol;
      updateTradingViewSelection(currentSymbol);
    }
    return;
  }

  const clearTrigger = event.target.closest("[data-clear-history]");
  if (clearTrigger) {
    const type = clearTrigger.getAttribute("data-clear-history");
    if (type === "shock" || type === "volume") {
      clearHistory(type);
    }
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loadDashboard();
    loadListingFeed();
    loadHotEventFeed();
    loadReserveFeed();
    loadMacroCalendarFeed();
    loadSectorFeed();
    if (state.selectedChartSymbol) {
      refreshCurrentChart();
      startChartRealtime(state.selectedChartSymbol, state.selectedChartInterval);
    }
  }
});

initializeTheme();
startClock();
loadDashboard();
loadListingFeed();
loadHotEventFeed();
loadReserveFeed();
loadMacroCalendarFeed();
loadSectorFeed();
startDashboardAutoRefresh();
startListingAutoRefresh();
startHotFeedAutoRefresh();
startReserveFeedAutoRefresh();
startMacroCalendarAutoRefresh();
startSectorFeedAutoRefresh();
startFreshNewsTimer();
renderHistory("shock");
renderHistory("volume");
