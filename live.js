(function () {
  "use strict";

  const LOCAL_API_ORIGIN = "http://127.0.0.1:8787";
  const REFRESH_MS = 30000;
  const REQUEST_TIMEOUT_MS = 12000;
  let inFlightLoad = null;
  let lastAccountPayload = null;

  const els = {
    status: document.getElementById("liveAccountStatus"),
    totalEquity: document.getElementById("liveTotalEquity"),
    todayPnl: document.getElementById("liveTodayPnl"),
    maxDrawdown: document.getElementById("liveMaxDrawdown"),
    winRate: document.getElementById("liveWinRate"),
    chartTitle: document.getElementById("liveChartTitle"),
    chartSubtitle: document.getElementById("liveChartSubtitle"),
    historyTable: document.querySelector(".live-history-table"),
    positionTable: document.querySelector(".live-position-table"),
    tabs: Array.from(document.querySelectorAll(".live-chart-tab"))
  };

  const chartCopy = {
    equity: ["资金曲线等待接入", "已接入当前权益。后续增加权益历史后，将在这里绘制资金曲线。"],
    return: ["收益率曲线等待接入", "后续 API 返回收益率序列后，将在这里绘制收益率曲线。"],
    profit: ["盈利金额曲线等待接入", "后续 API 返回盈利金额序列后，将在这里绘制盈利金额曲线。"]
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

  function formatTime(timestamp) {
    if (!timestamp) return "--";
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${month}/${day} ${hours}:${minutes}`;
  }

  function renderHistory(rows) {
    if (!els.historyTable) return;

    const head = `
      <div class="live-table-row live-table-head">
        <div>时间</div>
        <div>标的</div>
        <div>类型</div>
        <div>方向</div>
        <div>平仓</div>
        <div>收益</div>
      </div>
    `;

    if (!rows?.length) {
      els.historyTable.innerHTML = `${head}<div class="live-empty-row">暂无历史收益流水。</div>`;
      return;
    }

    els.historyTable.innerHTML = `${head}${rows
      .map(
        (row) => `
          <div class="live-table-row">
            <div>${formatTime(row.time)}</div>
            <div>${row.symbol || "--"}</div>
            <div>${row.type || "--"}</div>
            <div>${row.side || "--"}</div>
            <div>${row.close || "--"}</div>
            <div class="${pnlClass(row.pnlValue)}">${row.pnl || "--"}</div>
          </div>
        `
      )
      .join("")}`;
  }

  function renderHistoryMessage(message) {
    if (!els.historyTable) return;
    els.historyTable.innerHTML = `
      <div class="live-table-row live-table-head">
        <div>时间</div>
        <div>标的</div>
        <div>类型</div>
        <div>方向</div>
        <div>平仓</div>
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

    renderHistory(payload?.history || []);
    renderPositions(payload?.positions || []);
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
        els.tabs.forEach((item) => item.classList.toggle("active", item === tab));
        setText(els.chartTitle, chartCopy[mode]?.[0]);
        setText(els.chartSubtitle, chartCopy[mode]?.[1]);
      });
    });
  }

  bindTabs();
  loadAccount();
  window.setInterval(loadAccount, REFRESH_MS);
})();
