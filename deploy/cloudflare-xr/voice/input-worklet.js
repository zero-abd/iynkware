class VoiceInputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.chunk = new Int16Array(640);
    this.length = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.phase += 16_000;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      const value = Math.max(-1, Math.min(1, input[i]));
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
