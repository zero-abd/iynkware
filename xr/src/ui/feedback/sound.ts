/**
 * The feedback sounds: short notes and noise bursts synthesized with WebAudio, so there is no sound file and nothing is
 * fetched. One `AudioContext`, made on the first sound (entering XR is a user gesture, so it may start) and resumed
 * when the browser suspended it. A sound with a point is placed there (an HRTF panner; the listener is put at the camera
 * when the sound starts, so nothing runs per frame); mono sound skips the panner.
 */
import { Quaternion, Vector3, type Object3D } from '@iwsdk/core';
import type { Vec3 } from '../../contracts/common';
import type { SoundName } from './table';

export interface Synth {
  /** Plays `name` at `level` (0..1, the bus volume already applied), at `at` unless `mono`. */
  play(name: SoundName, level: number, at: Vec3 | null, mono: boolean): void;
  dispose(): void;
}

const browserContext = (): AudioContext | null => (typeof AudioContext === 'undefined' ? null : new AudioContext());

export function createSynth(camera: () => Object3D | null, makeContext: () => AudioContext | null = browserContext): Synth {
  let ctx: AudioContext | null = null;
  let failed = false;
  const eye = new Vector3();
  const fwd = new Vector3();
  const up = new Vector3();
  const turn = new Quaternion();

  const audio = (): AudioContext | null => {
    if (failed) return null;
    if (!ctx) {
      try {
        ctx = makeContext();
      } catch {
        ctx = null;
      }
      if (!ctx) {
        failed = true;
        return null;
      }
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  };

  const placeListener = (c: AudioContext) => {
    const cam = camera();
    const l = c.listener;
    if (!cam || !l.positionX) return;
    cam.getWorldPosition(eye);
    cam.getWorldDirection(fwd);
    cam.getWorldQuaternion(turn);
    up.set(0, 1, 0).applyQuaternion(turn);
    l.positionX.value = eye.x;
    l.positionY.value = eye.y;
    l.positionZ.value = eye.z;
    l.forwardX.value = fwd.x;
    l.forwardY.value = fwd.y;
    l.forwardZ.value = fwd.z;
    l.upX.value = up.x;
    l.upY.value = up.y;
    l.upZ.value = up.z;
  };

  const output = (c: AudioContext, at: Vec3 | null, mono: boolean): AudioNode => {
    if (!at || mono) return c.destination;
    const p = c.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.5;
    p.positionX.value = at[0];
    p.positionY.value = at[1];
    p.positionZ.value = at[2];
    p.connect(c.destination);
    return p;
  };

  /** A note: oscillator `type` from `f0` to `f1` Hz over `ms`, with a fast attack and an exponential release. */
  const note = (c: AudioContext, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, ms: number, gain: number) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + ms / 1000);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + ms / 1000 + 0.02);
  };

  /** A band of noise: `hz` centre, `q` width, decaying over `ms`. */
  const burst = (c: AudioContext, out: AudioNode, t: number, ms: number, hz: number, q: number, gain: number) => {
    const n = Math.max(1, Math.round(c.sampleRate * (ms / 1000 + 0.02)));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = hz;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    s.connect(f).connect(g).connect(out);
    s.start(t);
    s.stop(t + ms / 1000 + 0.02);
  };

  return {
    play(name, level, at, mono) {
      if (!(level > 0)) return;
      const c = audio();
      if (!c) return;
      try {
        if (at && !mono) placeListener(c);
        const out = output(c, at, mono);
        const t = c.currentTime + 0.005;
        const k = level;
        switch (name) {
          case 'tap':
            return note(c, out, t, 'sine', 880, 760, 45, k);
          case 'tick':
            return note(c, out, t, 'triangle', 2200, 2000, 14, k);
          case 'click':
            burst(c, out, t, 18, 3200, 1.5, k);
            return note(c, out, t, 'square', 1400, 900, 22, k * 0.4);
          case 'pluck':
            return note(c, out, t, 'triangle', 620, 300, 80, k);
          case 'plug':
            burst(c, out, t, 25, 1800, 1.2, k * 0.7);
            return note(c, out, t + 0.01, 'sine', 520, 380, 70, k);
          case 'start':
            note(c, out, t, 'sine', 523, 523, 80, k);
            return note(c, out, t + 0.07, 'sine', 784, 784, 90, k);
          case 'stop':
            note(c, out, t, 'sine', 698, 698, 80, k);
            return note(c, out, t + 0.07, 'sine', 440, 440, 90, k);
          case 'rise':
            note(c, out, t, 'sine', 659, 659, 160, k);
            return note(c, out, t + 0.12, 'sine', 988, 988, 220, k);
          case 'fall':
            note(c, out, t, 'sine', 523, 523, 160, k);
            return note(c, out, t + 0.12, 'sine', 349, 349, 220, k);
          case 'whoosh':
            burst(c, out, t, 200, 1200, 0.6, k);
            return note(c, out, t, 'sine', 900, 300, 200, k * 0.3);
          case 'thud':
            return note(c, out, t, 'sine', 140, 70, 110, k);
          case 'zap':
            burst(c, out, t, 120, 2500, 0.8, k);
            return note(c, out, t, 'sawtooth', 1800, 120, 120, k * 0.5);
          case 'pop':
            burst(c, out, t, 70, 900, 0.7, k);
            return note(c, out, t, 'sine', 180, 60, 160, k * 0.8);
        }
      } catch {
        // A sound is only a nicety: a runtime refusing a node never breaks the event.
      }
    },
    dispose() {
      void ctx?.close().catch(() => undefined);
      ctx = null;
    },
  };
}
