export type VoiceConfig = {
  apiKey: string;
  clientToken: string;
  host: string;
  port: number;
  maxAudioBytes: number;
  maxAudioSeconds: number;
  maxResponseBytes: number;
  sessionTtlMs: number;
  maxHistoryTurns: number;
  maxRequestsPerMinute: number;
  maxConcurrentTurns: number;
  liveModel: string;
  liveVoice: string;
  allowedOrigins: string[];
};

type Env = Record<string, string | undefined>;

function required(env: Env, name: string, minimum: number): string {
  const value = env[name]?.trim() ?? "";
  if (value.length < minimum) throw new Error(`${name} must contain at least ${minimum} characters.`);
  return value;
}

function integer(env: Env, name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

export function readConfig(env: Env = process.env): VoiceConfig {
  const allowedOrigins = (env.IYNK_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    apiKey: required(env, "GEMINI_API_KEY", 20),
    clientToken: required(env, "IYNK_VOICE_CLIENT_TOKEN", 32),
    host: env.IYNK_VOICE_HOST?.trim() || "0.0.0.0",
    port: integer(env, "PORT", 8787, 1, 65_535),
    maxAudioBytes: integer(env, "IYNK_VOICE_MAX_AUDIO_BYTES", 2_000_000, 1_024, 25_000_000),
    maxAudioSeconds: integer(env, "IYNK_VOICE_MAX_AUDIO_SECONDS", 30, 1, 120),
    maxResponseBytes: integer(env, "IYNK_VOICE_MAX_RESPONSE_BYTES", 4_000_000, 1_024, 25_000_000),
    sessionTtlMs: integer(env, "IYNK_VOICE_SESSION_TTL_MINUTES", 30, 1, 1_440) * 60_000,
    maxHistoryTurns: integer(env, "IYNK_VOICE_MAX_HISTORY_TURNS", 6, 1, 20),
    maxRequestsPerMinute: integer(env, "IYNK_VOICE_MAX_REQUESTS_PER_MINUTE", 30, 1, 1_000),
    maxConcurrentTurns: integer(env, "IYNK_VOICE_MAX_CONCURRENT_TURNS", 2, 1, 20),
    liveModel: env.GEMINI_LIVE_MODEL?.trim() || "gemini-3.8-live",
    liveVoice: env.GEMINI_LIVE_VOICE?.trim() || "Puck",
    allowedOrigins,
  };
}
