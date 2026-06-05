(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id") || "";
  const title = params.get("title") || "视频播放";
  const titleEl = document.getElementById("playerTitle");
  const frameEl = document.getElementById("videoEmbedFrame");
  const errorEl = document.getElementById("videoPlayerError");

  if (titleEl) titleEl.textContent = title;

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
