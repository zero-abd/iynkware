export const CONTEXT_LIMIT = 16_000;

export function runtimeBridge(root, fallbackStatus = () => undefined) {
  const bridge = root?.agent;
  const app = root?.app;
  return {
    context() {
      if (typeof bridge?.context === "function") return bridge.context();
      return app?.assistant?.snapshot?.() ?? { note: "The virtual bench is not open yet." };
    },
    state(value) {
      if (typeof bridge?.state === "function") bridge.state(value);
      else if (typeof bridge?.listening === "function") bridge.listening(value === "listening");
      else fallbackStatus(value);
    },
    user(text, final) {
      if (typeof bridge?.user === "function") bridge.user(text, { final });
    },
    say(text, final) {
      if (typeof bridge?.say === "function") bridge.say(text, { final });
    },
  };
}

export function untrustedContext(value) {
  let text;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = "The virtual bench snapshot could not be serialized.";
  }
  const clipped = text.length > CONTEXT_LIMIT ? `${text.slice(0, CONTEXT_LIMIT)}…` : text;
  return `UNTRUSTED_BENCH_CONTEXT\n${clipped}\nEND_UNTRUSTED_BENCH_CONTEXT`;
}

export function rawSetup(model, config) {
  return {
    model,
    generationConfig: {
      responseModalities: config.responseModalities,
      speechConfig: config.speechConfig,
    },
    systemInstruction: config.systemInstruction,
    inputAudioTranscription: config.inputAudioTranscription,
    outputAudioTranscription: config.outputAudioTranscription,
    realtimeInputConfig: config.realtimeInputConfig,
    tools: config.tools,
  };
}

export function controllerTalkPressed(root) {
  return Boolean(root?.app?.input?.button?.("right", "upper")?.pressed);
}
