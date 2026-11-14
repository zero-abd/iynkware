/**
 * The two-handed scale gesture (pure). Both hands pinch (or pull the trigger) within 400 ms of each other, on no bound
 * target; the spread of the hands then drives the bench scale at once, 1 to 6. Letting go (or losing tracking) ends it.
 */
export const WINDOW_MS = 400;
export const LOSS_MS = 1000;
export const MIN_SCALE = 1;
export const MAX_SCALE = 6;

export interface GestureInput {
  /** Milliseconds, any monotonic clock. */
  t: number;
  /** [left, right]: the pose exists. */
  tracked: readonly [boolean, boolean];
  pinching: readonly [boolean, boolean];
  /** Hovering or holding a bound target. */
  busy: readonly [boolean, boolean];
  /** Distance between the two pose positions, metres. */
  dist: number;
  /** The bench's scale now. */
  scale: number;
}

export interface GestureOut {
  /** Set the bench scale to this, at once. */
  scale: number | null;
  /** Buzz both hands: the top step was reached. */
  tick: boolean;
  /** The gesture ended: pass this to `setWorkScale`. */
  release: number | null;
}

export interface GestureState {
  active: boolean;
  d0: number;
  s0: number;
  cur: number;
  atMax: boolean;
  lostAt: number;
  prev: [boolean, boolean];
  edgeAt: [number, number];
  edgeBusy: [boolean, boolean];
  out: GestureOut;
}

export const newGesture = (): GestureState => ({
  active: false,
  d0: 1,
  s0: 1,
  cur: 1,
  atMax: false,
  lostAt: -1,
  prev: [false, false],
  edgeAt: [-1e9, -1e9],
  edgeBusy: [false, false],
  out: { scale: null, tick: false, release: null },
});

export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** One frame. The returned object is reused: read it at once. */
export function stepGesture(g: GestureState, i: GestureInput): GestureOut {
  const o = g.out;
  o.scale = null;
  o.tick = false;
  o.release = null;
  for (let h = 0; h < 2; h++) {
    const p = i.pinching[h]! && i.tracked[h]!;
    if (p && !g.prev[h]!) {
      g.edgeAt[h] = i.t;
      g.edgeBusy[h] = i.busy[h]!;
    }
    g.prev[h] = p;
  }
  if (!g.active) {
    const both = g.prev[0]! && g.prev[1]!;
    if (both && !i.busy[0] && !i.busy[1] && !g.edgeBusy[0] && !g.edgeBusy[1] && Math.abs(g.edgeAt[0] - g.edgeAt[1]) <= WINDOW_MS && i.dist > 0.02) {
      g.active = true;
      g.d0 = i.dist;
      g.s0 = i.scale;
      g.cur = i.scale;
      g.atMax = i.scale >= MAX_SCALE;
      g.lostAt = -1;
    }
    return o;
  }
  if (!i.tracked[0] || !i.tracked[1]) {
    // Hold the scale; snap after a second.
    if (g.lostAt < 0) g.lostAt = i.t;
    if (i.t - g.lostAt >= LOSS_MS) end(g, o);
    return o;
  }
  if (g.lostAt >= 0 || !g.prev[0] || !g.prev[1]) {
    // Tracking returned, or a hand let go.
    end(g, o);
    return o;
  }
  g.cur = clampScale((g.s0 * i.dist) / g.d0);
  o.scale = g.cur;
  if (g.cur >= MAX_SCALE) {
    if (!g.atMax) {
      g.atMax = true;
      o.tick = true;
    }
  } else if (g.cur < MAX_SCALE - 0.1) g.atMax = false;
  return o;
}

function end(g: GestureState, o: GestureOut): void {
  g.active = false;
  g.lostAt = -1;
  o.release = g.cur;
}
