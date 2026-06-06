(function () {
  "use strict";

  const LOCAL_API_ORIGIN = "http://127.0.0.1:8787";
  const REFRESH_MS = 30000;
  const REQUEST_TIMEOUT_MS = 30000;
  let inFlightLoad = null;
  let lastAccountPayload = null;
  let activeChartMode = "equity";

  const els = {
    status: document.getElementById("liveAccountStatus"),
    totalEquity: document.getElementById("liveTotalEquity"),
    todayPnl: document.getElementById("liveTodayPnl"),
    maxDrawdown: document.getElementById("liveMaxDrawdown"),
    winRate: document.getElementById("liveWinRate"),
    chartTitle: document.getElementById("liveChartTitle"),
    chartSubtitle: document.getElementById("liveChartSubtitle"),
    chartSummaryBar: document.getElementById("liveChartSummaryBar"),
    chartCanvas: document.getElementById("liveChartCanvas"),
    chartEmptyState: document.querySelector(".live-empty-state"),
    historyStatus: document.getElementById("liveHistoryStatus"),
    closedTradeStatus: document.getElementById("liveClosedTradeStatus"),
    historyTable: document.querySelector(".live-history-table"),
    closedTradesTable: document.querySelector(".live-closed-trades-table"),
    positionTable: document.querySelector(".live-position-table"),
    tabs: Array.from(document.querySelectorAll(".live-chart-tab"))
  };

  const chartCopy = {
    equity: ["资金曲线等待接入", "等待账户接口返回权益数据。"],
    return: ["收益率曲线等待接入", "等待账户接口返回权益数据。"],
    profit: ["盈利金额曲线等待接入", "等待账户接口返回权益数据。"]
  };

  const chartModeConfig = {
    equity: { title: "资金曲线", unit: "USDT", key: "equity", accent: "#22c7bd" },
    return: { title: "收益率曲线", unit: "%", key: "returnRate", accent: "#3b82f6" },
    profit: { title: "盈利金额曲线", unit: "USDT", key: "profit", accent: "#f4c95d" }
  };

  function getApiOrigins() {
    const configuredOrigin = window.DASHBOARD_CONFIG?.apiOrigin || "";

    if (window.location.protocol === "file:" || ["127.0.0.1", "localhost"].includes(window.location.hostname)) {
      return [LOCAL_API_ORIGIN].filter(Boolean);
    }

    return [window.location.origin, configuredOrigin].filter(Boolean);
  }

  function setStatus(state, message) {
    const dot = els.status?.querySelector(".feed-health-dot");
    const text = els.status?.querySelector("span:last-child");
    if (!dot || !text) return;

    dot.classList.toggle("ok", state === "ok");
    dot.classList.toggle("failed", state === "failed");
    text.textContent = message;
  }

  function setText(element, value) {
    if (element) element.textContent = value || "--";
  }

  function pnlClass(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number === 0) return "";
    return number > 0 ? "live-pnl-positive" : "live-pnl-negative";
  }

  function formatIncomeType(type) {
    const map = {
      TRANSFER: "划转",
      WELCOME_BONUS: "体验金",
      REALIZED_PNL: "已实现盈亏",
      FUNDING_FEE: "资金费",
      COMMISSION: "手续费",
      INSURANCE_CLEAR: "保险清算",
      REFERRAL_KICKBACK: "返佣",
      COMMISSION_REBATE: "手续费返还",
      API_REBATE: "API 返佣",
      CONTEST_REWARD: "活动奖励",
      CROSS_COLLATERAL_TRANSFER: "联合保证金划转",
      OPTIONS_PREMIUM_FEE: "期权权利金",
      OPTIONS_SETTLE_PROFIT: "期权结算收益",
      AUTO_EXCHANGE: "自动兑换",
      COIN_SWAP_DEPOSIT: "币种兑换入金",
      COIN_SWAP_WITHDRAW: "币种兑换出金",
      POSITION_LIMIT_INCREASE_FEE: "持仓额度提升费"
    };
    return map[type] || type || "--";
  }

  function formatTime(timestamp) {
    if (!timestamp) return "--";
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${month}/${day} ${hours}:${minutes}`;
  }

  function formatChartValue(value, mode) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "--";
    if (mode === "return") return `${number.toFixed(2)}%`;
    return `${number.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT`;
  }

  function formatPrice(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "--";
    return number >= 1000
      ? number.toLocaleString("en-US", { maximumFractionDigits: 2 })
      : number.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }

  function normalizeChartSeries(payload) {
    const rows = Array.isArray(payload?.equityHistory) ? payload.equityHistory : [];
    const history = rows
      .map((row) => ({
        time: Number(row.time) || 0,
        equity: Number(row.equity),
        returnRate: Number(row.returnRate),
        profit: Number(row.profit)
      }))
      .filter((row) => row.time && Number.isFinite(row.equity))
      .sort((a, b) => a.time - b.time);

    if (history.length) return history;

    const current = Number(payload?.equity?.current);
    if (!Number.isFinite(current)) return [];
    return [
      {
        time: Number(payload?.updatedAt) || Date.now(),
        equity: current,
        returnRate: Number(payload?.equity?.returnRate) || 0,
        profit: Number(payload?.equity?.profit) || 0
      }
    ];
  }

  function buildPath(points) {
    return points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  }

  function buildSmoothPath(points) {
    if (points.length < 2) return buildPath(points);

    const commands = [`M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
    for (let index = 0; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      const previous = points[index - 1] || current;
      const after = points[index + 2] || next;
      const tension = 0.14;
      const cp1x = current.x + (next.x - previous.x) * tension;
      const cp1y = current.y + (next.y - previous.y) * tension;
      const cp2x = next.x - (after.x - current.x) * tension;
      const cp2y = next.y - (after.y - current.y) * tension;
      commands.push(`C${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${next.x.toFixed(2)} ${next.y.toFixed(2)}`);
    }
    return commands.join(" ");
  }

  function renderChart(payload = lastAccountPayload) {
    if (!els.chartCanvas) return;

    const config = chartModeConfig[activeChartMode] || chartModeConfig.equity;
    let series = normalizeChartSeries(payload).filter((row) => Number.isFinite(Number(row[config.key])));
    if (!series.length) {
      els.chartCanvas.innerHTML = "";
      els.chartEmptyState?.classList.remove("has-chart");
      setText(els.chartSummaryBar, "等待资金曲线数据");
      setText(els.chartTitle, chartCopy[activeChartMode]?.[0]);
      setText(els.chartSubtitle, chartCopy[activeChartMode]?.[1]);
      return;
    }

    const sampleCount = series.length;
    if (series.length === 1) {
      series = [
        {
          ...series[0],
          time: series[0].time - 30 * 60 * 1000
        },
        series[0]
      ];
    }

    const width = 1000;
    const height = 320;
    const padding = { top: 34, right: 18, bottom: 42, left: 0 };
    const values = series.map((row) => Number(row[config.key]));
    const rawMinValue = Math.min(...values);
    const rawMaxValue = Math.max(...values);
    const rawRange = rawMaxValue - rawMinValue || Math.max(Math.abs(rawMaxValue), 1) * 0.02;
    const minValue = rawMinValue - rawRange * 0.08;
    const maxValue = rawMaxValue + rawRange * 0.08;
    const valueRange = maxValue - minValue;
    const minTime = series[0].time;
    const maxTime = series[series.length - 1].time;
    const timeRange = maxTime - minTime || 1;
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const points = series.map((row) => {
      const value = Number(row[config.key]);
      return {
        x: padding.left + ((row.time - minTime) / timeRange) * plotWidth,
        y: padding.top + (1 - (value - minValue) / valueRange) * plotHeight,
        value,
        time: row.time
      };
    });
    const last = points[points.length - 1];
    const firstValue = values[0];
    const lastValue = values[values.length - 1];
    const diff = lastValue - firstValue;
    const diffClass = diff >= 0 ? "live-chart-up" : "live-chart-down";
    const smoothPath = buildSmoothPath(points);
    const areaPath = `${smoothPath} L${points[points.length - 1].x.toFixed(2)} ${height - padding.bottom} L${points[0].x.toFixed(2)} ${height - padding.bottom} Z`;
    const gridLines = [0, 0.25, 0.5, 0.75, 1]
      .map((ratio) => {
        const y = padding.top + ratio * plotHeight;
        const value = maxValue - ratio * valueRange;
        return `
          <line class="live-chart-grid" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"></line>
          <text class="live-chart-axis" x="${width - padding.right - 122}" y="${y - 5}">${formatChartValue(value, activeChartMode)}</text>
        `;
      })
      .join("");
    const timeTicks = [0, 0.2, 0.4, 0.6, 0.8, 1]
      .map((ratio) => {
        const x = padding.left + ratio * plotWidth;
        const time = minTime + ratio * timeRange;
        const anchor = ratio === 0 ? "start" : ratio === 1 ? "end" : "middle";
        return `
          <line class="live-chart-time-grid" x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}"></line>
          <text class="live-chart-time" x="${x}" y="${height - 12}" text-anchor="${anchor}">${formatTime(time)}</text>
        `;
      })
      .join("");
    const summaryText = `${sampleCount} 个采样点 · 最新 ${formatChartValue(lastValue, activeChartMode)} · 较首点 ${diff >= 0 ? "+" : ""}${formatChartValue(diff, activeChartMode)}`;

    els.chartCanvas.innerHTML = `
      <svg class="live-chart-svg ${diffClass}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${config.title}">
        <defs>
          <linearGradient id="liveChartFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="currentColor" stop-opacity="0.24"></stop>
            <stop offset="72%" stop-color="currentColor" stop-opacity="0.06"></stop>
            <stop offset="100%" stop-color="currentColor" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        ${timeTicks}
        ${gridLines}
        <path class="live-chart-area" d="${areaPath}"></path>
        <path class="live-chart-path live-chart-glow" d="${smoothPath}"></path>
        <path class="live-chart-path" d="${smoothPath}"></path>
        <circle class="live-chart-dot" cx="${last.x}" cy="${last.y}" r="4.5"></circle>
        <text class="live-chart-last" x="${Math.max(padding.left + 8, Math.min(last.x + 12, width - padding.right - 180))}" y="${Math.max(24, last.y - 10)}">${formatChartValue(last.value, activeChartMode)}</text>
      </svg>
    `;
    els.chartEmptyState?.classList.add("has-chart");
    setText(els.chartSummaryBar, summaryText);
    setText(els.chartTitle, "");
    setText(els.chartSubtitle, "");
  }

  function renderHistory(rows) {
    if (!els.historyTable) return;
    const visibleRows = (rows || []).slice(0, 300);

    const head = `
      <div class="live-table-row live-table-head">
        <div>时间</div>
        <div>标的</div>
        <div>流水类型</div>
        <div>方向</div>
        <div>总资金权益</div>
        <div>收益</div>
      </div>
    `;

    if (!visibleRows.length) {
      els.historyTable.innerHTML = `${head}<div class="live-empty-row">暂无资金流水。</div>`;
      return;
    }

    els.historyTable.innerHTML = `${head}${visibleRows
      .map(
        (row) => `
          <div class="live-table-row">
            <div>${formatTime(row.time)}</div>
            <div>${row.symbol || "--"}</div>
            <div>${formatIncomeType(row.type)}</div>
            <div>${row.side || "--"}</div>
            <div>${row.totalEquity || "--"}</div>
            <div class="${pnlClass(row.pnlValue)}">${row.pnl || "--"}</div>
          </div>
        `
      )
      .join("")}${rows.length > visibleRows.length ? `<div class="live-empty-row">已显示最近 ${visibleRows.length} 条，完整记录保存在本地历史文件。</div>` : ""}`;
  }

  function renderHistoryMessage(message) {
    if (!els.historyTable) return;
    els.historyTable.innerHTML = `
      <div class="live-table-row live-table-head">
        <div>时间</div>
        <div>标的</div>
        <div>流水类型</div>
        <div>方向</div>
        <div>总资金权益</div>
        <div>收益</div>
      </div>
      <div class="live-empty-row">${message}</div>
    `;
  }

  function renderPositions(rows) {
    if (!els.positionTable) return;

    const head = `
      <div class="live-table-row live-table-head">
        <div>标的</div>
        <div>方向</div>
        <div>杠杆</div>
        <div>持仓</div>
        <div>均价</div>
        <div>浮盈亏</div>
      </div>
    `;

    if (!rows?.length) {
      els.positionTable.innerHTML = `${head}<div class="live-empty-row">暂无当前持仓。</div>`;
      return;
    }

    els.positionTable.innerHTML = `${head}${rows
      .map(
        (row) => `
          <div class="live-table-row">
            <div>${row.symbol || "--"}</div>
            <div>${row.side || "--"}</div>
            <div>${row.leverage || "--"}</div>
            <div>${row.amount || "--"}</div>
            <div>${row.entryPrice || "--"}</div>
            <div class="${pnlClass(row.pnlValue)}">${row.pnl || "--"}</div>
          </div>
        `
      )
      .join("")}`;
  }

  function renderPositionsMessage(message) {
    if (!els.positionTable) return;
    els.positionTable.innerHTML = `
      <div class="live-table-row live-table-head">
        <div>标的</div>
        <div>方向</div>
        <div>杠杆</div>
        <div>持仓</div>
        <div>均价</div>
        <div>浮盈亏</div>
      </div>
      <div class="live-empty-row">${message}</div>
    `;
  }

  function renderClosedTrades(rows) {
    if (!els.closedTradesTable) return;
    const visibleRows = (rows || []).slice(0, 200);
    const head = `
      <div class="live-table-row live-table-head">
        <div>开仓时间</div>
        <div>标的</div>
        <div>入场价格</div>
        <div>方向</div>
        <div>离场价格</div>
        <div>收益</div>
      </div>
    `;

    if (!visibleRows.length) {
      els.closedTradesTable.innerHTML = `${head}<div class="live-empty-row">暂无可重建的历史交易。成交明细同步后会显示在这里。</div>`;
      return;
    }

    els.closedTradesTable.innerHTML = `${head}${visibleRows
      .map((row) => {
        const detail = `盈亏 ${formatChartValue(row.realizedPnl || 0, "equity")} · 手续费 -${formatChartValue(row.commission || 0, "equity")} · 资金费 ${formatChartValue(row.funding || 0, "equity")}`;
        return `
          <div class="live-table-row">
            <div>${formatTime(row.openTime)}</div>
            <div>${row.symbol || "--"}</div>
            <div>${formatPrice(row.entryPrice)}</div>
            <div>${row.side || "--"}</div>
            <div>${formatPrice(row.exitPrice)}</div>
            <div class="${pnlClass(row.pnlValue)}">
              <strong>${row.pnl || formatChartValue(row.pnlValue, "equity")}</strong>
              <span>${detail}</span>
            </div>
          </div>
        `;
      })
      .join("")}${rows.length > visibleRows.length ? `<div class="live-empty-row">已显示最近 ${visibleRows.length} 笔，完整记录保存在本地历史交易文件。</div>` : ""}`;
  }

  function renderClosedTradesMessage(message) {
    if (!els.closedTradesTable) return;
    els.closedTradesTable.innerHTML = `
      <div class="live-table-row live-table-head">
        <div>开仓时间</div>
        <div>标的</div>
        <div>入场价格</div>
        <div>方向</div>
        <div>离场价格</div>
        <div>收益</div>
      </div>
      <div class="live-empty-row">${message}</div>
    `;
  }

  function getReadableError(error) {
    const message = error instanceof Error ? error.message : String(error || "");

    if (message.includes("missing BINANCE_API_KEY") || message.includes("missing BINANCE_API_SECRET")) {
      return "未读取到币安 API Key，请检查 binance-private.env。";
    }

    if (message.includes("aborted") || message.includes("timeout") || message.includes("ConnectTimeout")) {
      return "币安合约接口连接超时，请检查当前网络/VPN 或部署端网络。";
    }

    if (message.includes("-2015") || message.includes("Invalid API-key") || message.includes("IP")) {
      return "币安 API Key 权限或 IP 白名单不通过，请检查只读权限和 IP 限制。";
    }

    return message || "账户接口异常，请查看本地 API 服务日志。";
  }

  async function fetchAccountFromOrigin(origin) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${origin}/api/binance-account`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      const text = await response.text();
      let payload = null;

      try {
        payload = text ? JSON.parse(text) : null;
      } catch (error) {
        throw new Error(`${origin} 返回了非 JSON 响应`);
      }

      if (!response.ok) {
        throw new Error(payload?.detail || payload?.error || `${origin} HTTP ${response.status}`);
      }
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`${origin} request timeout`);
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function fetchAccountWithFallback() {
    const origins = [...new Set(getApiOrigins())];
    let lastError = null;

    for (const origin of origins) {
      try {
        const payload = await fetchAccountFromOrigin(origin);
        payload._apiOrigin = origin;
        return payload;
      } catch (error) {
        lastError = error;
        console.warn(`Binance account load failed from ${origin}:`, error);
      }
    }

    throw lastError || new Error("no account api origin available");
  }

  function renderAccount(payload) {
    const summary = payload?.summary || {};
    lastAccountPayload = payload;
    setText(els.totalEquity, summary.totalEquity);
    setText(els.todayPnl, summary.todayPnl);
    setText(els.maxDrawdown, summary.maxDrawdown);
    setText(els.winRate, summary.winRate);

    els.todayPnl?.classList.toggle("live-pnl-positive", Number(payload?.equity?.profit) > 0);
    els.todayPnl?.classList.toggle("live-pnl-negative", Number(payload?.equity?.profit) < 0);

    let runningEquity = Number(payload?.equity?.current);
    const hasRunningEquity = Number.isFinite(runningEquity);
    const historyRows = (payload?.history || []).map((row) => {
      const totalEquity = hasRunningEquity ? formatChartValue(runningEquity, "equity") : row.totalEquity || summary.totalEquity || "--";
      if (hasRunningEquity) runningEquity -= Number(row.pnlValue) || 0;
      return {
        ...row,
        totalEquity
      };
    });
    renderHistory(historyRows);
    renderPositions(payload?.positions || []);
    renderClosedTrades(payload?.closedTrades || []);
    renderChart(payload);
    setText(els.historyStatus, payload?.history?.length ? `已追溯 ${payload.history.length} 条` : "暂无历史记录");
    setText(els.closedTradeStatus, payload?.closedTrades?.length ? `已重建 ${payload.closedTrades.length} 笔` : "等待成交明细");
    if (payload?.preview) {
      setText(els.chartTitle, "本地预览数据");
      setText(els.chartSubtitle, "当前网络无法连接 Binance Futures，已显示本地预览数据；网络恢复后会自动切回真实账户。");
    }

    const statusPrefix = payload?.preview ? "预览" : payload?.stale ? "缓存" : payload?.cached ? "快速" : "正常";
    setStatus(payload?.stale ? "failed" : "ok", `${statusPrefix} ${formatTime(payload?.updatedAt)} 更新`);
  }

  async function loadAccount() {
    if (inFlightLoad) return inFlightLoad;

    setStatus("pending", lastAccountPayload ? "刷新中..." : "读取中...");
    inFlightLoad = (async () => {
      try {
        const payload = await fetchAccountWithFallback();
        renderAccount(payload);
      } catch (error) {
        const readableError = getReadableError(error);
        setStatus("failed", lastAccountPayload ? "刷新失败" : "接口异常");
        if (lastAccountPayload) {
          setText(els.chartSubtitle, `${readableError}；已保留上次成功数据。`);
          console.warn("Binance account refresh failed; keeping last payload:", error);
          return;
        }
        setText(els.chartTitle, "实盘接口未连接");
        setText(els.chartSubtitle, readableError);
        renderHistoryMessage(readableError);
        renderPositionsMessage(readableError);
        renderClosedTradesMessage(readableError);
        console.warn("Binance account load failed:", error);
      } finally {
        inFlightLoad = null;
      }
    })();

    try {
      await inFlightLoad;
    } finally {
      inFlightLoad = null;
    }
  }

  function bindTabs() {
    els.tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const mode = tab.dataset.liveChartMode || "equity";
        activeChartMode = mode;
        els.tabs.forEach((item) => item.classList.toggle("active", item === tab));
        renderChart();
      });
    });
  }

  bindTabs();
  loadAccount();
  window.setInterval(loadAccount, REFRESH_MS);
})();
