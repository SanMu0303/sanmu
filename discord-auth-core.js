"use strict";

const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_USER_URL = "https://discord.com/api/users/@me";
const DEFAULT_RETURN_TO = "/auth.html";

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function parseState(state) {
  try {
    const parsed = JSON.parse(base64UrlDecode(state));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function getEnv(name) {
  return process.env[name] || "";
}

function getRedirectUri(requestUrl) {
  return (
    getEnv("DISCORD_REDIRECT_URI") ||
    `${requestUrl.protocol}//${requestUrl.host}/api/discord-callback`
  );
}

function buildReturnUrl(returnTo, params) {
  const fallback = DEFAULT_RETURN_TO;
  let target = returnTo || fallback;

  try {
    const url = new URL(target);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
    return url.toString();
  } catch (error) {
    const url = new URL(target, "https://sanmu-trading.local");
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
    return `${url.pathname}${url.search}${url.hash}`;
  }
}

async function exchangeDiscordCode(code, requestUrl) {
  const clientId = getEnv("DISCORD_CLIENT_ID");
  const clientSecret = getEnv("DISCORD_CLIENT_SECRET");
  const redirectUri = getRedirectUri(requestUrl);

  if (!clientId || !clientSecret) {
    const error = new Error("missing Discord OAuth environment variables");
    error.statusCode = 500;
    throw error;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
  });

  const tokenResponse = await fetch(DISCORD_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    const error = new Error(tokenPayload.error_description || tokenPayload.error || "failed to exchange Discord code");
    error.statusCode = 502;
    throw error;
  }

  const userResponse = await fetch(DISCORD_USER_URL, {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` }
  });
  const user = await userResponse.json().catch(() => ({}));
  if (!userResponse.ok || !user.id) {
    const error = new Error(user.message || "failed to load Discord user");
    error.statusCode = 502;
    throw error;
  }

  return {
    id: user.id,
    email: user.email || "",
    username: user.global_name || user.username || "Discord 用户"
  };
}

async function handleDiscordCallback(requestUrl) {
  const code = requestUrl.searchParams.get("code") || "";
  const state = parseState(requestUrl.searchParams.get("state") || "");
  const returnTo = state.returnTo || DEFAULT_RETURN_TO;

  if (!code) {
    return buildReturnUrl(returnTo, {
      discord_error: "missing_code"
    });
  }

  try {
    const user = await exchangeDiscordCode(code, requestUrl);
    return buildReturnUrl(returnTo, {
      discord_auth: "1",
      discord_id: user.id,
      discord_email: user.email,
      discord_name: user.username
    });
  } catch (error) {
    return buildReturnUrl(returnTo, {
      discord_error: error instanceof Error ? error.message : String(error)
    });
  }
}

module.exports = {
  handleDiscordCallback
};
