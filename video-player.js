(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id") || "";
  const title = params.get("title") || "视频播放";
  const date = params.get("date") || "";
  const titleEl = document.getElementById("playerTitle");
  const infoTitleEl = document.getElementById("playerInfoTitle");
  const infoMetaEl = document.getElementById("playerInfoMeta");
  const frameEl = document.getElementById("videoEmbedFrame");
  const errorEl = document.getElementById("videoPlayerError");

  if (titleEl) titleEl.textContent = title;
  if (infoTitleEl) infoTitleEl.textContent = title;
  if (infoMetaEl) infoMetaEl.textContent = date ? `26年${date} · 视频课程` : "YouTube 视频课程";

  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    if (errorEl) errorEl.hidden = false;
    return;
  }

  if (frameEl) {
    frameEl.innerHTML = `
      <iframe
        src="https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0"
        title="${title.replace(/"/g, "&quot;")}"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
      ></iframe>
    `;
  }
})();
