/**
 * iynk's motion, for the headset: the site's one easing curve (`--ease-iynk`, src/styles/motion.css), its durations,
 * a few spring presets, and a runner that plays tweens and springs once per frame with no allocation per frame. Pure
 * maths (no three, no DOM), so it is unit tested; `./runner.ts` ticks one runner per world, and `./moves.ts` builds the
 * named moves (drop in, draw on, press, hover lift, panel open and close) on top of it.
 *
 *   import { easeIynk, DURATION, createMotion } from '../look/motion';
 *   const m = createMotion();
 *   m.tween({ ms: DURATION.move, onUpdate: (k) => (obj.position.y = y0 + 0.03 * k) });   // eased 0..1
 *   const s = m.spring({ from: 0, to: 1, preset: 'settle', onUpdate: (x) => obj.scale.setScalar(x) });
 *   s.to(0.5);                                       // retarget mid-flight, velocity kept
 *   m.tick(dtSeconds);                               // once per frame (the runner does this for you)
 *
 * Nothing on the bench snaps or pops without one of these. Under reduced motion every tween lasts at most
 * `REDUCED_MS` and every spring lands at once (XR_DESIGN.md 11.2: short fades replace moves).
 */

/* ---------- easing ---------- */
export type Ease = (t: number) => number;

/** The control points of `--ease-iynk: cubic-bezier(0.22, 1, 0.36, 1)`. */
export const EASE_IYNK = [0.22, 1, 0.36, 1] as const;

/** A CSS cubic-bezier(x1, y1, x2, y2) timing function: t in 0..1 (time) to progress. Exact to 1e-6. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Newton first, bisection if the slope is flat
    let u = t;
    for (let i = 0; i < 8; i++) {
      const e = sx(u) - t;
      if (Math.abs(e) < 1e-7) return sy(u);
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= e / d;
    }
    let lo = 0, hi = 1;
    u = t;
    for (let i = 0; i < 40; i++) {
      const x = sx(u);
      if (Math.abs(x - t) < 1e-7) break;
      if (x < t) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}

/** The iynk curve: fast out of the gate, a long soft landing. Every move and fade uses it unless it says otherwise. */
export const easeIynk: Ease = cubicBezier(...EASE_IYNK);
/** Linear, for loops (crawling rings, current flow) and for things driven by a value rather than time. */
export const linear: Ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t);
/** Symmetric in and out, for a pulse that comes and goes. */
export const easeInOut: Ease = (t) => {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/** Durations in ms: the site's motion classes and the design spec's timings (XR_DESIGN.md sections 2.4, 4, 9). */
export const DURATION = {
  /** Hover feedback leaving (on is within one frame). */
  hoverOff: 80,
  /** A UI plate sinking under a press. */
  press: 60,
  /** motion-press: a press springing back. */
  release: 200,
  /** motion-fade. */
  fade: 300,
  /** motion-move. */
  move: 500,
  /** --dur-reveal. */
  reveal: 700,
  /** The bench fading in while rising 0.03 m. */
  benchIn: 400,
  /** A part dropping onto the mat or into its seat, before it settles. */
  dropIn: 420,
  /** A seated part travelling the last bit into its holes. */
  seat: 90,
  /** A new wire drawing itself from end to end. */
  drawOn: 400,
  /** A panel opening (scale-in from 0.96 and fade). */
  panelOpen: 300,
  /** A panel closing. */
  panelClose: 200,
  /** Passthrough and paper room crossfading. */
  crossfade: 500,
  /** The pop ring at a committed contact. */
  popRing: 180,
} as const;

/** The longest anything takes under reduced motion: a short fade in place of a move. */
export const REDUCED_MS = 150;

/* ---------- springs ---------- */
/** A damped spring by its natural frequency (rad/s) and damping ratio (1 = critical, below 1 overshoots). */
export interface SpringPreset {
  readonly omega: number;
  readonly zeta: number;
}

/** The spring presets. Pick by feel; never tune a spring per call. */
export const SPRINGS = {
  /** Hover lift, press travel: quick and critically damped, no overshoot. */
  snappy: { omega: 38, zeta: 1 },
  /** A part landing: one small overshoot, then still (iynk's drop-in-and-settle). */
  settle: { omega: 24, zeta: 0.55 },
  /** Panels and chips following their anchor: slow and calm. */
  soft: { omega: 12, zeta: 0.95 },
  /** A lively wobble for a knob or a lever let go. */
  wobble: { omega: 30, zeta: 0.35 },
} as const satisfies Record<string, SpringPreset>;
export type SpringName = keyof typeof SPRINGS;

/** The position and velocity of one spring. */
export interface SpringState {
  x: number;
  v: number;
}

const SUBSTEP = 1 / 240;

/** Advances a spring towards `target` by `dt` seconds (semi-implicit Euler in steps of at most 1/240 s). */
export function stepSpring(s: SpringState, target: number, preset: SpringPreset, dt: number): void {
  const k = preset.omega * preset.omega, c = 2 * preset.zeta * preset.omega;
  let left = Math.min(Math.max(dt, 0), 0.1);
  while (left > 1e-9) {
    const h = left < SUBSTEP ? left : SUBSTEP;
    s.v += (-k * (s.x - target) - c * s.v) * h;
    s.x += s.v * h;
    left -= h;
  }
}

/** Whether a spring has come to rest at `target` (within `eps` of its travel `span`). */
export function springAtRest(s: SpringState, target: number, span = 1, eps = 1e-3): boolean {
  const tol = eps * Math.max(Math.abs(span), 1e-3);
  return Math.abs(s.x - target) < tol && Math.abs(s.v) < tol * 10;
}

/* ---------- the runner ---------- */
export interface TweenOptions {
  /** Duration in ms (clamped to `REDUCED_MS` under reduced motion). */
  ms: number;
  ease?: Ease;
  /** Wait before starting, ms (0 under reduced motion). */
  delay?: number;
  /** Called every frame with the eased progress 0..1, and once with 1 at the end. */
  onUpdate(k: number): void;
  onDone?(): void;
  /** A new tween with the same key cancels the running one (hover on and off never fight). */
  key?: object | string;
  /** Repeats forever (k runs 0..1 each period); `onDone` never fires. Static at k = 0 under reduced motion. */
  loop?: boolean;
}

export interface SpringOptions {
  from: number;
  to: number;
  preset: SpringName | SpringPreset;
  /** Starting velocity, units per second. */
  velocity?: number;
  onUpdate(x: number): void;
  onDone?(): void;
  key?: object | string;
}

export interface Motion {
  readonly done: boolean;
  /** Stops where it is; `onDone` does not fire. */
  cancel(): void;
  /** Jumps to the end: one last `onUpdate` at the end value, then `onDone`. */
  finish(): void;
}

export interface SpringMotion extends Motion {
  /** Moves the target, keeping the current position and velocity. */
  to(target: number): void;
  readonly value: number;
}

export interface MotionRunner {
  tween(opts: TweenOptions): Motion;
  spring(opts: SpringOptions): SpringMotion;
  /** Advances everything by `dt` seconds. */
  tick(dt: number): void;
  /** Cancels whatever runs under `key`. */
  cancel(key: object | string): void;
  /** Under reduced motion tweens last at most `REDUCED_MS` and springs land at once. */
  reducedMotion: boolean;
  /** How many tweens and springs are running (loops included). */
  readonly active: number;
}

interface Running {
  step(dt: number): boolean; // true when finished
  kill(): void;
  finish(): void;
  key?: object | string;
  dead: boolean;
}

export function createMotion(opts: { reducedMotion?: boolean } = {}): MotionRunner {
  let list: Running[] = [];
  const byKey = new Map<object | string, Running>();
  const runner: MotionRunner = {
    reducedMotion: opts.reducedMotion ?? false,
    get active() {
      return list.length;
    },
    tween(o) {
      const reduced = runner.reducedMotion;
      const ms = Math.max(0, reduced ? Math.min(o.ms, REDUCED_MS) : o.ms);
      const ease = o.ease ?? easeIynk;
      let wait = reduced ? 0 : Math.max(0, o.delay ?? 0) / 1000;
      let t = 0;
      const r: Running = {
        dead: false,
        key: o.key,
        step(dt) {
          if (wait > 0) {
            wait -= dt;
            if (wait > 0) return false;
            dt = -wait;
          }
          if (o.loop) {
            if (reduced || ms === 0) {
              o.onUpdate(0);
              return false;
            }
            t = (t + dt) % (ms / 1000);
            o.onUpdate(ease(t / (ms / 1000)));
            return false;
          }
          t += dt;
          const k = ms === 0 ? 1 : Math.min(1, t / (ms / 1000));
          o.onUpdate(k >= 1 ? 1 : ease(k));
          if (k >= 1) {
            o.onDone?.();
            return true;
          }
          return false;
        },
        kill() {
          r.dead = true;
        },
        finish() {
          if (r.dead) return;
          r.dead = true;
          if (o.loop) return;
          o.onUpdate(1);
          o.onDone?.();
        },
      };
      return add(r);
    },
    spring(o) {
      const preset = typeof o.preset === 'string' ? SPRINGS[o.preset] : o.preset;
      const s: SpringState = { x: o.from, v: o.velocity ?? 0 };
      let target = o.to;
      let span = Math.abs(o.to - o.from) || 1;
      const r: Running = {
        dead: false,
        key: o.key,
        step(dt) {
          if (runner.reducedMotion) {
            s.x = target;
            s.v = 0;
          } else stepSpring(s, target, preset, dt);
          if (runner.reducedMotion || springAtRest(s, target, span)) {
            s.x = target;
            s.v = 0;
            o.onUpdate(target);
            o.onDone?.();
            return true;
          }
          o.onUpdate(s.x);
          return false;
        },
        kill() {
          r.dead = true;
        },
        finish() {
          if (r.dead) return;
          r.dead = true;
          s.x = target;
          s.v = 0;
          o.onUpdate(target);
          o.onDone?.();
        },
      };
      const m = add(r) as SpringMotion & { value: number };
      Object.defineProperty(m, 'value', { get: () => s.x });
      m.to = (next: number) => {
        span = Math.abs(next - s.x) || span;
        target = next;
        if (r.dead) {
          // landed already: start again from where it rests
          r.dead = false;
          list = [...list, r];
          if (r.key !== undefined) byKey.set(r.key, r);
        }
      };
      return m;
    },
    tick(dt) {
      if (list.length === 0) return;
      let removed = false;
      const now = list;
      for (let i = 0; i < now.length; i++) {
        const r = now[i]!;
        if (r.dead) {
          removed = true;
          continue;
        }
        let finished = false;
        try {
          finished = r.step(dt);
        } catch (err) {
          console.error('[look] motion threw', err);
          finished = true;
        }
        if (finished) {
          r.dead = true;
          removed = true;
        }
      }
      if (removed) prune();
    },
    cancel(key) {
      const r = byKey.get(key);
      if (r) {
        r.kill();
        byKey.delete(key);
      }
    },
  };

  function prune() {
    list = list.filter((r) => !r.dead);
    for (const [k, r] of byKey) if (r.dead) byKey.delete(k);
  }

  function add(r: Running): Motion {
    if (r.key !== undefined) {
      byKey.get(r.key)?.kill();
      byKey.set(r.key, r);
    }
    list = [...list, r];
    return {
      get done() {
        return r.dead;
      },
      cancel() {
        r.kill();
      },
      finish() {
        r.finish();
      },
    };
  }

  return runner;
}
