// Microphone -> 16 kHz mono PCM16 in 40 ms chunks for Gemini Live.
// A windowed-sinc low-pass (7 kHz, Blackman, 95 taps) runs before decimation. Keeping every third sample without it
// folded hiss and "s" sounds above 8 kHz down into the speech band as garbled tones, which hurt transcription.
const OUT_RATE = 16_000;
const CUTOFF = 7_000;
const TAPS = 95;

class VoiceInputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const fc = CUTOFF / sampleRate;
    const mid = (TAPS - 1) / 2;
    this.taps = new Float32Array(TAPS);
    let sum = 0;
    for (let i = 0; i < TAPS; i++) {
      const x = i - mid;
      const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (TAPS - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (TAPS - 1));
      this.taps[i] = sinc * w;
      sum += this.taps[i];
    }
    for (let i = 0; i < TAPS; i++) this.taps[i] /= sum;
    // History written twice, so the last TAPS samples are always one contiguous window starting at `pos`.
    this.ring = new Float32Array(TAPS * 2);
    this.pos = 0;
    this.phase = 0;
    this.chunk = new Int16Array(640);
    this.length = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const { taps, ring } = this;
    for (let i = 0; i < input.length; i++) {
      ring[this.pos] = input[i];
      ring[this.pos + TAPS] = input[i];
      this.pos = this.pos + 1 === TAPS ? 0 : this.pos + 1;
      this.phase += OUT_RATE;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      let acc = 0;
      for (let k = 0, j = this.pos; k < TAPS; k++, j++) acc += taps[k] * ring[j];
      const value = Math.max(-1, Math.min(1, acc));
      this.chunk[this.length++] = value < 0 ? value * 0x8000 : value * 0x7fff;
      if (this.length === this.chunk.length) {
        const ready = this.chunk;
        this.port.postMessage(ready.buffer, [ready.buffer]);
        this.chunk = new Int16Array(640);
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor('iynkware-voice-input', VoiceInputProcessor);
