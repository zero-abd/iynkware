import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { encodePcm16Wav, extractPcm16Mono } from "./audio.ts";
import { readConfig } from "./config.ts";
import { runGeminiLive } from "./gemini-live-client.ts";
import { MemorySessionStore } from "./session-store.ts";
import { parseVoiceContext } from "./types.ts";

const config = readConfig();
const sessions = new MemorySessionStore(config.sessionTtlMs, config.maxHistoryTurns);

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": bytes.length });
  response.end(bytes);
}

function authorized(value: string | undefined): boolean {
  if (!value) return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(config.clientToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBody(request: IncomingMessage, maximum: number): Promise<Buffer> {
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
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-headers", "content-type, x-client-token");
  response.setHeader("access-control-allow-methods", "POST, DELETE, OPTIONS");
  return true;
}

const server = createServer(async (request, response) => {
  try {
    if (!setCors(request, response)) return sendJson(response, 403, { error: "origin_not_allowed" });
    if (request.method === "OPTIONS") return response.writeHead(204).end();
    const url = new URL(request.url ?? "/", "http://voice.local");
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { ok: true, service: "iynkware-quest-voice" });
    }
    if (!authorized(request.headers["x-client-token"] as string | undefined)) {
      return sendJson(response, 401, { error: "unauthorized" });
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/v1/sessions/")) {
      sessions.clear(decodeURIComponent(url.pathname.slice("/v1/sessions/".length)));
      return sendJson(response, 200, { ok: true });
    }
    if (request.method !== "POST" || url.pathname !== "/v1/voice/turn") {
      return sendJson(response, 404, { error: "not_found" });
    }
    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.startsWith("multipart/form-data;")) return sendJson(response, 415, { error: "multipart_required" });
    const body = await readBody(request, config.maxAudioBytes + 100_000);
    const form = await new Response(Uint8Array.from(body), { headers: { "content-type": contentType } }).formData();
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size === 0 || audio.size > config.maxAudioBytes) {
      return sendJson(response, 400, { error: "valid_audio_file_required" });
    }
    const context = parseVoiceContext(form);
    const pcm = extractPcm16Mono(Buffer.from(await audio.arrayBuffer()));
    const spoken = await runGeminiLive(config, pcm, context, sessions.get(context.sessionId));
    sessions.append(context.sessionId, { user: spoken.transcript, assistant: spoken.responseText });
    const wav = encodePcm16Wav(spoken.pcm);
    return sendJson(response, 200, {
      sessionId: context.sessionId,
      transcript: spoken.transcript,
      responseText: spoken.responseText,
      audioBase64: wav.toString("base64"),
      audioMimeType: "audio/wav",
      fallback: false,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "payload_too_large") return sendJson(response, 413, { error: "payload_too_large" });
    console.error("voice request failed", error instanceof Error ? error.message : "unknown error");
    return sendJson(response, 502, { error: "voice_pipeline_failed", message: "The assistant is temporarily unavailable. Please try again." });
  }
});

server.listen(config.port, config.host, () => console.log(`Quest voice backend listening on ${config.host}:${config.port}`));
