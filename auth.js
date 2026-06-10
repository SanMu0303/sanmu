(function () {
  const ACCOUNT_KEY = "sanmu.auth.accounts";
  const SESSION_KEY = "sanmu.auth.session";
  const AUTH_VERSION = 1;

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function loadAccounts() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(ACCOUNT_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function saveAccounts(accounts) {
    window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(accounts));
  }

  function getSession() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
      if (!parsed || !parsed.email) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function setSession(email) {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        email: normalizeEmail(email),
        loginAt: new Date().toISOString(),
        version: AUTH_VERSION
      })
    );
  }

  function clearSession() {
    window.localStorage.removeItem(SESSION_KEY);
  }

  function createSalt() {
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return `${Date.now()}-${Math.random()}`;
  }

  async function hashPassword(password, salt) {
    const source = `${salt}:${password}`;
    if (window.crypto?.subtle) {
      const encoded = new TextEncoder().encode(source);
      const digest = await window.crypto.subtle.digest("SHA-256", encoded);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return btoa(unescape(encodeURIComponent(source)));
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => {
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };
      return map[char] || char;
    });
  }

  function setStatus(message, type = "") {
    const status = qs("#authStatus");
    if (!status) return;
    status.textContent = message;
    status.dataset.type = type;
  }

  function setActiveTab(tabName) {
    qsa("[data-auth-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.authTab === tabName);
    });
    qs("#loginForm")?.classList.toggle("active", tabName === "login");
    qs("#registerForm")?.classList.toggle("active", tabName === "register");
    setStatus("");
  }

  function handleDiscordLogin() {
    const authUrl = window.DASHBOARD_CONFIG?.discordAuthUrl || "";
    if (authUrl) {
      window.location.href = authUrl;
      return;
    }
    setStatus("Discord 登录入口已创建，后续配置 OAuth 地址后即可跳转。", "error");
  }

  async function handleRegister(event) {
    event.preventDefault();
    const email = normalizeEmail(qs("#registerEmailInput")?.value);
    const password = qs("#registerPasswordInput")?.value || "";
    const confirm = qs("#registerConfirmInput")?.value || "";

    if (!isValidEmail(email)) {
      setStatus("请输入正确的邮箱地址。", "error");
      return;
    }
    if (password.length < 8) {
      setStatus("密码至少需要 8 位。", "error");
      return;
    }
    if (password !== confirm) {
      setStatus("两次输入的密码不一致。", "error");
      return;
    }

    const accounts = loadAccounts();
    if (accounts.some((account) => account.email === email)) {
      setStatus("这个邮箱已经注册，可以直接登录。", "error");
      return;
    }

    const salt = createSalt();
    const passwordHash = await hashPassword(password, salt);
    accounts.push({
      email,
      salt,
      passwordHash,
      createdAt: new Date().toISOString(),
      version: AUTH_VERSION
    });
    saveAccounts(accounts);
    setSession(email);
    setStatus("注册成功，已为你登录。", "success");
    updateAuthWidget();
  }

  async function handleLogin(event) {
    event.preventDefault();
    const email = normalizeEmail(qs("#loginEmailInput")?.value);
    const password = qs("#loginPasswordInput")?.value || "";
    const account = loadAccounts().find((item) => item.email === email);

    if (!account) {
      setStatus("没有找到这个邮箱，请先注册。", "error");
      return;
    }

    const passwordHash = await hashPassword(password, account.salt);
    if (passwordHash !== account.passwordHash) {
      setStatus("密码不正确，请重新输入。", "error");
      return;
    }

    setSession(email);
    setStatus("登录成功。", "success");
    updateAuthWidget();
  }

  function updateAuthWidget() {
    const widget = qs("[data-auth-widget]");
    if (!widget) return;
    const session = getSession();
    if (!session) {
      widget.innerHTML = `<a class="auth-nav-button" href="./auth.html">登录 / 注册</a>`;
      return;
    }
    const safeEmail = escapeHtml(session.email);
    widget.innerHTML = `
      <span class="auth-user-chip" title="${safeEmail}">${safeEmail}</span>
      <button class="auth-logout-button" type="button" data-auth-logout>退出</button>
    `;
    qs("[data-auth-logout]", widget)?.addEventListener("click", () => {
      clearSession();
      updateAuthWidget();
      if (document.body.classList.contains("auth-page-body")) {
        setStatus("已退出登录。", "success");
      }
    });
  }

  function mountAuthWidget() {
    const toolbar = qs(".toolbar-meta");
    if (!toolbar || qs("[data-auth-widget]", toolbar)) return;
    const widget = document.createElement("div");
    widget.className = "auth-widget";
    widget.dataset.authWidget = "true";
    toolbar.appendChild(widget);
    updateAuthWidget();
  }

  function initAuthPage() {
    qsa("[data-auth-tab]").forEach((button) => {
      button.addEventListener("click", () => setActiveTab(button.dataset.authTab));
    });
    qs("#discordLoginButton")?.addEventListener("click", handleDiscordLogin);
    qs("#registerForm")?.addEventListener("submit", handleRegister);
    qs("#loginForm")?.addEventListener("submit", handleLogin);

    const session = getSession();
    if (session) setStatus(`当前已登录：${session.email}`, "success");
  }

  window.SanmuAuth = {
    getSession,
    logout: clearSession
  };

  document.addEventListener("DOMContentLoaded", () => {
    mountAuthWidget();
    if (document.body.classList.contains("auth-page-body")) initAuthPage();
  });
})();
