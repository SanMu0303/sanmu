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
    openSelectedButton: document.getElementById("openSelectedVideoButton")
  };

  const isAdmin = document.body?.dataset.videoAdmin === "true";
  let videos = loadVideos();
  let selectedId = videos[0]?.id || "";

  function loadVideos() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      console.warn("failed to load video library", error);
    }
    return DEFAULT_VIDEOS;
  }

  function saveVideos() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
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
      title: video.title || "YouTube 视频"
    });
    window.open(`./video-player.html?${params.toString()}`, "_blank", "noopener,noreferrer,width=1120,height=720");
  }

  function addVideo() {
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
    videos = [video, ...videos];
    selectedId = id;
    saveVideos();
    if (els.urlInput) els.urlInput.value = "";
    if (els.titleInput) els.titleInput.value = "";
    setStatus("已添加视频。");
    render();
  }

  function removeVideo(id) {
    videos = videos.filter((video) => video.id !== id);
    if (selectedId === id) selectedId = videos[0]?.id || "";
    saveVideos();
    setStatus("已移除视频。");
    render();
  }

  function renderList() {
    if (!els.list) return;

    if (!videos.length) {
      els.list.innerHTML = `<div class="video-empty-state">暂无视频。</div>`;
      return;
    }

    els.list.innerHTML = videos
      .map((video) => `
        <article class="video-list-item${video.id === selectedId ? " active" : ""}" data-video-id="${video.id}">
          <button class="video-list-main" type="button" data-video-action="open" data-video-id="${video.id}">
            <img src="${getThumbUrl(video.id)}" alt="" loading="lazy" />
            <span>
              <strong>${escapeHtml(video.title)}</strong>
              <small>${formatDate(video.createdAt)} · ${video.id}</small>
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

  render();
})();
