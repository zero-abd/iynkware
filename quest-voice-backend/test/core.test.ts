import assert from "node:assert/strict";
import { test } from "node:test";
import { readConfig } from "../src/config.ts";
import { encodePcm16Wav, extractPcm16Mono } from "../src/audio.ts";
import { buildSystemInstruction } from "../src/prompts.ts";
import { RequestGate } from "../src/request-gate.ts";
import { MemorySessionStore } from "../src/session-store.ts";

test("configuration has safe bounded defaults", () => {
  const config = readConfig({ GEMINI_API_KEY: "x".repeat(20), IYNK_VOICE_CLIENT_TOKEN: "y".repeat(32) });
  assert.equal(config.port, 8787);
  assert.equal(config.maxAudioBytes, 2_000_000);
  assert.equal(config.maxAudioSeconds, 30);
  assert.equal(config.maxResponseBytes, 4_000_000);
  assert.equal(config.liveModel, "gemini-3.8-live");
  assert.equal(config.liveVoice, "Puck");
});

test("configuration rejects short client tokens", () => {
  assert.throws(() => readConfig({ GEMINI_API_KEY: "x".repeat(20), IYNK_VOICE_CLIENT_TOKEN: "short" }), /IYNK_VOICE_CLIENT_TOKEN/);
});

test("session history keeps only the configured turns", () => {
  const sessions = new MemorySessionStore(60_000, 2);
  sessions.append("demo", { user: "one", assistant: "first" });
  sessions.append("demo", { user: "two", assistant: "second" });
  sessions.append("demo", { user: "three", assistant: "third" });
  assert.deepEqual(sessions.get("demo"), [
    { user: "two", assistant: "second" },
    { user: "three", assistant: "third" },
  ]);
});

test("prompt includes lesson state and safety boundary", () => {
  const prompt = buildSystemInstruction({ sessionId: "s", scenario: "chemistry_lab", objective: "Dilution", learnerLevel: "beginner", currentStep: 2, lastAction: "Selected acid", locale: "en-US" }, []);
  assert.match(prompt, /chemistry_lab/);
  assert.match(prompt, /qualified instructor/);
  assert.match(prompt, /weapons, injury, property damage/);
  assert.match(prompt, /untrusted data/);
});

test("voice context rejects unsafe identifiers and oversized optional fields", async () => {
  const { parseVoiceContext } = await import("../src/types.ts");
  const invalidSession = new FormData();
  invalidSession.set("sessionId", "bad/session");
  assert.throws(() => parseVoiceContext(invalidSession), /sessionId/);
  const invalidLocale = new FormData();
  invalidLocale.set("sessionId", "session-ok");
  invalidLocale.set("locale", "not a locale!");
  assert.throws(() => parseVoiceContext(invalidLocale), /locale/);
  const longAction = new FormData();
  longAction.set("sessionId", "session-ok");
  longAction.set("lastAction", "x".repeat(501));
  assert.throws(() => parseVoiceContext(longAction), /lastAction/);
});

test("Gemini PCM output is wrapped as a Unity-compatible WAV", () => {
  const pcm = Buffer.from([0, 0, 255, 127, 0, 128]);
  const wav = encodePcm16Wav(pcm, 16_000);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.deepEqual(extractPcm16Mono(wav), pcm);
});

test("request gate bounds Gemini cost and concurrent work", () => {
  const gate = new RequestGate(2, 1);
  const first = gate.admit(1_000);
  assert.equal(first.ok, true);
  assert.deepEqual(gate.admit(1_001), { ok: false, reason: "too_many_concurrent_turns" });
  if (first.ok) first.release();
  const second = gate.admit(1_002);
  assert.equal(second.ok, true);
  if (second.ok) second.release();
  assert.deepEqual(gate.admit(1_003), { ok: false, reason: "rate_limited" });
  assert.equal(gate.admit(61_001).ok, true);
});
