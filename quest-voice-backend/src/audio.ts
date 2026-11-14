import { VoiceInputError } from "./errors.ts";

function fourCc(bytes: Buffer, offset: number): string {
  return bytes.toString("ascii", offset, offset + 4);
}

export function extractPcm16Mono(wav: Buffer): Buffer {
  if (wav.length < 44 || fourCc(wav, 0) !== "RIFF" || fourCc(wav, 8) !== "WAVE") {
    throw new VoiceInputError("invalid_audio_format", "Audio must be a PCM WAV file.");
  }
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let format = 0;
  let data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = fourCc(wav, offset);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > wav.length) throw new VoiceInputError("invalid_audio_format", "WAV chunk exceeds the file size.");
    if (id === "fmt " && size >= 16) {
      format = wav.readUInt16LE(start);
      channels = wav.readUInt16LE(start + 2);
      sampleRate = wav.readUInt32LE(start + 4);
      bitsPerSample = wav.readUInt16LE(start + 14);
    } else if (id === "data") data = wav.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (format !== 1 || bitsPerSample !== 16 || channels < 1 || !data) {
    throw new VoiceInputError("invalid_audio_format", "Only PCM16 WAV input is supported.");
  }
  if (sampleRate !== 16_000) throw new VoiceInputError("invalid_audio_rate", "Voice input must be recorded at 16 kHz.");
  if (channels === 1) return Buffer.from(data);
  const frames = Math.floor(data.length / (channels * 2));
  const mono = Buffer.alloc(frames * 2);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) sum += data.readInt16LE((frame * channels + channel) * 2);
    mono.writeInt16LE(Math.round(sum / channels), frame * 2);
  }
  return mono;
}

export function encodePcm16Wav(pcm: Buffer, sampleRate = 24_000, channels = 1): Buffer {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * channels * 2, 28);
  wav.writeUInt16LE(channels * 2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  return wav;
}
