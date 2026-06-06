(function () {
  "use strict";

  const STORAGE_KEY = "sanmu.video.library.v1";
  const DEFAULT_CATEGORIES = ["视频课程", "技术指标", "形态分析", "交易策略", "技术模型"];
  const DEFAULT_CATEGORY = "视频课程";
  const DEFAULT_VIDEOS = [];

  const els = {
    urlInput: document.getElementById("youtubeUrlInput"),
    titleInput: document.getElementById("videoTitleInput"),
    categorySelect: document.getElementById("videoCategorySelect"),
    newCategoryInput: document.getElementById("videoNewCategoryInput"),
    githubTokenInput: document.getElementById("videoGithubTokenInput"),
    githubRepoInput: document.getElementById("videoGithubRepoInput"),
    githubBranchInput: document.getElementById("videoGithubBranchInput"),
    githubPathInput: document.getElementById("videoGithubPathInput"),
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
    typeList: document.getElementById("videoTypeList"),
    categoryPageTitle: document.getElementById("videoCategoryPageTitle"),
    categoryHeading: document.getElementById("videoCategoryHeading"),
    categorySubtitle: document.getElementById("videoCategorySubtitle")
  };

  const isAdmin = document.body?.dataset.videoAdmin === "true";
  const isCategoryPage = document.body?.dataset.videoCategoryPage === "true";
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

  function normalizeStore(payload) {
    return {
      items: (Array.isArray(payload?.items) ? payload.items : [])
        .filter((video) => video?.id)
        .map((video) => ({
          ...video,
          category: String(video.category || DEFAULT_CATEGORY).trim() || DEFAULT_CATEGORY
        }))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    };
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

  function getGithubClientConfig() {
    return {
      token: els.githubTokenInput?.value.trim() || window.localStorage.getItem("sanmu.video.githubToken") || "",
      repo: els.githubRepoInput?.value.trim() || window.localStorage.getItem("sanmu.video.githubRepo") || "",
      branch: els.githubBranchInput?.value.trim() || window.localStorage.getItem("sanmu.video.githubBranch") || "main",
      path: els.githubPathInput?.value.trim() || window.localStorage.getItem("sanmu.video.githubPath") || "videos.json"
    };
  }

  function saveGithubClientConfig() {
    const config = getGithubClientConfig();
    if (config.token) window.localStorage.setItem("sanmu.video.githubToken", config.token);
    if (config.repo) window.localStorage.setItem("sanmu.video.githubRepo", config.repo);
    if (config.branch) window.localStorage.setItem("sanmu.video.githubBranch", config.branch);
    if (config.path) window.localStorage.setItem("sanmu.video.githubPath", config.path);
  }

  function encodeGithubPath(path) {
    return String(path || "videos.json")
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
  }

  function toBase64(text) {
    return btoa(unescape(encodeURIComponent(text)));
  }

  function fromBase64(text) {
    return decodeURIComponent(escape(atob(text || "")));
  }

  async function fetchStaticVideoStore() {
    const response = await fetch(`./videos.json?ts=${Date.now()}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(`static videos HTTP ${response.status}`);
    return normalizeStore(payload);
  }

  async function fetchGithubClientFile() {
    const config = getGithubClientConfig();
    if (!config.repo) throw new Error("请填写 GitHub 仓库，例如 用户名/仓库名");
    if (!/^[^/\s]+\/[^/\s]+$/.test(config.repo)) {
      throw new Error("GitHub 仓库格式应为 用户名/仓库名，例如 SanMu0303/你的仓库名");
    }

    const response = await fetch(`https://api.github.com/repos/${config.repo}/contents/${encodeGithubPath(config.path)}?ref=${encodeURIComponent(config.branch)}`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {})
      }
    });

    if (response.status === 404) {
      return { store: { items: [] }, sha: "" };
    }

    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message || `GitHub HTTP ${response.status}`);

    return {
      store: normalizeStore(JSON.parse(fromBase64(payload.content || ""))),
      sha: payload.sha || ""
    };
  }

  async function saveGithubClientStore(store) {
    const config = getGithubClientConfig();
    if (!config.token) throw new Error("请填写 GitHub Token");
    if (!config.repo) throw new Error("请填写 GitHub 仓库，例如 用户名/仓库名");
    if (!/^[^/\s]+\/[^/\s]+$/.test(config.repo)) {
      throw new Error("GitHub 仓库格式应为 用户名/仓库名，例如 SanMu0303/你的仓库名");
    }

    const current = await fetchGithubClientFile();
    const body = {
      message: "Update video library",
      branch: config.branch,
      content: toBase64(`${JSON.stringify(normalizeStore(store), null, 2)}\n`)
    };
    if (current.sha) body.sha = current.sha;

    const response = await fetch(`https://api.github.com/repos/${config.repo}/contents/${encodeGithubPath(config.path)}`, {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message || `GitHub save HTTP ${response.status}`);
    return normalizeStore(store);
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
      try {
        const payload = isAdmin && getGithubClientConfig().repo ? await fetchGithubClientFile().then((result) => result.store) : await fetchStaticVideoStore();
        videos = Array.isArray(payload.items) ? payload.items : [];
        selectedId = videos[0]?.id || "";
        saveCachedVideos();
        setStatus(isAdmin ? "已从 GitHub/静态文件读取视频列表。" : "");
      } catch (fallbackError) {
        videos = loadCachedVideos();
        selectedId = videos[0]?.id || "";
        setStatus("视频 API 暂不可用，正在显示本机缓存。", true);
      }
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

  function getCurrentCategory() {
    return new URLSearchParams(window.location.search).get("category") || "";
  }

  function getVideoCategory(video) {
    return String(video?.category || DEFAULT_CATEGORY).trim() || DEFAULT_CATEGORY;
  }

  function getCategories() {
    return Array.from(new Set([...DEFAULT_CATEGORIES, ...videos.map(getVideoCategory)])).filter(Boolean);
  }

  function getCategoryCounts() {
    return videos.reduce((counts, video) => {
      const category = getVideoCategory(video);
      counts[category] = (counts[category] || 0) + 1;
      return counts;
    }, {});
  }

  function getVisibleVideos() {
    const category = getCurrentCategory();
    if (!isCategoryPage || !category) return videos;
    return videos.filter((video) => getVideoCategory(video) === category);
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
    const category = els.newCategoryInput?.value.trim() || els.categorySelect?.value || DEFAULT_CATEGORY;
    const video = {
      id,
      title,
      category,
      url: getVideoUrl(id),
      createdAt: Date.now()
    };

    try {
      setStatus("正在保存到长期列表...");
      let payload;
      try {
        payload = await requestVideoStore(getVideosEndpoint(), {
          method: "POST",
          admin: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(video)
        });
      } catch (apiError) {
        saveGithubClientConfig();
        const githubStore = await fetchGithubClientFile();
        payload = await saveGithubClientStore({
          items: [video, ...githubStore.store.items.filter((item) => item.id !== video.id)]
        });
      }
      videos = Array.isArray(payload.items) ? payload.items : [video, ...videos];
      selectedId = id;
      saveCachedVideos();
      if (els.urlInput) els.urlInput.value = "";
      if (els.titleInput) els.titleInput.value = "";
      if (els.newCategoryInput) els.newCategoryInput.value = "";
      setStatus("已保存到长期视频列表。");
      render();
    } catch (error) {
      setStatus(`保存失败：${error.message}`, true);
    }
  }

  async function removeVideo(id) {
    try {
      setStatus("正在删除...");
      let payload;
      try {
        payload = await requestVideoStore(getVideosEndpoint(id), {
          method: "DELETE",
          admin: true
        });
      } catch (apiError) {
        saveGithubClientConfig();
        const githubStore = await fetchGithubClientFile();
        payload = await saveGithubClientStore({
          items: githubStore.store.items.filter((item) => item.id !== id)
        });
      }
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

    const visibleVideos = getVisibleVideos();

    if (!visibleVideos.length) {
      els.list.innerHTML = `<div class="video-empty-state">暂无视频。请在视频管理页添加 YouTube 链接。</div>`;
      return;
    }

    els.list.innerHTML = visibleVideos
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
              <small>${getVideoCategory(video)} · 26年${formatDate(video.createdAt)} · ${getIssueLabel(index)}</small>
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
    const visibleVideos = getVisibleVideos();
    if (els.count) els.count.textContent = `${visibleVideos.length} 个视频`;
    if (els.categoryPageTitle && getCurrentCategory()) els.categoryPageTitle.textContent = getCurrentCategory();
    if (els.categoryHeading && getCurrentCategory()) els.categoryHeading.textContent = getCurrentCategory();
    if (els.categorySubtitle && getCurrentCategory()) els.categorySubtitle.textContent = `${getCurrentCategory()} 类型下共有 ${visibleVideos.length} 个视频。`;

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
    renderTypes();
    renderCategorySelect();
  }

  function renderCategorySelect() {
    if (!els.categorySelect) return;
    const current = els.categorySelect.value || DEFAULT_CATEGORY;
    els.categorySelect.innerHTML = getCategories()
      .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
      .join("");
    els.categorySelect.value = getCategories().includes(current) ? current : DEFAULT_CATEGORY;
  }

  function renderTypes() {
    if (!els.typeList) return;
    const counts = getCategoryCounts();
    const total = videos.length;
    const categories = getCategories();
    els.typeList.innerHTML = `
      <button class="active" type="button" data-category-link="./video.html">
        <span>全部视频</span><strong>${total}</strong>
      </button>
      ${categories.map((category) => `
        <button type="button" data-category-link="./video-category.html?category=${encodeURIComponent(category)}">
          <span>${escapeHtml(category)}</span><strong>${counts[category] || 0}</strong>
        </button>
      `).join("")}
    `;
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
          <img src="${getThumbUrl(video.id)}" alt="" loading="lazy" />
          <span>
            <strong>${escapeHtml(video.title)}</strong>
            <small>${getVideoCategory(video)} · ${formatDate(video.createdAt)}${index === 0 ? " · 最新" : ""}</small>
          </span>
          ${index === 0 ? "<em>NEW</em>" : ""}
        </button>
      `)
      .join("");
  }

  els.addButton?.addEventListener("click", addVideo);
  if (els.githubTokenInput) els.githubTokenInput.value = window.localStorage.getItem("sanmu.video.githubToken") || "";
  if (els.githubRepoInput) els.githubRepoInput.value = window.localStorage.getItem("sanmu.video.githubRepo") || "";
  if (els.githubBranchInput) els.githubBranchInput.value = window.localStorage.getItem("sanmu.video.githubBranch") || "main";
  if (els.githubPathInput) els.githubPathInput.value = window.localStorage.getItem("sanmu.video.githubPath") || "videos.json";
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
    const link = button.dataset.categoryLink;
    if (link) window.location.href = link;
  });

  render();
  loadVideos();
})();
