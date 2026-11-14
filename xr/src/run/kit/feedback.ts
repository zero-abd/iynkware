/**
 * Plays the run pillar's feedback (`cues.ts`): controller haptics through `app.input.pulse`, short synthesized sounds
 * placed at the event (no sound files, nothing fetched), loops for hot parts and continuity, a tone for buzzers, and
 * the pop ring at the contact point for hands. The headset's sound is on by default (11.2) and mutes while the system
 * overlay is up (`visible-blurred`).
 *
 * Adapter: `app.feedback` (#18, #21) will own this. When `app` has a `feedback.play`, one-shot cues go there.
 */
import { Mesh, MeshBasicMaterial, RingGeometry, Vector3, VisibilityState } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe, Vec3 } from '../../contracts/common';
import type { Hand, InteractionEvent } from '../../contracts/input';
import { CUES, GAIN, LOOPS, type RunCue, type RunLoop, type SoundName } from './cues';
import { animated, MOTION } from './motion';
import { INK } from './tokens';

export interface LoopHandle {
  move(at: Vec3): void;
  stop(): void;
}

export interface ToneHandle extends LoopHandle {
  /** Pitch in Hz; 0 silences it without stopping. */
  set(hz: number): void;
}

export interface RunFeedback {
  /** One event. `from` is the interaction that caused it (its hand gets the haptic, a hand gets a pop ring at `at`). */
  play(cue: RunCue, at?: Vec3, from?: InteractionEvent | Hand | null): void;
  loop(kind: RunLoop, at: Vec3): LoopHandle;
  /** A continuous square tone at `hz` on the simulation bus (a buzzer). */
  tone(hz: number, at: Vec3): ToneHandle;
  dispose(): void;
}

interface PlatformFeedback {
  play(event: string, at?: Vec3, hand?: Hand | null): void;
}

type Ctx = AudioContext;

const instances = new WeakMap<XrApp, RunFeedback>();

/** The run pillar's feedback for this app (one per app). */
export function runFeedback(app: XrApp): RunFeedback {
  let f = instances.get(app);
  if (!f) {
    f = createRunFeedback(app);
    instances.set(app, f);
  }
  return f;
}

function soundOn(app: XrApp): boolean {
  const xr = app.settings.xr.value as unknown as { sound?: boolean };
  return xr.sound !== false && app.world.visibilityState.value !== VisibilityState.VisibleBlurred;
}

function createRunFeedback(app: XrApp): RunFeedback {
  let ctx: Ctx | null = null;
  let master: GainNode | null = null;
  const listenerAt = new Vector3();
  const listenerFwd = new Vector3();
  const listenerUp = new Vector3();
  const live = new Set<{ stop(): void }>();

  const audio = (): Ctx | null => {
    if (typeof AudioContext === 'undefined') return null;
    if (!ctx) {
      try {
        ctx = new AudioContext();
        master = ctx.createGain();
        master.connect(ctx.destination);
      } catch {
        return null;
      }
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  };

  const placeListener = (c: Ctx) => {
    const cam = app.world.camera;
    cam.getWorldPosition(listenerAt);
    cam.getWorldDirection(listenerFwd);
    listenerUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const l = c.listener;
    if (l.positionX) {
      l.positionX.value = listenerAt.x;
      l.positionY.value = listenerAt.y;
      l.positionZ.value = listenerAt.z;
      l.forwardX.value = listenerFwd.x;
      l.forwardY.value = listenerFwd.y;
      l.forwardZ.value = listenerFwd.z;
      l.upX.value = listenerUp.x;
      l.upY.value = listenerUp.y;
      l.upZ.value = listenerUp.z;
    }
  };

  const panner = (c: Ctx, at?: Vec3): AudioNode => {
    if (!at) return master!;
    const p = c.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.5;
    p.positionX.value = at[0];
    p.positionY.value = at[1];
    p.positionZ.value = at[2];
    p.connect(master!);
    return p;
  };

  const noise = (c: Ctx, seconds: number): AudioBufferSourceNode => {
    const buf = c.createBuffer(1, Math.max(1, Math.round(c.sampleRate * seconds)), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource();
    s.buffer = buf;
    return s;
  };

  /** A note: oscillator `type` from `f0` to `f1` Hz over `ms`, with a fast attack and an exponential release. */
  const note = (c: Ctx, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, ms: number, gain: number) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + ms / 1000);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + ms / 1000 + 0.02);
  };

  const burst = (c: Ctx, out: AudioNode, t: number, ms: number, hz: number, q: number, gain: number) => {
    const s = noise(c, ms / 1000 + 0.02);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = hz;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    s.connect(f).connect(g).connect(out);
    s.start(t);
    s.stop(t + ms / 1000 + 0.02);
  };

  const sound = (name: SoundName, at?: Vec3) => {
    const c = audio();
    if (!c || !master) return;
    placeListener(c);
    const out = panner(c, at);
    const t = c.currentTime + 0.005;
    const k = GAIN[name];
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
      case 'thud':
        return note(c, out, t, 'sine', 140, 70, 110, k);
      case 'zap':
        burst(c, out, t, 120, 2500, 0.8, k);
        return note(c, out, t, 'sawtooth', 1800, 120, 120, k * 0.5);
      case 'pop':
        burst(c, out, t, 70, 900, 0.7, k);
        return note(c, out, t, 'sine', 180, 60, 160, k * 0.8);
      case 'sizzle':
      case 'beep':
        return;
    }
  };

  const popRing = (at: Vec3) => {
    const mat = new MeshBasicMaterial({ color: INK.ink, transparent: true, depthWrite: false });
    const ring = new Mesh(new RingGeometry(0.0055, 0.006, 32), mat);
    ring.position.set(at[0], at[1], at[2]);
    ring.lookAt(app.world.camera.getWorldPosition(new Vector3()));
    ring.raycast = () => undefined;
    app.world.scene.add(ring);
    const a = animated(app, 0, (t) => {
      const s = 1 + t; // 12 mm to 24 mm across
      ring.scale.setScalar(s);
      mat.opacity = 1 - t;
      if (t >= 1) {
        ring.removeFromParent();
        ring.geometry.dispose();
        mat.dispose();
      }
    }, 'fade');
    a.to(1, 180);
  };

  const handOf = (from?: InteractionEvent | Hand | null): { hand: Hand | null; isHand: boolean } => {
    if (!from) return { hand: null, isHand: false };
    if (typeof from === 'string') return { hand: from, isHand: false };
    return { hand: from.pointer.hand, isHand: from.pointer.source === 'hand' };
  };

  const continuous = (build: (c: Ctx, out: AudioNode) => { stop(): void }, at: Vec3, gainOf: () => number): LoopHandle & { gain: GainNode | null } => {
    const c = audio();
    if (!c || !master) return { move: () => undefined, stop: () => undefined, gain: null };
    placeListener(c);
    const p = c.createPanner();
    p.panningModel = 'HRTF';
    p.refDistance = 0.5;
    p.positionX.value = at[0];
    p.positionY.value = at[1];
    p.positionZ.value = at[2];
    const g = c.createGain();
    g.gain.value = soundOn(app) ? gainOf() : 0;
    g.connect(p).connect(master);
    const inner = build(c, g);
    const off = app.world.visibilityState.subscribe(() => (g.gain.value = soundOn(app) ? gainOf() : 0));
    const handle = {
      gain: g,
      move(next: Vec3) {
        p.positionX.value = next[0];
        p.positionY.value = next[1];
        p.positionZ.value = next[2];
      },
      stop() {
        off();
        inner.stop();
        g.disconnect();
        live.delete(handle);
      },
    };
    live.add(handle);
    return handle;
  };

  const platform = (app as unknown as { feedback?: PlatformFeedback }).feedback;

  return {
    play(cue, at, from) {
      const { hand, isHand } = handOf(from);
      if (platform?.play) {
        platform.play(cue, at, hand);
        return;
      }
      const spec = CUES[cue];
      if (hand) {
        for (const [intensity, ms, atMs] of spec.haptic) {
          if (atMs === 0) app.input.pulse(hand, intensity, ms);
          else setTimeout(() => app.input.pulse(hand, intensity, ms), atMs);
        }
      }
      const sounding = soundOn(app);
      if (spec.sound && sounding) sound(spec.sound, at);
      // Hands have no haptics: a committed event shows a pop ring at the contact point, and so does every event with
      // sound off. Hover is not an event that commits.
      if (at && cue !== 'ui-hover' && (isHand || !sounding)) popRing(at);
    },
    loop(kind, at) {
      const spec = LOOPS[kind];
      return continuous(
        (c, out) => {
          if (spec.sound === 'beep') {
            const o = c.createOscillator();
            o.type = 'square';
            o.frequency.value = 2000;
            const g = c.createGain();
            g.gain.value = 0.25;
            o.connect(g).connect(out);
            o.start();
            return { stop: () => o.stop() };
          }
          const s = noise(c, 1.5);
          s.loop = true;
          const f = c.createBiquadFilter();
          f.type = 'highpass';
          f.frequency.value = 3500;
          s.connect(f).connect(out);
          s.start();
          return { stop: () => s.stop() };
        },
        at,
        () => spec.gain,
      );
    },
    tone(hz, at) {
      let osc: OscillatorNode | null = null;
      let level = hz > 0 ? 1 : 0;
      const h = continuous(
        (c, out) => {
          const o = c.createOscillator();
          o.type = 'square';
          o.frequency.value = hz > 0 ? hz : 440;
          const g = c.createGain();
          g.gain.value = 0.12;
          o.connect(g).connect(out);
          o.start();
          osc = o;
          return { stop: () => o.stop() };
        },
        at,
        () => level,
      );
      return {
        move: h.move,
        stop: h.stop,
        set(next) {
          level = next > 0 ? 1 : 0;
          if (osc && next > 0) osc.frequency.value = next;
          if (h.gain) h.gain.gain.value = soundOn(app) ? level : 0;
        },
      };
    },
    dispose() {
      for (const l of [...live]) l.stop();
      void ctx?.close().catch(() => undefined);
      ctx = null;
    },
  };
}

/** Plays `cue` for an interaction at its hit point, or at the object's position. Convenience for handlers. */
export function playAt(app: XrApp, cue: RunCue, e: InteractionEvent, fallback?: Vec3): void {
  runFeedback(app).play(cue, e.point ?? fallback, e);
}

export type { RunCue, RunLoop, Unsubscribe };
export { MOTION };
