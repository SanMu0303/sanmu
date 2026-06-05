(function () {
  "use strict";

  const STORAGE_KEY = "sanmu.video.library.v1";
  const DEFAULT_VIDEOS = [];

  const els = {
    urlInput: document.getElementById("youtubeUrlInput"),
    titleInput: document.getElementById("videoTitleInput"),
    addButton: document.getElementById("addVideoButton"),
    formStatus: document.getElementById("videoFormStatus"),
    list: document.getElementById("videoList"),
    count: document.getElementById("videoCount"),
    previewEmpty: document.getElementById("videoPreviewEmpty"),
    previewCard: document.getElementById("videoPreviewCard"),
    previewThumb: document.getElementById("videoPreviewThumb"),
    previewTitle: document.getElementById("videoPreviewTitle"),
    previewMeta: document.getElementById("videoPreviewMeta"),
    openSelectedButton: document.getElementById("openSelectedVideoButton"),
    recentList: document.getElementById("videoRecentList"),
    typeList: document.getElementById("videoTypeList")
  };

  const isAdmin = document.body?.dataset.videoAdmin === "true";
  let videos = [];
  let selectedId = "";

  function loadCachedVideos() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      console.warn("failed to load video library", error);
    }
    return DEFAULT_VIDEOS;
  }

  function saveCachedVideos() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
  }

  function getApiOrigin() {
    const configuredOrigin = window.DASHBOARD_CONFIG?.apiOrigin || "";

    if (window.location.protocol === "file:" || ["127.0.0.1", "localhost"].includes(window.location.hostname)) {
      return "http://127.0.0.1:8787";
    }

    return configuredOrigin || window.location.origin;
  }

  function getVideosEndpoint(id = "") {
    const url = `${getApiOrigin()}/api/videos`;
    return id ? `${url}?id=${encodeURIComponent(id)}` : url;
  }

  async function requestVideoStore(path = "", options = {}) {
    const headers = {
      Accept: "application/json",
      ...(options.headers || {})
    };

    const response = await fetch(path || getVideosEndpoint(), {
      cache: "no-store",
      ...options,
      headers
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.detail || payload?.error || `video api HTTP ${response.status}`);
    }
    return payload;
  }

  async function loadVideos() {
    try {
      const payload = await requestVideoStore();
      videos = Array.isArray(payload.items) ? payload.items : [];
      selectedId = videos[0]?.id || "";
      saveCachedVideos();
      setStatus(isAdmin ? "已读取长期保存的视频列表。" : "");
    } catch (error) {
      videos = loadCachedVideos();
      selectedId = videos[0]?.id || "";
      setStatus("视频 API 暂不可用，正在显示本机缓存。", true);
      console.warn("failed to load persistent videos", error);
    }
    render();
  }

  function getYoutubeId(value) {
    const input = String(value || "").trim();
    if (!input) return "";

    try {
      const url = new URL(input);
      if (url.hostname.includes("youtu.be")) return url.pathname.slice(1).split("/")[0];
      if (url.searchParams.get("v")) return url.searchParams.get("v");
      const shortsMatch = url.pathname.match(/\/shorts\/([^/?#]+)/);
      if (shortsMatch) return shortsMatch[1];
      const embedMatch = url.pathname.match(/\/embed\/([^/?#]+)/);
      if (embedMatch) return embedMatch[1];
    } catch (error) {
      return /^[a-zA-Z0-9_-]{11}$/.test(input) ? input : "";
    }

    return "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getThumbUrl(id) {
    return `https://img.youtube.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
  }

  function getVideoUrl(id) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  }

  function formatDate(timestamp) {
    const date = new Date(timestamp || Date.now());
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${month}/${day} ${hours}:${minutes}`;
  }

  function getIssueLabel(index) {
    return `第${Math.max(1, videos.length - index)}期`;
  }

  function setStatus(message, failed = false) {
    if (!els.formStatus) return;
    els.formStatus.textContent = message || "";
    els.formStatus.classList.toggle("failed", Boolean(failed));
  }

  function selectVideo(id) {
    selectedId = id;
    render();
  }

  function openVideo(video) {
    if (!video) return;
    selectedId = video.id;
    render();
    const params = new URLSearchParams({
      id: video.id,
      title: video.title || "YouTube 视频",
      date: formatDate(video.createdAt)
    });
    window.open(`./video-player.html?${params.toString()}`, "_blank", "noopener,noreferrer,width=1120,height=720");
  }

  async function addVideo() {
    const id = getYoutubeId(els.urlInput?.value);
    if (!id) {
      setStatus("请输入有效的 YouTube 链接。", true);
      return;
    }

    const existing = videos.find((video) => video.id === id);
    if (existing) {
      selectedId = existing.id;
      setStatus("视频已在列表中。");
      render();
      return;
    }

    const title = els.titleInput?.value.trim() || `YouTube 视频 ${id}`;
    const video = {
      id,
      title,
      url: getVideoUrl(id),
      createdAt: Date.now()
    };

    try {
      setStatus("正在保存到长期列表...");
      const payload = await requestVideoStore(getVideosEndpoint(), {
        method: "POST",
        admin: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(video)
      });
      videos = Array.isArray(payload.items) ? payload.items : [video, ...videos];
      selectedId = id;
      saveCachedVideos();
      if (els.urlInput) els.urlInput.value = "";
      if (els.titleInput) els.titleInput.value = "";
      setStatus("已保存到长期视频列表。");
      render();
    } catch (error) {
      setStatus(`保存失败：${error.message}`, true);
    }
  }

  async function removeVideo(id) {
    try {
      setStatus("正在删除...");
      const payload = await requestVideoStore(getVideosEndpoint(id), {
        method: "DELETE",
        admin: true
      });
      videos = Array.isArray(payload.items) ? payload.items : videos.filter((video) => video.id !== id);
      if (selectedId === id) selectedId = videos[0]?.id || "";
      saveCachedVideos();
      setStatus("已从长期视频列表删除。");
      render();
    } catch (error) {
      setStatus(`删除失败：${error.message}`, true);
    }
  }

  function renderList() {
    if (!els.list) return;

    if (!videos.length) {
      els.list.innerHTML = `<div class="video-empty-state">暂无视频。请在视频管理页添加 YouTube 链接。</div>`;
      return;
    }

    els.list.innerHTML = videos
      .map((video, index) => `
        <article class="video-list-item${video.id === selectedId ? " active" : ""}" data-video-id="${video.id}">
          <button class="video-list-main" type="button" data-video-action="open" data-video-id="${video.id}">
            <span class="video-card-art" style="--thumb: url('${getThumbUrl(video.id)}')">
              <img src="${getThumbUrl(video.id)}" alt="" loading="lazy" />
              <em>${isAdmin ? "视频" : index === 0 ? "会员专属" : "登录可看"}</em>
              <b>20:00</b>
            </span>
            <span>
              <strong>${escapeHtml(video.title)}</strong>
              <small>26年${formatDate(video.createdAt)} · ${getIssueLabel(index)}</small>
            </span>
          </button>
          ${isAdmin ? `
            <div class="video-list-actions">
              <button type="button" data-video-action="open" data-video-id="${video.id}">播放</button>
              <button type="button" data-video-action="remove" data-video-id="${video.id}">删除</button>
            </div>
          ` : ""}
        </article>
      `)
      .join("");
  }

  function renderPreview() {
    const selected = videos.find((video) => video.id === selectedId);
    if (els.count) els.count.textContent = `${videos.length} 个视频`;

    if (!selected) {
      if (els.previewEmpty) els.previewEmpty.hidden = false;
      if (els.previewCard) els.previewCard.hidden = true;
      return;
    }

    if (els.previewEmpty) els.previewEmpty.hidden = true;
    if (els.previewCard) els.previewCard.hidden = false;
    if (els.previewThumb) els.previewThumb.src = getThumbUrl(selected.id);
    if (els.previewTitle) els.previewTitle.textContent = selected.title;
    if (els.previewMeta) els.previewMeta.textContent = `${formatDate(selected.createdAt)} · YouTube`;
  }

  function render() {
    renderList();
    renderPreview();
    renderRecent();
  }

  function renderRecent() {
    if (!els.recentList) return;

    if (!videos.length) {
      els.recentList.innerHTML = `<div class="video-empty-state">暂无更新。</div>`;
      return;
    }

    els.recentList.innerHTML = videos.slice(0, 4)
      .map((video, index) => `
        <button type="button" data-video-action="open" data-video-id="${video.id}">
          <span>▶</span>
          <strong>${getIssueLabel(index)} · ${escapeHtml(video.title)}</strong>
          <small>${index === 0 ? "最新" : formatDate(video.createdAt)}</small>
        </button>
      `)
      .join("");
  }

  els.addButton?.addEventListener("click", addVideo);
  els.urlInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addVideo();
  });
  els.titleInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addVideo();
  });
  els.openSelectedButton?.addEventListener("click", () => openVideo(videos.find((video) => video.id === selectedId)));
  els.list?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-video-action]");
    if (!button) return;

    const id = button.dataset.videoId;
    const action = button.dataset.videoAction;
    const video = videos.find((item) => item.id === id);
    if (action === "select") selectVideo(id);
    if (action === "open") openVideo(video);
    if (action === "remove") removeVideo(id);
  });
  els.recentList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-video-action]");
    if (!button) return;

    const video = videos.find((item) => item.id === button.dataset.videoId);
    if (button.dataset.videoAction === "open") openVideo(video);
  });
  els.typeList?.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    els.typeList.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  });

  render();
  loadVideos();
})();
