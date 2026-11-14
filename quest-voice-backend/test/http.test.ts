import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { after, before, test } from "node:test";
import { encodePcm16Wav } from "../src/audio.ts";

const port = 30_000 + (process.pid % 10_000);
const origin = `http://127.0.0.1:${port}`;
const token = "voice-test-token-0123456789abcdef";
let child: ChildProcess;
let stderr = "";

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Voice service did not start. ${stderr}`);
}

before(async () => {
  child = spawn(process.execPath, ["src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      GEMINI_API_KEY: "test-gemini-key-0123456789",
      IYNK_VOICE_CLIENT_TOKEN: token,
      IYNK_VOICE_HOST: "127.0.0.1",
      PORT: String(port),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  await waitForHealth();
});

after(async () => {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await exited;
});

test("health follows the iynk server response headers", async () => {
  const response = await fetch(`${origin}/healthz`, { headers: { "x-request-id": "request_test_123" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("iynk-api-version"), "1.0");
  assert.equal(response.headers.get("x-request-id"), "request_test_123");
  assert.deepEqual(await response.json(), { ok: true, draining: false });
});

test("voice routes require a bearer token and use structured errors", async () => {
  const response = await fetch(`${origin}/v1/voice/turn`, { method: "POST" });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /Bearer/);
  const body = await response.json() as { error: { code: string; message: string; requestId: string } };
  assert.equal(body.error.code, "unauthorized");
  assert.ok(body.error.message.length > 0);
  assert.equal(body.error.requestId, response.headers.get("x-request-id"));
});

test("authenticated turns reject the wrong media type before Gemini", async () => {
  const response = await fetch(`${origin}/v1/voice/turn`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 415);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "unsupported_media_type");
});

test("browser origins are denied unless explicitly configured", async () => {
  const response = await fetch(`${origin}/healthz`, { headers: { origin: "https://untrusted.example" } });
  assert.equal(response.status, 403);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "forbidden_origin");
});

test("session deletion validates path identifiers", async () => {
  const response = await fetch(`${origin}/v1/voice/sessions/bad%2Fsession`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 400);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "invalid_session_id");
});

test("invalid audio is a specific 400 and never an upstream outage", async () => {
  const form = new FormData();
  form.set("audio", new Blob([Uint8Array.from(encodePcm16Wav(Buffer.alloc(44_100 * 2), 44_100))], { type: "audio/wav" }), "speech.wav");
  form.set("sessionId", "session-ok");
  const response = await fetch(`${origin}/v1/voice/turn`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(response.status, 400);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "invalid_audio_rate");
});

test("invalid lesson context has its own 400 code", async () => {
  const form = new FormData();
  form.set("audio", new Blob([Uint8Array.from(encodePcm16Wav(Buffer.alloc(16_000 * 2), 16_000))], { type: "audio/wav" }), "speech.wav");
  form.set("sessionId", "session-ok");
  form.set("currentStep", "not-a-number");
  const response = await fetch(`${origin}/v1/voice/turn`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(response.status, 400);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "invalid_context");
});
