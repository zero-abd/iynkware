export type VoiceInputErrorCode =
  | "invalid_audio_format"
  | "invalid_audio_rate"
  | "invalid_context"
  | "invalid_session_id";

export class VoiceInputError extends Error {
  readonly code: VoiceInputErrorCode;

  constructor(code: VoiceInputErrorCode, message: string) {
    super(message);
    this.name = "VoiceInputError";
    this.code = code;
  }
}
