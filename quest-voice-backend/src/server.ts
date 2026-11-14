import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { encodePcm16Wav, extractPcm16Mono } from "./audio.ts";
import { readConfig } from "./config.ts";
import { VoiceInputError } from "./errors.ts";
import { runGeminiLive } from "./gemini-live-client.ts";
import { RequestGate } from "./request-gate.ts";
import { MemorySessionStore } from "./session-store.ts";
import { parseVoiceContext } from "./types.ts";

const config = readConfig();
const sessions = new MemorySessionStore(config.sessionTtlMs, config.maxHistoryTurns);
const requestGate = new RequestGate(config.maxRequestsPerMinute, config.maxRequestsPerDay, config.maxConcurrentTurns);
const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;
const COMMON_HEADERS = {
  "cache-control": "no-store",
  "cross-origin-resource-policy": "same-site",
  "iynk-api-version": "1.0",
  "x-content-type-options": "nosniff",
};
const active = new Set<AbortController>();
let draining = false;

function requestId(request: IncomingMessage): string {
  const supplied = request.headers["x-request-id"];
  return typeof supplied === "string" && REQUEST_ID.test(supplied) ? supplied : `req_${randomBytes(10).toString("hex")}`;
}

function sendJson(response: ServerResponse, status: number, requestIdValue: string, body: unknown, extra: Record<string, string> = {}): void {
  if (response.destroyed || response.headersSent) return;
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    ...COMMON_HEADERS,
    ...extra,
    "content-type": "application/json; charset=utf-8",
    "content-length": bytes.length,
    "x-request-id": requestIdValue,
  });
  response.end(bytes);
}

function sendError(response: ServerResponse, status: number, code: string, message: string, requestIdValue: string, extra: Record<string, string> = {}): void {
  sendJson(response, status, requestIdValue, { error: { code, message, requestId: requestIdValue } }, extra);
}

function authorized(value: string | undefined): boolean {
  const match = /^Bearer (\S+)$/.exec(value ?? "");
  if (!match) return false;
  const actual = Buffer.from(match[1] as string);
  const expected = Buffer.from(config.clientToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function validSessionId(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,100}$/.test(value);
}

async function readBody(request: IncomingMessage, maximum: number): Promise<Buffer> {
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maximum) throw new Error("payload_too_large");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > maximum) throw new Error("payload_too_large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function setCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!config.allowedOrigins.includes(origin)) return false;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-expose-headers", "retry-after, server-timing, x-request-id, iynk-api-version");
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-headers", "authorization, content-type, iynk-client, x-request-id");
  response.setHeader("access-control-allow-methods", "POST, DELETE, OPTIONS");
  response.setHeader("access-control-max-age", "600");
  return true;
}

const server = createServer(async (request, response) => {
  const started = Date.now();
  const id = requestId(request);
  const aborter = new AbortController();
  active.add(aborter);
  response.on("close", () => {
    if (!response.writableFinished) aborter.abort();
  });
  let status = 500;
  let geminiTiming: { setupMs: number; firstAudioMs: number; totalMs: number } | undefined;
  try {
    if (!setCors(request, response)) {
      status = 403;
      return sendError(response, status, "forbidden_origin", "This origin may not call the API.", id);
    }
    if (request.method === "OPTIONS") {
      status = 204;
      response.writeHead(status, { ...COMMON_HEADERS, "x-request-id": id }).end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://voice.local");
    if (request.method === "GET" && ["/health", "/healthz", "/readyz"].includes(url.pathname)) {
      status = draining ? 503 : 200;
      return sendJson(response, status, id, { ok: !draining, draining });
    }
    if (draining) {
      status = 503;
      return sendError(response, status, "draining", "The service is restarting. Try again shortly.", id, { "retry-after": "5" });
    }
    if (!authorized(request.headers.authorization)) {
      status = 401;
      return sendError(response, status, "unauthorized", "A valid voice client token is required.", id, { "www-authenticate": 'Bearer realm="iynkware-voice"' });
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/v1/voice/sessions/")) {
      let sessionId = "";
      try {
        sessionId = decodeURIComponent(url.pathname.slice("/v1/voice/sessions/".length));
      } catch {}
      if (!validSessionId(sessionId)) {
        status = 400;
        return sendError(response, status, "invalid_session_id", "The session ID is invalid.", id);
      }
      sessions.clear(sessionId);
      status = 200;
      return sendJson(response, status, id, { ok: true });
    }
    if (request.method !== "POST" || url.pathname !== "/v1/voice/turn") {
      status = 404;
      return sendError(response, status, "not_found", "Not found.", id);
    }
    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.startsWith("multipart/form-data;")) {
      status = 415;
      return sendError(response, status, "unsupported_media_type", "Send multipart form data with an audio file.", id);
    }
    const body = await readBody(request, config.maxAudioBytes + 100_000);
    let form: FormData;
    try {
      form = await new Response(Uint8Array.from(body), { headers: { "content-type": contentType } }).formData();
    } catch {
      status = 400;
      return sendError(response, status, "invalid_multipart", "The multipart request is malformed.", id);
    }
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size === 0 || audio.size > config.maxAudioBytes) {
      status = 400;
      return sendError(response, status, "invalid_audio", "Send one non-empty WAV file within the configured size limit.", id);
    }
    let context;
    let pcm;
    try {
      context = parseVoiceContext(form);
      pcm = extractPcm16Mono(Buffer.from(await audio.arrayBuffer()));
    } catch (error) {
      status = 400;
      const code = error instanceof VoiceInputError ? error.code : "invalid_audio";
      return sendError(response, status, code, error instanceof Error ? error.message : "The voice turn is invalid.", id);
    }
    const maximumPcmBytes = config.maxAudioSeconds * 16_000 * 2;
    if (pcm.length < 8_000 || pcm.length > maximumPcmBytes) {
      status = 400;
      return sendError(response, status, "invalid_audio_duration", `Record between 0.25 and ${config.maxAudioSeconds} seconds of speech.`, id);
    }
    const admission = requestGate.admit();
    if (!admission.ok) {
      status = 429;
      const retryAfter = admission.reason === "daily_limit_reached" ? "86400" : "60";
      return sendError(response, status, admission.reason, "The voice usage limit was reached. Try again later.", id, { "retry-after": retryAfter });
    }
    try {
      let spoken;
      try {
        spoken = await runGeminiLive(config, pcm, context, sessions.get(context.sessionId), aborter.signal);
      } catch {
        // Never log upstream exception text: network errors can include the key-bearing WebSocket URL.
        console.error(JSON.stringify({ event: "voice_upstream_error", requestId: id, category: "gemini_live_failed" }));
        status = 502;
        return sendError(response, status, "voice_upstream_failed", "The voice assistant is temporarily unavailable.", id);
      }
      geminiTiming = spoken.timing;
      sessions.append(context.sessionId, { user: spoken.transcript, assistant: spoken.responseText });
      const wav = encodePcm16Wav(spoken.pcm);
      status = 200;
      return sendJson(response, status, id, {
        sessionId: context.sessionId,
        transcript: spoken.transcript,
        responseText: spoken.responseText,
        audioBase64: wav.toString("base64"),
        audioMimeType: "audio/wav",
        fallback: false,
      }, {
        "server-timing": `gemini_setup;dur=${spoken.timing.setupMs}, gemini_first_audio;dur=${spoken.timing.firstAudioMs}, gemini_total;dur=${spoken.timing.totalMs}`,
      });
    } finally {
      admission.release();
    }
  } catch (error) {
    if (error instanceof Error && error.message === "payload_too_large") {
      status = 413;
      return sendError(response, status, "too_large", "The request body is too large.", id);
    }
    console.error(JSON.stringify({ event: "voice_request_error", requestId: id, category: "unhandled" }));
    status = 500;
    return sendError(response, status, "internal_error", "The service could not complete the request.", id);
  } finally {
    active.delete(aborter);
    console.log(JSON.stringify({
      event: "request",
      requestId: id,
      method: request.method,
      path: request.url?.split("?", 1)[0],
      status,
      ms: Date.now() - started,
      ...(geminiTiming ? { gemini: geminiTiming } : {}),
    }));
  }
});

function drain(signal: string): void {
  if (draining) return;
  draining = true;
  console.log(JSON.stringify({ event: "draining", signal }));
  server.close(() => process.exit(0));
  setTimeout(() => {
    for (const aborter of active) aborter.abort();
    server.closeAllConnections();
  }, 10_000).unref();
}

process.on("SIGTERM", () => drain("SIGTERM"));
process.on("SIGINT", () => drain("SIGINT"));
server.requestTimeout = 60_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.listen(config.port, config.host, () => console.log(JSON.stringify({ event: "listening", host: config.host, port: config.port })));
