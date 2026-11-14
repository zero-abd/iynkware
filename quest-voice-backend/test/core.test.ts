import assert from "node:assert/strict";
import { test } from "node:test";
import { readConfig } from "../src/config.ts";
import { encodePcm16Wav, extractPcm16Mono } from "../src/audio.ts";
import { buildSystemInstruction } from "../src/prompts.ts";
import { MemorySessionStore } from "../src/session-store.ts";

test("configuration has safe bounded defaults", () => {
  const config = readConfig({ GEMINI_API_KEY: "x".repeat(20), CLIENT_TOKEN: "y".repeat(16) });
  assert.equal(config.port, 8787);
  assert.equal(config.maxAudioBytes, 10_000_000);
  assert.equal(config.liveModel, "gemini-3.8-live");
});

test("configuration rejects short client tokens", () => {
  assert.throws(() => readConfig({ GEMINI_API_KEY: "x".repeat(20), CLIENT_TOKEN: "short" }), /CLIENT_TOKEN/);
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
});

test("Gemini PCM output is wrapped as a Unity-compatible WAV", () => {
  const pcm = Buffer.from([0, 0, 255, 127, 0, 128]);
  const wav = encodePcm16Wav(pcm, 16_000);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.deepEqual(extractPcm16Mono(wav), pcm);
});
