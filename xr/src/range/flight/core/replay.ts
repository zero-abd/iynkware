/**
 * The crash replay window and its playback clock (XR_DESIGN 8.3): the flight model's own replay of the last seconds
 * before an impact, timeline marks for what led to it, and a slow-motion clock to play, pause and scrub it.
 */
import {
  crashReplay,
  frameOf,
  replay,
  STEP,
  type CrashCause,
  type CrashFix,
  type FlightAction,
  type FlightFrame,
  type FlightOrigin,
  type HitKind,
  type Sticks,
} from '@/lib/flight';

const CHANNELS = ['throttle', 'yaw', 'pitch', 'roll'] as const;

type Log = ReadonlyArray<{ step: number; action: FlightAction }>;

/** Default playback speed: a third of real time. */
export const REPLAY_SPEED = 1 / 3;
/** Seconds of flight kept before the impact (the flight model's `crashReplay` default) and after it. */
export const REPLAY_BEFORE_S = 2;
export const REPLAY_AFTER_S = 1;
/** A stick channel moving more than this within `STICK_SPIKE_S` is marked. */
export const STICK_SPIKE = 0.6;
export const STICK_SPIKE_S = 0.1;
/** Motor output at or above this for `SATURATED_S` is marked. */
export const SATURATED_THR = 0.98;
export const SATURATED_S = 0.1;
/** Per-cell voltage falling this far below the window's start is marked as sag (as is the low-battery flag). */
export const SAG_V_PER_CELL = 0.35;

/**
 * A timeline mark, `t` in seconds from the window's start. Kinds: `crash` and `net` (the impact), `gate` (`index` the
 * gate passed; flight namespace `gate`), `stick` (a stick spike), `saturated` (motors at full), `sag` (battery sag).
 */
export interface ReplayMark {
  readonly t: number;
  readonly kind: 'crash' | 'net' | 'gate' | 'stick' | 'saturated' | 'sag';
  readonly index?: number;
}

/** What the crash card and the replay timeline show. */
export interface ReplayWindow {
  /** One frame per flight step (`STEP` s apart). */
  readonly frames: readonly FlightFrame[];
  /** Index of the impact frame. */
  readonly at: number;
  /** Seconds from the window's start to its last frame. */
  readonly duration: number;
  readonly marks: readonly ReplayMark[];
  /** What it hit: a `hit.*` key in the flight namespace, `ground`, or `net` (the room's net: no flight key yet). */
  readonly hit: HitKind | 'ground' | 'net';
  /** Why: a `why.*` key in the flight namespace (`causeOf`), or `net`. */
  readonly cause: CrashCause | 'net';
  /** What to change (`fixFor`); the net's is a reset. */
  readonly fix: CrashFix;
  /** Ground speed coming into the impact, course m/s (times the course map's `k` for room m/s). */
  readonly speed: number;
}

/** The window around the last crash before session step `steps`, from the flight model's `crashReplay`. */
export function crashWindow(origin: FlightOrigin, log: Log, steps: number, hasPace = false): ReplayWindow | null {
  const r = crashReplay(origin, log, steps, hasPace, { before: REPLAY_BEFORE_S, after: REPLAY_AFTER_S });
  if (!r) return null;
  return {
    frames: r.frames,
    at: r.at,
    duration: (r.frames.length - 1) * STEP,
    marks: marksOf(r.frames, r.at, 'crash', log),
    hit: r.hit ?? 'ground',
    cause: r.cause,
    fix: r.fix,
    speed: r.speed,
  };
}

/**
 * The window for the net: the flight replayed to session step `steps`, ending where the flight model called
 * `outOfField`. The flight model has no crash there (the room stops the craft), so there is nothing after the impact.
 */
export function netWindow(origin: FlightOrigin, log: Log, steps: number): ReplayWindow | null {
  const keep = Math.round(REPLAY_BEFORE_S / STEP) + Math.round(0.1 / STEP) + 1;
  const frames: FlightFrame[] = [];
  let netAt = -1;
  replay(origin.craft, origin.course, origin.calc, log, steps, origin.opts, (s, now) => {
    if (netAt >= 0) return;
    if (s.step >= steps - keep) frames.push(frameOf(s));
    for (const e of now) if (e.type === 'outOfField') netAt = frames.length - 1;
  });
  if (netAt < 0) return null;
  const from = Math.max(0, netAt - Math.round(REPLAY_BEFORE_S / STEP));
  const win = frames.slice(from, netAt + 1);
  const at = win.length - 1;
  return {
    frames: win,
    at,
    duration: at * STEP,
    marks: marksOf(win, at, 'net', log),
    hit: 'net',
    cause: 'net',
    fix: { kind: 'reset' },
    speed: win[at].speed,
  };
}

const stepOf = (f: FlightFrame) => Math.round(f.t / STEP);

/** Timeline marks for a window of frames (one per step) and the session log. */
export function marksOf(frames: readonly FlightFrame[], at: number, impact: 'crash' | 'net', log: Log): ReplayMark[] {
  if (!frames.length) return [];
  const first = stepOf(frames[0]), last = stepOf(frames[frames.length - 1]);
  const tOf = (step: number) => (step - first) * STEP;
  const marks: ReplayMark[] = [{ t: tOf(stepOf(frames[at])), kind: impact }];
  // stick spikes: a channel moved more than STICK_SPIKE against where it was STICK_SPIKE_S earlier
  const sticks: Array<{ step: number; sticks: Readonly<Sticks> }> = [];
  for (const l of log) if (l.action.type === 'sticks') sticks.push({ step: l.step, sticks: l.action.sticks });
  const lag = Math.round(STICK_SPIKE_S / STEP);
  let lastSpike = -Infinity;
  for (let i = 0; i < sticks.length; i++) {
    const { step, sticks: now } = sticks[i];
    if (step < first || step > last) continue;
    let j = i - 1;
    while (j >= 0 && sticks[j].step > step - lag) j--;
    // the window's earliest comparison: the stick lag steps ago, or the one just before this
    const before = (j >= 0 ? sticks[j] : sticks[Math.max(0, i - 1)]).sticks;
    const moved = CHANNELS.some((c) => Math.abs(now[c] - before[c]) > STICK_SPIKE);
    if (moved && (step - lastSpike) * STEP > 0.25) {
      marks.push({ t: tOf(step), kind: 'stick' });
      lastSpike = step;
    }
  }
  const need = Math.round(SATURATED_S / STEP);
  let run = 0;
  const v0 = frames[0].volt / frames[0].cells;
  let sagged = false;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    run = f.thr >= SATURATED_THR ? run + 1 : 0;
    if (run === need) marks.push({ t: tOf(stepOf(frames[i - need + 1])), kind: 'saturated' });
    if (!sagged && ((f.low && !frames[0].low) || f.volt / f.cells < v0 - SAG_V_PER_CELL)) {
      sagged = true;
      marks.push({ t: tOf(stepOf(f)), kind: 'sag' });
    }
    if (i > 0 && f.gate !== frames[i - 1].gate) marks.push({ t: tOf(stepOf(f)), kind: 'gate', index: frames[i - 1].gate });
  }
  return marks.sort((a, b) => a.t - b.t);
}

/** Where the clock is: the frame `index`, the fraction towards `index + 1`, and the time from the window's start. */
export interface ReplaySample {
  index: number;
  frac: number;
  t: number;
}

/** Plays a window at `REPLAY_SPEED`, pauses, scrubs. Allocates nothing per call. */
export class ReplayClock {
  t = 0;
  speed = REPLAY_SPEED;
  playing = true;
  readonly duration: number;
  private readonly frames: number;
  private readonly out: ReplaySample = { index: 0, frac: 0, t: 0 };

  constructor(window: Pick<ReplayWindow, 'frames'>) {
    this.frames = window.frames.length;
    this.duration = Math.max(0, (this.frames - 1) * STEP);
  }

  /** Advances by `dt` seconds of real time (at `speed`); stops at the end. */
  tick(dt: number): Readonly<ReplaySample> {
    if (this.playing) {
      this.t += Math.max(0, dt) * this.speed;
      if (this.t >= this.duration) {
        this.t = this.duration;
        this.playing = false;
      }
    }
    return this.sample();
  }

  play(): void {
    if (this.t >= this.duration) this.t = 0;
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  /** Jumps to `t` seconds from the window's start and pauses there. */
  scrub(t: number): Readonly<ReplaySample> {
    this.t = Math.min(this.duration, Math.max(0, t));
    this.playing = false;
    return this.sample();
  }

  sample(): Readonly<ReplaySample> {
    const o = this.out;
    const f = this.t / STEP;
    o.index = Math.max(0, Math.min(this.frames - 2, Math.floor(f + 1e-9)));
    o.frac = this.frames < 2 ? 0 : Math.min(1, Math.max(0, f - o.index));
    o.t = this.t;
    return o;
  }
}
