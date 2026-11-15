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
  if (!upstream.ok) return error("gemini_token_refused", 502, requestId);
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

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/voice/token") return createToken(request, env);
    if (url.pathname.startsWith("/api/voice/")) return notFound();
    return notFound();
  },
};

export default worker;
