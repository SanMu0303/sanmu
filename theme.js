(function () {
  const THEME_STORAGE_KEY = "dashboard_theme_mode_v1";
  const DARK_CLASS = "theme-dark";
  const listeners = new Set();

  function getTheme() {
    return document.documentElement.classList.contains(DARK_CLASS) || document.body.classList.contains(DARK_CLASS)
      ? "dark"
      : "light";
  }

  function updateButtons(theme) {
    document.querySelectorAll("[data-theme-toggle], #themeToggleButton").forEach((button) => {
      const isDark = theme === "dark";
      button.textContent = isDark ? "☀" : "☾";
      button.setAttribute("aria-label", isDark ? "切换到亮色模式" : "切换到暗色模式");
      button.setAttribute("title", isDark ? "切换到亮色模式" : "切换到暗色模式");
    });
  }

  function applyTheme(theme, options = {}) {
    const normalizedTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.classList.toggle(DARK_CLASS, normalizedTheme === "dark");
    if (document.body) {
      document.body.classList.toggle(DARK_CLASS, normalizedTheme === "dark");
    }
    updateButtons(normalizedTheme);

    if (!options.silent) {
      listeners.forEach((listener) => listener(normalizedTheme));
    }
  }

  function saveTheme(theme) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      console.error("save theme failed", error);
    }
  }

  function loadTheme() {
    try {
      return window.localStorage.getItem(THEME_STORAGE_KEY) || "light";
    } catch (error) {
      return "light";
    }
  }

  function toggleTheme() {
    const nextTheme = getTheme() === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    saveTheme(nextTheme);
    return nextTheme;
  }

  function bindButtons() {
    document.querySelectorAll("[data-theme-toggle], #themeToggleButton").forEach((button) => {
      if (button.dataset.themeBound === "true") return;
      button.dataset.themeBound = "true";
      button.addEventListener("click", toggleTheme);
    });
  }

  function initTheme() {
    applyTheme(loadTheme() === "dark" ? "dark" : "light", { silent: true });
    bindButtons();
  }

  window.SanmuTheme = {
    apply: applyTheme,
    get: getTheme,
    init: initTheme,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    toggle: toggleTheme
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTheme, { once: true });
  } else {
    initTheme();
  }
})();
