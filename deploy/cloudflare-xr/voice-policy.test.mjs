import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CONSENT_VERSION,
  DEFAULT_DEVICE_DAILY_LIMIT,
  DEFAULT_GLOBAL_DAILY_LIMIT,
  FUNCTION_DECLARATIONS,
  GEMINI_MODEL,
  LOCKED_BIDI_SETUP,
  LOCKED_LIVE_CONFIG,
  SYSTEM_INSTRUCTION,
  TOKEN_SESSION_MINUTES,
  TOKEN_START_SECONDS,
  TOOLS_VERSION,
  dayAt,
  limitsFrom,
  quotaResult,
  readAdmission,
  tokenRequest,
} from "./voice-policy.mjs";

const DEVICE = "7b36b820-f1dc-4c71-b890-0e5adab213d6";

test("requires explicit adult consent and a UUID device id", () => {
  assert.deepEqual(readAdmission(null), { ok: false, code: "invalid_request" });
  assert.deepEqual(readAdmission({ adultConsent: false, deviceId: DEVICE }), { ok: false, code: "adult_consent_required" });
  assert.equal(readAdmission({ adultConsent: true, consentVersion: "old", toolsVersion: TOOLS_VERSION, deviceId: DEVICE }).code, "consent_version_mismatch");
  assert.equal(readAdmission({ adultConsent: true, consentVersion: CONSENT_VERSION, toolsVersion: "old", deviceId: DEVICE }).code, "tools_version_mismatch");
  assert.equal(readAdmission({ adultConsent: true, consentVersion: CONSENT_VERSION, toolsVersion: TOOLS_VERSION, deviceId: "device-1" }).code, "invalid_device_id");
  assert.deepEqual(
    readAdmission({ adultConsent: true, consentVersion: CONSENT_VERSION, toolsVersion: TOOLS_VERSION, deviceId: DEVICE.toUpperCase() }),
    { ok: true, deviceId: DEVICE },
  );
});

test("locks a single-use token to Gemini Live audio", () => {
  const now = Date.parse("2026-11-14T20:00:00Z");
  const request = tokenRequest(now);
  assert.equal(request.uses, 1);
  assert.equal(request.bidiGenerateContentSetup.model, GEMINI_MODEL);
  assert.deepEqual(request.bidiGenerateContentSetup, LOCKED_BIDI_SETUP);
  assert.deepEqual(request.bidiGenerateContentSetup.generationConfig.responseModalities, ["AUDIO"]);
  assert.deepEqual(LOCKED_LIVE_CONFIG.responseModalities, ["AUDIO"]);
  assert.equal(LOCKED_LIVE_CONFIG.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Puck");
  assert.deepEqual(LOCKED_LIVE_CONFIG.inputAudioTranscription, { languageCodes: ["en-US"] });
  assert.deepEqual(LOCKED_LIVE_CONFIG.outputAudioTranscription, {});
  assert.equal(LOCKED_LIVE_CONFIG.realtimeInputConfig.automaticActivityDetection.disabled, true);
  assert.match(SYSTEM_INSTRUCTION, /RESPOND IN ENGLISH/);
  assert.equal(TOOLS_VERSION, "agent-v9");
  assert.deepEqual(LOCKED_LIVE_CONFIG.tools, [{ functionDeclarations: FUNCTION_DECLARATIONS }]);
  assert.deepEqual(request.bidiGenerateContentSetup.tools, LOCKED_LIVE_CONFIG.tools);
  assert.deepEqual(FUNCTION_DECLARATIONS, JSON.parse(readFileSync(new URL("../../xr/src/agent/tools/declarations.json", import.meta.url), "utf8")));
  for (const name of ["look", "point_at", "propose_build", "propose_edit", "accept_step", "set_lab_control"]) assert.ok(FUNCTION_DECLARATIONS.some((d) => d.name === name), name);
  assert.match(SYSTEM_INSTRUCTION, /UNTRUSTED_BENCH_CONTEXT/);
  assert.match(SYSTEM_INSTRUCTION, /act only through the tools/i);
  assert.match(SYSTEM_INSTRUCTION, /never claim an action happened unless the tool result says ok/i);
  assert.match(SYSTEM_INSTRUCTION, /safety caveat/);
  assert.equal(Date.parse(request.expireTime) - now, TOKEN_SESSION_MINUTES * 60_000);
  assert.equal(Date.parse(request.newSessionExpireTime) - now, TOKEN_START_SECONDS * 1_000);
});

test("applies device and global daily caps", () => {
  const limits = { device: 2, global: 3 };
  assert.deepEqual(quotaResult(0, 0, limits), { allowed: true, globalCount: 1, deviceCount: 1 });
  assert.equal(quotaResult(0, limits.device, limits).code, "device_daily_limit");
  assert.equal(quotaResult(limits.global, 0, limits).code, "global_daily_limit");
});

test("uses bounded configurable limits", () => {
  assert.equal(DEFAULT_DEVICE_DAILY_LIMIT, 200);
  assert.equal(DEFAULT_GLOBAL_DAILY_LIMIT, 250);
  assert.deepEqual(limitsFrom({}), { device: DEFAULT_DEVICE_DAILY_LIMIT, global: DEFAULT_GLOBAL_DAILY_LIMIT });
  assert.deepEqual(limitsFrom({ VOICE_DEVICE_DAILY_LIMIT: "3", VOICE_GLOBAL_DAILY_LIMIT: "8" }), { device: 3, global: 8 });
  assert.deepEqual(limitsFrom({ VOICE_DEVICE_DAILY_LIMIT: "0", VOICE_GLOBAL_DAILY_LIMIT: "no" }), {
    device: DEFAULT_DEVICE_DAILY_LIMIT,
    global: DEFAULT_GLOBAL_DAILY_LIMIT,
  });
});

test("uses a UTC day key", () => {
  assert.equal(dayAt(Date.parse("2026-11-14T23:59:59Z")), "2026-11-14");
});
