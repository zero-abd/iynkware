/**
 * The headset's audio for voice: one AudioContext and one microphone track for the whole time voice is on.
 * `start()` must be called from a user activation (a menu select, a button press): it creates the context and asks
 * for the microphone in the same call, and neither is stopped or re-acquired between turns. It reports the track's
 * mute and end and the context's state, so the bubble can say what is wrong; and it plays the model's 24 kHz PCM
 * gaplessly on the same context.
 */
import workletUrl from './input-worklet.js?url&no-inline';

export type AudioIssue = 'muted' | 'unmuted' | 'ended' | 'suspended' | 'running';

export interface AudioIO {
  start(): Promise<void>;
  /** Base64 PCM16 at 24 kHz from Gemini. */
  play(b64: string): void;
  clear(): void;
  /** Milliseconds of audio still scheduled. */
  pending(): number;
  /** Peak of the last microphone chunk, 0..1. */
  readonly level: number;
  /** Chunks received from the microphone so far, and the context's state (for checks and the status line). */
  readonly chunks: number;
  readonly state: string;
  /** Resumes a suspended context (call from a press). */
  wake(): void;
  stop(): void;
}

export function createAudioIO(o: { onChunk(pcm: ArrayBuffer): void; onIssue(i: AudioIssue): void }): AudioIO {
  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let node: AudioWorkletNode | null = null;
  let at = 0;
  let level = 0;
  let chunks = 0;
  const playing = new Set<AudioBufferSourceNode>();

  return {
    async start() {
      // Both in this call stack, so both see the activation.
      ctx = new AudioContext({ latencyHint: 'interactive' });
      const resumed = ctx.resume();
      const mic = navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      const c = ctx;
      c.onstatechange = () => o.onIssue(c.state === 'running' ? 'running' : 'suspended');
      stream = await mic;
      await Promise.all([resumed, c.audioWorklet.addModule(workletUrl)]);
      const track = stream.getAudioTracks()[0];
      track?.addEventListener('mute', () => o.onIssue('muted'));
      track?.addEventListener('unmute', () => o.onIssue('unmuted'));
      track?.addEventListener('ended', () => o.onIssue('ended'));
      const source = c.createMediaStreamSource(stream);
      node = new AudioWorkletNode(c, 'iynkware-voice-input', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => {
        level = e.data.peak;
        chunks++;
        o.onChunk(e.data.pcm);
      };
      // The worklet must reach the destination to be pulled; through a silent gain.
      const sink = c.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(c.destination);
      if (c.state !== 'running') o.onIssue('suspended');
      if (track?.muted) o.onIssue('muted');
    },
    play(b64) {
      if (!ctx) return;
      const raw = atob(b64);
      const n = raw.length >> 1;
      const buffer = ctx.createBuffer(1, n, 24_000);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < n; i++) {
        const v = raw.charCodeAt(2 * i) | (raw.charCodeAt(2 * i + 1) << 8);
        data[i] = (v >= 0x8000 ? v - 0x10000 : v) / 0x8000;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      const start = Math.max(ctx.currentTime + 0.03, at);
      at = start + buffer.duration;
      playing.add(src);
      src.onended = () => playing.delete(src);
      src.start(start);
    },
    clear() {
      for (const s of playing) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      playing.clear();
      at = ctx?.currentTime ?? 0;
    },
    pending: () => (ctx ? Math.max(0, (at - ctx.currentTime) * 1000) : 0),
    get level() {
      return level;
    },
    get chunks() {
      return chunks;
    },
    get state() {
      return ctx?.state ?? 'closed';
    },
    wake() {
      if (ctx && ctx.state !== 'running') void ctx.resume();
    },
    stop() {
      node?.disconnect();
      node = null;
      for (const t of stream?.getTracks() ?? []) t.stop();
      stream = null;
      void ctx?.close().catch(() => undefined);
      ctx = null;
      level = 0;
    },
  };
}
