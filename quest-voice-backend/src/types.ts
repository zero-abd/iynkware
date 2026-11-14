export type VoiceContext = {
  sessionId: string;
  scenario: string;
  objective: string;
  learnerLevel: string;
  currentStep: number;
  lastAction: string;
  locale: string;
};

export type ConversationTurn = { user: string; assistant: string };

function bounded(fields: FormData, name: string, fallback: string, maximum: number): string {
  const value = String(fields.get(name) ?? fallback).trim();
  if (!value || value.length > maximum) throw new Error(`${name} is missing or too long.`);
  return value;
}

export function parseVoiceContext(fields: FormData): VoiceContext {
  const rawStep = String(fields.get("currentStep") ?? "0");
  const currentStep = Number(rawStep);
  if (!Number.isInteger(currentStep) || currentStep < 0 || currentStep > 1_000) {
    throw new Error("currentStep must be an integer from 0 to 1000.");
  }
  return {
    sessionId: bounded(fields, "sessionId", "", 100),
    scenario: bounded(fields, "scenario", "general_training", 80),
    objective: bounded(fields, "objective", "Help the learner complete the current lesson safely.", 500),
    learnerLevel: bounded(fields, "learnerLevel", "beginner", 80),
    currentStep,
    lastAction: String(fields.get("lastAction") ?? "").trim().slice(0, 500),
    locale: bounded(fields, "locale", "en-US", 20),
  };
}
