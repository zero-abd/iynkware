import { VoiceInputError } from "./errors.ts";

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
  if (!value || value.length > maximum) throw new VoiceInputError("invalid_context", `${name} is missing or too long.`);
  return value;
}

function optionalBounded(fields: FormData, name: string, maximum: number): string {
  const value = String(fields.get(name) ?? "").trim();
  if (value.length > maximum) throw new VoiceInputError("invalid_context", `${name} is too long.`);
  return value;
}

export function parseVoiceContext(fields: FormData): VoiceContext {
  const rawStep = String(fields.get("currentStep") ?? "0");
  const currentStep = Number(rawStep);
  if (!Number.isInteger(currentStep) || currentStep < 0 || currentStep > 1_000) {
    throw new VoiceInputError("invalid_context", "currentStep must be an integer from 0 to 1000.");
  }
  const sessionId = String(fields.get("sessionId") ?? "").trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(sessionId)) {
    throw new VoiceInputError("invalid_session_id", "sessionId is missing or contains unsupported characters.");
  }
  const locale = bounded(fields, "locale", "en-US", 20);
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) throw new VoiceInputError("invalid_context", "locale must be a BCP-47 language tag.");
  return {
    sessionId,
    scenario: bounded(fields, "scenario", "general_hardware_lab", 80),
    objective: bounded(fields, "objective", "Help the learner complete the current lesson safely.", 500),
    learnerLevel: bounded(fields, "learnerLevel", "beginner", 80),
    currentStep,
    lastAction: optionalBounded(fields, "lastAction", 500),
    locale,
  };
}
