import type { VoiceConfig } from "./config.ts";
import { buildSystemInstruction } from "./prompts.ts";
import type { ConversationTurn, VoiceContext } from "./types.ts";

type GeminiMessage = {
  setupComplete?: object;
  serverContent?: {
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
    turnComplete?: boolean;
  };
};

export function runGeminiLive(config: VoiceConfig, pcm: Buffer, context: VoiceContext, history: ConversationTurn[], signal?: AbortSignal): Promise<{ transcript: string; responseText: string; pcm: Buffer }> {
  return new Promise((resolve, reject) => {
    const endpoint = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(config.apiKey)}`;
    const socket = new WebSocket(endpoint);
    const audio: Buffer[] = [];
    let transcript = "";
    let responseText = "";
    let audioBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("Gemini Live timed out.")), 45_000);

    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      socket.close();
      if (error) reject(error);
      else if (audio.length === 0) reject(new Error("Gemini Live returned no audio."));
      else resolve({ transcript: transcript.trim(), responseText: responseText.trim(), pcm: Buffer.concat(audio) });
    }

    function abort(): void {
      finish(new Error("Gemini Live request was cancelled."));
    }
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        setup: {
          model: `models/${config.liveModel}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.liveVoice } } },
          },
          systemInstruction: { parts: [{ text: buildSystemInstruction(context, history) }] },
          // Native-audio models infer language; the lesson locale remains a prompt constraint.
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      }));
    });

    socket.addEventListener("message", (event: MessageEvent) => {
      try {
        const message = JSON.parse(String(event.data)) as GeminiMessage;
        if (message.setupComplete) {
          for (let offset = 0; offset < pcm.length; offset += 32_768) {
            socket.send(JSON.stringify({ realtimeInput: { audio: { data: pcm.subarray(offset, offset + 32_768).toString("base64"), mimeType: "audio/pcm;rate=16000" } } }));
          }
          socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
          return;
        }
        const content = message.serverContent;
        if (!content) return;
        if (content.inputTranscription?.text) transcript += content.inputTranscription.text;
        if (content.outputTranscription?.text) responseText += content.outputTranscription.text;
        for (const part of content.modelTurn?.parts ?? []) {
          if (part.inlineData?.data) {
            if (part.inlineData.mimeType && part.inlineData.mimeType !== "audio/pcm;rate=24000") {
              return finish(new Error("Gemini Live returned an unsupported audio format."));
            }
            const chunk = Buffer.from(part.inlineData.data, "base64");
            audioBytes += chunk.length;
            if (audioBytes > config.maxResponseBytes) return finish(new Error("Gemini Live audio exceeded the response limit."));
            audio.push(chunk);
          }
        }
        if (content.turnComplete) finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Invalid Gemini Live response."));
      }
    });
    socket.addEventListener("error", () => finish(new Error("Gemini Live connection failed.")));
    socket.addEventListener("close", () => {
      if (!settled) finish(new Error("Gemini Live closed before completing the turn."));
    });
  });
}
