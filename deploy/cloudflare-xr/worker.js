import { DurableObject } from "cloudflare:workers";
import {
  CONSENT_VERSION,
  GEMINI_MODEL,
  TOKEN_SESSION_MINUTES,
  TOOLS_VERSION,
  dayAt,
  limitsFrom,
  quotaResult,
  readAdmission,
  tokenRequest,
} from "./voice-policy.mjs";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
};
const GEMINI_LIVE_SOCKET = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function error(code, status, requestId) {
  return json({ error: { code }, requestId }, status, { "X-Request-Id": requestId });
}

function notFound() {
  return new Response("Not found\n", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}

export class VoiceQuota extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS daily_global (
        day TEXT PRIMARY KEY,
        count INTEGER NOT NULL CHECK (count >= 0)
      );
      CREATE TABLE IF NOT EXISTS daily_device (
        day TEXT NOT NULL,
        device_id TEXT NOT NULL,
        count INTEGER NOT NULL CHECK (count >= 0),
        PRIMARY KEY (day, device_id)
      );
    `);
  }

  async fetch(request) {
    if (request.method !== "POST") return error("method_not_allowed", 405, crypto.randomUUID());
    const body = await request.json().catch(() => null);
    if (
      !body || typeof body.day !== "string" || typeof body.deviceId !== "string" ||
      !Number.isSafeInteger(body.deviceLimit) || !Number.isSafeInteger(body.globalLimit)
    ) {
      return error("invalid_quota_request", 400, crypto.randomUUID());
    }

    const result = this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM daily_global WHERE day < ?", body.day);
      this.sql.exec("DELETE FROM daily_device WHERE day < ?", body.day);
      this.sql.exec("INSERT OR IGNORE INTO daily_global(day, count) VALUES (?, 0)", body.day);
      this.sql.exec("INSERT OR IGNORE INTO daily_device(day, device_id, count) VALUES (?, ?, 0)", body.day, body.deviceId);
      const globalCount = this.sql.exec("SELECT count FROM daily_global WHERE day = ?", body.day).one().count;
      const deviceCount = this.sql.exec("SELECT count FROM daily_device WHERE day = ? AND device_id = ?", body.day, body.deviceId).one().count;
      const admitted = quotaResult(Number(globalCount), Number(deviceCount), { device: body.deviceLimit, global: body.globalLimit });
      if (!admitted.allowed) return admitted;
      this.sql.exec("UPDATE daily_global SET count = count + 1 WHERE day = ?", body.day);
      this.sql.exec("UPDATE daily_device SET count = count + 1 WHERE day = ? AND device_id = ?", body.day, body.deviceId);
      return admitted;
    });
    return json(result, result.allowed ? 200 : 429);
  }
}

async function parseSmallJson(request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 2_048) throw new RangeError("body_too_large");
  const text = await request.text();
  if (text.length > 2_048) throw new RangeError("body_too_large");
  return JSON.parse(text);
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}

function retryAfterUtcDay(now = Date.now()) {
  const date = new Date(now);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return String(Math.max(1, Math.ceil((next - now) / 1_000)));
}

async function createToken(request, env) {
  const requestId = crypto.randomUUID();
  if (request.method !== "POST") return error("method_not_allowed", 405, requestId);
  if (!sameOrigin(request)) return error("cross_origin_refused", 403, requestId);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return error("content_type_required", 415, requestId);
  }
  if (!env.GEMINI_API_KEY) return error("voice_not_configured", 503, requestId);

  let raw;
  try {
    raw = await parseSmallJson(request);
  } catch (cause) {
    return error(cause instanceof RangeError ? cause.message : "invalid_json", 400, requestId);
  }
  const admission = readAdmission(raw);
  if (!admission.ok) return error(admission.code, 400, requestId);

  const limits = limitsFrom(env);
  const quota = env.VOICE_QUOTA.getByName("voice-global");
  const admitted = await quota.fetch("https://voice-quota.invalid/admit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      day: dayAt(),
      deviceId: admission.deviceId,
      deviceLimit: limits.device,
      globalLimit: limits.global,
    }),
  });
  const quotaBody = await admitted.json();
  if (!admitted.ok) {
    const response = error(quotaBody.code ?? "quota_refused", admitted.status, requestId);
    if (admitted.status === 429) response.headers.set("Retry-After", retryAfterUtcDay());
    return response;
  }

  let upstream;
  try {
    upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify(tokenRequest()),
    });
  } catch {
    return error("gemini_unavailable", 502, requestId);
  }
  if (!upstream.ok) {
    console.warn("Gemini token request refused", { status: upstream.status, requestId });
    return error("gemini_token_refused", 502, requestId);
  }
  const token = await upstream.json().catch(() => null);
  if (!token || typeof token.name !== "string") return error("gemini_token_invalid", 502, requestId);

  return json(
    {
      token: token.name,
      model: GEMINI_MODEL,
      consentVersion: CONSENT_VERSION,
      toolsVersion: TOOLS_VERSION,
      expiresInSeconds: TOKEN_SESSION_MINUTES * 60,
      quota: {
        deviceRemaining: Math.max(0, limits.device - Number(quotaBody.deviceCount ?? 0)),
        globalRemaining: Math.max(0, limits.global - Number(quotaBody.globalCount ?? 0)),
      },
    },
    200,
    { "X-Request-Id": requestId },
  );
}

function liveProxy(request) {
  if (!sameOrigin(request)) return error("cross_origin_refused", 403, crypto.randomUUID());
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return error("websocket_upgrade_required", 426, crypto.randomUUID());
  }

  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  let upstream = null;
  let authenticating = true;
  const authTimer = setTimeout(() => server.close(1008, "authentication timeout"), 5_000);

  const close = (socket, code = 1011, reason = "relay closed") => {
    if (socket?.readyState === 0 || socket?.readyState === 1) socket.close(code, reason.slice(0, 120));
  };
  server.addEventListener("message", (event) => {
    if (authenticating) {
      authenticating = false;
      clearTimeout(authTimer);
      if (typeof event.data !== "string" || event.data.length > 4_096) {
        server.close(1008, "invalid authentication");
        return;
      }
      let token;
      try {
        token = JSON.parse(event.data)?.authToken;
      } catch {
        token = null;
      }
      if (typeof token !== "string" || token.length < 20 || token.length > 4_000) {
        server.close(1008, "invalid authentication");
        return;
      }

      upstream = new WebSocket(`${GEMINI_LIVE_SOCKET}?access_token=${encodeURIComponent(token)}`);
      upstream.addEventListener("open", () => server.send(JSON.stringify({ proxyReady: true })));
      upstream.addEventListener("message", (message) => {
        if (server.readyState === 1) server.send(message.data);
      });
      upstream.addEventListener("close", (closed) => close(server, closed.code || 1011, closed.reason || "Gemini closed"));
      upstream.addEventListener("error", () => close(server, 1011, "Gemini connection failed"));
      return;
    }
    if (upstream?.readyState === 1) upstream.send(event.data);
  });
  server.addEventListener("close", (closed) => close(upstream, closed.code || 1000, closed.reason || "client closed"));
  server.addEventListener("error", () => close(upstream));

  return new Response(null, { status: 101, webSocket: client });
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/voice/token") return createToken(request, env);
    if (url.pathname === "/api/voice/live") return liveProxy(request);
    if (url.pathname.startsWith("/api/voice/")) return notFound();
    return notFound();
  },
};

export default worker;
