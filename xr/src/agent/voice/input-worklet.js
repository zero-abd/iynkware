// The microphone's worklet: downmix to mono, resample to 16 kHz by averaging the input samples that fall in each
// output sample (a simple box decimator, which also low-passes), and post 40 ms chunks of PCM16 with their peak level.
// Served as its own same-origin file (the page's CSP refuses blob: and data: scripts).
class IynkwareVoiceInput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000;
    this.acc = 0;
    this.n = 0;
    this.phase = 0;
    this.chunk = new Int16Array(640);
    this.length = 0;
    this.peak = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const frames = channels[0].length;
    for (let i = 0; i < frames; i++) {
      let v = 0;
      for (let c = 0; c < channels.length; c++) v += channels[c][i];
      this.acc += v / channels.length;
      this.n++;
      this.phase += 1;
      if (this.phase < this.step) continue;
      this.phase -= this.step;
      const s = Math.max(-1, Math.min(1, this.acc / this.n));
      this.acc = 0;
      this.n = 0;
      const q = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.chunk[this.length++] = q;
      const a = q < 0 ? -q : q;
      if (a > this.peak) this.peak = a;
      if (this.length === this.chunk.length) {
        const ready = this.chunk;
        this.port.postMessage({ pcm: ready.buffer, peak: this.peak / 32768 }, [ready.buffer]);
        this.chunk = new Int16Array(640);
        this.length = 0;
        this.peak = 0;
      }
    }
    return true;
  }
}

registerProcessor('iynkware-voice-input', IynkwareVoiceInput);
