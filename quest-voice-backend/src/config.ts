export type VoiceConfig = {
  apiKey: string;
  clientToken: string;
  host: string;
  port: number;
  maxAudioBytes: number;
  sessionTtlMs: number;
  maxHistoryTurns: number;
  liveModel: string;
  allowedOrigins: string[];
};

function required(env: NodeJS.ProcessEnv, name: string, minimum: number): string {
  const value = env[name]?.trim() ?? "";
  if (value.length < minimum) throw new Error(`${name} must contain at least ${minimum} characters.`);
  return value;
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    apiKey: required(env, "GEMINI_API_KEY", 20),
    clientToken: required(env, "CLIENT_TOKEN", 16),
    host: env.HOST?.trim() || "0.0.0.0",
    port: integer(env, "PORT", 8787, 1, 65_535),
    maxAudioBytes: integer(env, "MAX_AUDIO_BYTES", 10_000_000, 1_024, 25_000_000),
    sessionTtlMs: integer(env, "SESSION_TTL_MINUTES", 30, 1, 1_440) * 60_000,
    maxHistoryTurns: integer(env, "MAX_HISTORY_TURNS", 6, 1, 20),
    liveModel: env.GEMINI_LIVE_MODEL?.trim() || "gemini-3.8-live",
    allowedOrigins,
  };
}
