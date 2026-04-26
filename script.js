const API_BASE = "https://fapi.binance.com";
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
const updateTimeNode = document.getElementById("updateTime");
const fetchStatusNode = document.getElementById("fetchStatus");
const tradingviewPanel = document.getElementById("tradingviewPanel");
const volumeAlertList = document.getElementById("volumeAlertList");
const hotEventFeed = document.getElementById("hotEventFeed");
const listingFeed = document.getElementById("listingFeed");
const state = {
  rows: [],
  selectedChartSymbol: ""
};

function setStatus(text) {
  fetchStatusNode.textContent = text;
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

function formatTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(
    date.getSeconds()
  ).padStart(2, "0")}`;
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

function getChainName(baseAsset) {
  return CHAIN_MAP[baseAsset] || "Unknown";
}

function getTradingViewSymbol(symbol) {
  return `BINANCE:${symbol}.P`;
}

function getTradingViewPageUrl(symbol) {
  const tvSymbol = getTradingViewSymbol(symbol);
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`;
}

function detectEmbeddedContext() {
  const ua = navigator.userAgent || "";
  const isFileProtocol = window.location.protocol === "file:";
  const maybeIab =
    ua.includes("WebView") ||
    ua.includes("wv") ||
    ua.includes("MicroMessenger") ||
    ua.includes("Line/") ||
    ua.includes("Instagram") ||
    ua.includes("FBAN") ||
    ua.includes("FBAV") ||
    ua.includes("Electron");

  return {
    isFileProtocol,
    maybeIab,
    constrained: isFileProtocol || maybeIab
  };
}

function getHeatScore(row) {
  const volumeScore = Math.min(Math.max(Math.log10(Math.max(row.quoteVolume, 1)) * 12, 0), 100);
  const momentumScore = Math.min(Math.max((row.change24h + 10) * 4, 0), 100);
  const shortTermScore = Math.min(Math.max(Math.abs(row.change15m) * 10, 0), 100);
  return Math.round(volumeScore * 0.4 + momentumScore * 0.35 + shortTermScore * 0.25);
}

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }
  return response.json();
}

async function fetchKlineChange(symbol, interval) {
  const klines = await fetchJson(`/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=2`);
  const previousOpen = Number(klines[0]?.[1]);
  const latestClose = Number(klines[1]?.[4] ?? klines[0]?.[4]);
  if (!Number.isFinite(previousOpen) || !Number.isFinite(latestClose) || previousOpen === 0) {
    return 0;
  }
  return ((latestClose - previousOpen) / previousOpen) * 100;
}

async function fetchKlineSnapshot(symbol, interval) {
  const klines = await fetchJson(`/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=2`);
  const previous = klines[0];
  const latest = klines[1] ?? klines[0];
  const latestOpen = Number(latest?.[1] || 0);
  const latestClose = Number(latest?.[4] || 0);
  const latestChangePercent =
    latestOpen > 0 && Number.isFinite(latestClose) ? ((latestClose - latestOpen) / latestOpen) * 100 : 0;

  return {
    previousVolume: Number(previous?.[5] || 0),
    latestVolume: Number(latest?.[5] || 0),
    latestChangePercent
  };
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

      return rowBaseTemplate(
        row,
        `
          <div class="cell right">${formatPrice(row.lastPrice)}</div>
          <div class="cell right">
            <div class="funding-meta">
              <strong class="${getDeltaClass(row.fundingRate)}">${formatFunding(row.fundingRate)}/${row.fundingCountdownText}</strong>
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

function renderTradingViewChart(row) {
  if (!tradingviewPanel) {
    return;
  }

  if (!row) {
    tradingviewPanel.innerHTML = `<div class="tv-fallback">暂无图表数据</div>`;
    return;
  }

  const quickSymbols = [row.symbol, "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];
  const uniqueSymbols = [...new Set(quickSymbols)];
  const env = detectEmbeddedContext();
  const tipHtml = env.constrained
    ? `
      <div class="tv-tip">
        <strong>当前环境可能限制外链跳转。</strong>
        你现在是 ${env.isFileProtocol ? "file:// 本地页面" : "内嵌浏览器"}，
        上线到正式 https 站点后通常可以直接跳转；如果当前打不开，建议复制链接到系统浏览器打开。
      </div>
    `
    : `
      <div class="tv-tip">
        <strong>当前是标准网页环境。</strong>
        可直接打开 TradingView，支持搜索标的、切换周期和使用完整工具栏。
      </div>
    `;

  tradingviewPanel.innerHTML = `
    <div class="tv-single">
      <div class="tv-toolbar">
        <span class="tv-title">${row.baseAsset} 永续</span>
        <span class="tv-subtitle">${row.symbol} · 可搜索标的 / 可切周期</span>
      </div>

      <div class="tv-chart-wrap">
        <div class="tradingview-widget-container">
          <div class="tradingview-widget-container__widget" id="tradingviewWidget"></div>
        </div>
      </div>

      <div class="tv-actions">
        <a class="tv-button" href="${getTradingViewPageUrl(row.symbol)}" target="_blank" rel="noreferrer">打开完整K线</a>
        <a class="tv-button secondary" href="https://www.tradingview.com/chart/" target="_blank" rel="noreferrer">打开 TradingView 首页图表</a>
        <div class="tv-chip-list">
          ${uniqueSymbols
            .map(
              (symbol) => `
                <a class="tv-chip" href="${getTradingViewPageUrl(symbol)}" target="_blank" rel="noreferrer">
                  ${symbol.replace("USDT", "")}
                </a>
              `
            )
            .join("")}
        </div>
      </div>

      ${tipHtml}
    </div>
  `;

  const widgetContainer = document.getElementById("tradingviewWidget");
  if (!widgetContainer) {
    return;
  }

  const script = document.createElement("script");
  script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
  script.async = true;
  script.textContent = JSON.stringify({
    autosize: true,
    symbol: getTradingViewSymbol(row.symbol),
    interval: "15",
    timezone: "Asia/Shanghai",
    theme: "light",
    style: "1",
    locale: "zh_CN",
    withdateranges: true,
    hide_side_toolbar: false,
    hide_top_toolbar: false,
    allow_symbol_change: true,
    save_image: true,
    calendar: false,
    studies: ["Volume@tv-basicstudies"],
    support_host: "https://www.tradingview.com"
  });
  widgetContainer.innerHTML = "";
  widgetContainer.appendChild(script);

  window.setTimeout(() => {
    if (!widgetContainer.childElementCount) {
      widgetContainer.innerHTML = `<div class="tv-fallback">图表未成功加载，请使用下方按钮打开完整 TradingView</div>`;
    }
  }, 5000);
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

  const targetPanel = document.getElementById("chainPanel");
  if (targetPanel) {
    targetPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderShockList(rows) {
  const target = document.getElementById("shockList");
  if (!rows.length) {
    target.innerHTML = `<div class="shock-item"><div class="shock-left"><strong>暂无异常</strong><span>当前没有满足阈值的标的</span></div></div>`;
    return;
  }

  target.innerHTML = `
    <div class="shock-list">
      ${rows
        .map(
          (row) => `
            <div class="shock-item">
              <div class="shock-left">
                <strong>${row.baseAsset}</strong>
                <span>${formatPrice(row.lastPrice)}</span>
              </div>
              <div class="shock-right">
                <strong class="${getDeltaClass(row.change5m)}">${formatPercent(row.change5m)}</strong>
                <span>24H ${formatPercent(row.change24h)}</span>
                <span>时间 ${row.shockTimeText}</span>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderVolumeAlertList(rows) {
  if (!volumeAlertList) {
    return;
  }

  if (!rows.length) {
    volumeAlertList.innerHTML = `<div class="shock-item"><div class="shock-left"><strong>暂无异常</strong><span>当前没有满足放量条件的标的</span></div></div>`;
    return;
  }

  volumeAlertList.innerHTML = `
    <div class="shock-list">
      ${rows
        .map(
          (row) => `
            <div class="shock-item">
              <div class="shock-left">
                <strong>${row.baseAsset}</strong>
                <span>${formatPrice(row.lastPrice)}</span>
              </div>
              <div class="shock-right">
                <strong class="up">${row.volumeMultiple.toFixed(2)}x</strong>
                <span class="${getDeltaClass(row.volumeKlineChange)}">K线涨跌 ${formatPercent(row.volumeKlineChange)}</span>
                <span>15m现量 ${formatCompact(row.latest15mVolume)}</span>
                <span>前量 ${formatCompact(row.previous15mVolume)}</span>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderBottomFeeds() {
  if (hotEventFeed) {
    hotEventFeed.innerHTML = `
      <div class="feed-item">
        <div class="feed-title">预留热点事件位：后续可接推特热点、项目公告、宏观快讯。</div>
        <div class="feed-meta">占位内容 · 待接接口</div>
      </div>
      <div class="feed-item">
        <div class="feed-title">预留事件提醒位：适合显示突发新闻、合作动态、链上异动摘要。</div>
        <div class="feed-meta">占位内容 · 待接接口</div>
      </div>
    `;
  }

  if (listingFeed) {
    listingFeed.innerHTML = `
      <div class="feed-item">
        <div class="feed-title">正在尝试读取多交易所上新公告。</div>
        <div class="feed-meta">当前优先接入 Binance / OKX / Bybit</div>
      </div>
    `;
  }
}

async function loadListingFeed() {
  if (!listingFeed) {
    return;
  }

  if (window.location.protocol === "file:") {
    listingFeed.innerHTML = `
      <div class="feed-item">
        <div class="feed-title">本地 file:// 环境无法调用 Vercel API。</div>
        <div class="feed-meta">上线后会从 Binance / OKX / Bybit 公告自动拉取上新通知</div>
      </div>
    `;
    return;
  }

  try {
    const response = await fetch("/api/new-listings-feed");
    if (!response.ok) {
      throw new Error(`feed status ${response.status}`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : [];

    if (!items.length) {
      listingFeed.innerHTML = `
        <div class="feed-item">
          <div class="feed-title">暂未获取到多交易所上新公告。</div>
          <div class="feed-meta">当前公告页可能暂无匹配的新上币/新合约内容</div>
        </div>
      `;
      return;
    }

    listingFeed.innerHTML = items
      .slice(0, 6)
      .map(
        (item) => `
          <a class="feed-item" href="${item.link}" target="_blank" rel="noreferrer">
            <div class="feed-title">${item.title}</div>
            <div class="feed-meta">[${item.exchange}] ${item.symbols.join(" ")} ${item.summary || ""}</div>
          </a>
        `
      )
      .join("");
  } catch (error) {
    listingFeed.innerHTML = `
      <div class="feed-item">
        <div class="feed-title">暂时无法读取多交易所上新公告。</div>
        <div class="feed-meta">接口失败后会保留这个占位提示</div>
      </div>
    `;
  }
}

async function loadDashboard() {
  refreshButton.disabled = true;
  setStatus("加载中...");

  try {
    const [exchangeInfo, tickers, premiumIndex, fundingInfo] = await Promise.all([
      fetchJson("/fapi/v1/exchangeInfo"),
      fetchJson("/fapi/v1/ticker/24hr"),
      fetchJson("/fapi/v1/premiumIndex"),
      fetchJson("/fapi/v1/fundingInfo")
    ]);

    const symbols = exchangeInfo.symbols.filter(
      (item) => item.contractType === "PERPETUAL" && item.quoteAsset === "USDT" && item.status === "TRADING"
    );

    const symbolMap = new Map(symbols.map((item) => [item.symbol, item]));
    const fundingMap = new Map(premiumIndex.map((item) => [item.symbol, item]));
    const fundingInfoMap = new Map(
      (Array.isArray(fundingInfo) ? fundingInfo : []).map((item) => [item.symbol, Number(item.fundingIntervalHours)])
    );

    const baseRows = tickers
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
          fundingIntervalHours: fundingInfoMap.get(item.symbol) || 8
        };
      })
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, 24);

    const detailedRows = await Promise.all(
      baseRows.map(async (row) => {
        const [change5m, change15m, kline15m] = await Promise.all([
          fetchKlineChange(row.symbol, PERIODS.p5m),
          fetchKlineChange(row.symbol, PERIODS.p15m),
          fetchKlineSnapshot(row.symbol, PERIODS.p15m)
        ]);

        const fullRow = {
          ...row,
          change5m,
          change15m,
          heatScore: 0,
          shockTimeText: formatTime(new Date()),
          fundingCountdownText: formatFundingInterval(row.fundingIntervalHours),
          previous15mVolume: kline15m.previousVolume,
          latest15mVolume: kline15m.latestVolume,
          volumeKlineChange: kline15m.latestChangePercent
        };

        fullRow.volumeMultiple =
          fullRow.previous15mVolume > 0 ? fullRow.latest15mVolume / fullRow.previous15mVolume : 0;
        fullRow.heatScore = getHeatScore(fullRow);
        return fullRow;
      })
    );

    const heatTop = [...detailedRows].sort((a, b) => b.heatScore - a.heatScore).slice(0, 10);
    const defaultChartRow =
      detailedRows.find((row) => row.symbol === state.selectedChartSymbol) ||
      [...detailedRows].sort((a, b) => b.heatScore - a.heatScore)[0];
    const gainers = [...detailedRows].sort((a, b) => b.change24h - a.change24h).slice(0, 5);
    const losers = [...detailedRows].sort((a, b) => a.change24h - b.change24h).slice(0, 5);
    const positiveFunding = [...detailedRows].sort((a, b) => b.fundingRate - a.fundingRate).slice(0, 5);
    const negativeFunding = [...detailedRows].sort((a, b) => a.fundingRate - b.fundingRate).slice(0, 5);
    const shocks = [...detailedRows]
      .filter((row) => Math.abs(row.change5m) >= 5)
      .sort((a, b) => Math.abs(b.change5m) - Math.abs(a.change5m))
      .slice(0, 12);
    const volumeAlerts = [...detailedRows]
      .filter((row) => row.volumeMultiple >= 3)
      .sort((a, b) => b.volumeMultiple - a.volumeMultiple)
      .slice(0, 12);

    state.rows = detailedRows;
    state.selectedChartSymbol = defaultChartRow ? defaultChartRow.symbol : "";
    renderTable("heatTable", heatTop, "heat");
    renderTradingViewChart(defaultChartRow);
    renderTable("gainersTable", gainers, "movers");
    renderTable("losersTable", losers, "movers");
    renderTable("positiveFundingTable", positiveFunding, "funding");
    renderTable("negativeFundingTable", negativeFunding, "funding");
    renderShockList(shocks);
    renderVolumeAlertList(volumeAlerts);
    renderBottomFeeds();
    loadListingFeed();

    updateTime();
    setStatus(`已更新 ${detailedRows.length} 个合约`);
  } catch (error) {
    console.error(error);
    setStatus("加载失败");
    const failHtml = `<div class="table-row"><div class="cell">当前未能拉取币安数据，请检查网络或接口可访问性。</div></div>`;
    ["heatTable", "gainersTable", "losersTable", "positiveFundingTable", "negativeFundingTable"].forEach((id) => {
      document.getElementById(id).innerHTML = failHtml;
    });
    if (tradingviewPanel) {
      tradingviewPanel.innerHTML = `<div class="tv-fallback">当前未能加载 TradingView 图表</div>`;
    }
    document.getElementById("shockList").innerHTML =
      `<div class="shock-item"><div class="shock-left"><strong>加载失败</strong><span>无法获取异动列表</span></div></div>`;
    if (volumeAlertList) {
      volumeAlertList.innerHTML =
        `<div class="shock-item"><div class="shock-left"><strong>加载失败</strong><span>无法获取放量列表</span></div></div>`;
    }
    renderBottomFeeds();
    loadListingFeed();
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", loadDashboard);
document.addEventListener("click", (event) => {
  const trigger = event.target.closest(".symbol-trigger");
  if (!trigger) {
    return;
  }

  const symbol = trigger.getAttribute("data-chart-symbol");
  updateTradingViewSelection(symbol);
});

loadDashboard();
