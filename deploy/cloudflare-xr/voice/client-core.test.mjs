import assert from "node:assert/strict";
import test from "node:test";

import { CONTEXT_LIMIT, controllerTalkPressed, rawSetup, runtimeBridge, untrustedContext } from "./client-core.mjs";

test("uses either AgentBridge naming shape and falls back to the mounted assistant", () => {
  const events = [];
  const first = runtimeBridge({ agent: { context: () => "agent", state: (value) => events.push(value) } });
  assert.equal(first.context(), "agent");
  first.state("listening");
  assert.deepEqual(events, ["listening"]);

  const listening = [];
  const second = runtimeBridge({ agent: { context: () => "issue-201", listening: (on) => listening.push(on) } });
  second.state("listening");
  second.state("idle");
  assert.deepEqual(listening, [true, false]);

  const fallback = runtimeBridge({ app: { assistant: { snapshot: () => ({ v: 1 }) } } });
  assert.deepEqual(fallback.context(), { v: 1 });
});

test("marks and caps untrusted grounding context", () => {
  const text = untrustedContext("x".repeat(CONTEXT_LIMIT + 20));
  assert.match(text, /^UNTRUSTED_BENCH_CONTEXT/);
  assert.match(text, /END_UNTRUSTED_BENCH_CONTEXT$/);
  assert.ok(text.length < CONTEXT_LIMIT + 100);
});

test("maps the locked SDK-style config to a raw Live setup", () => {
  const config = {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: {} },
    systemInstruction: { parts: [{ text: "guide" }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
    historyConfig: { initialHistoryInClientContent: true },
    tools: [],
  };
  const setup = rawSetup("models/test", config);
  assert.equal(setup.model, "models/test");
  assert.deepEqual(setup.generationConfig.responseModalities, ["AUDIO"]);
  assert.deepEqual(setup.tools, []);
  assert.equal(setup.historyConfig.initialHistoryInClientContent, true);
  assert.equal(setup.realtimeInputConfig.automaticActivityDetection.disabled, true);
});

test("reads the demo-only right upper controller button", () => {
  assert.equal(controllerTalkPressed({ app: { input: { button: (hand, which) => ({ pressed: hand === "right" && which === "upper" }) } } }), true);
  assert.equal(controllerTalkPressed(null), false);
});
