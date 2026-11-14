/**
 * Gesture thresholds of the bench as small state machines (design 3.1, 3.2, 3.3, 3.5): tap versus hold, the pull
 * threshold of a seated part, wrist-yaw turning in steps with hysteresis, the thumbstick flick, and the tracking-loss
 * timers. Each is fed numbers once per frame and allocates nothing. Pure: no IWSDK, no three.js.
 */
import { PITCH_M } from './cells';

// ---------------------------------------------------------------------------------------------------------- tap or hold

/** A tap is released within this long... */
export const TAP_MS = 300;
/** ...having moved less than this (world metres). Anything else is a hold (design 3.1). */
export const TAP_MOVE_M = 0.01;

export type PressKind = 'idle' | 'pending' | 'hold';

export interface PressTracker {
  /** `pending` until the press is known to be a hold (300 ms or 10 mm), then `hold`. */
  readonly kind: PressKind;
  start(tMs: number, x: number, y: number, z: number): void;
  /** The pinch point or controller tip now; returns the kind so far. */
  move(tMs: number, x: number, y: number, z: number): PressKind;
  /** The release: `tap` or `hold`. The tracker is idle again. */
  end(tMs: number): 'tap' | 'hold';
  cancel(): void;
}

export function createPressTracker(): PressTracker {
  let kind: PressKind = 'idle';
  let t0 = 0;
  let x0 = 0;
  let y0 = 0;
  let z0 = 0;
  let moved = 0;
  const age = (tMs: number) => tMs - t0;
  return {
    get kind() {
      return kind;
    },
    start(tMs, x, y, z) {
      kind = 'pending';
      t0 = tMs;
      x0 = x;
      y0 = y;
      z0 = z;
      moved = 0;
    },
    move(tMs, x, y, z) {
      if (kind !== 'pending') return kind;
      const dx = x - x0;
      const dy = y - y0;
      const dz = z - z0;
      moved = Math.max(moved, Math.sqrt(dx * dx + dy * dy + dz * dz));
      if (moved >= TAP_MOVE_M || age(tMs) > TAP_MS) kind = 'hold';
      return kind;
    },
    end(tMs) {
      const result = kind === 'pending' && age(tMs) <= TAP_MS && moved < TAP_MOVE_M ? 'tap' : 'hold';
      kind = 'idle';
      return result;
    },
    cancel() {
      kind = 'idle';
    },
  };
}

// ---------------------------------------------------------------------------------------------------------- pull out

/** A seated part leaves its holes once lifted this many pitches of work; below that it stays and a tether shows (design 3.2). */
export const PULL_PITCHES = 1;

export interface PullTracker {
  readonly pulled: boolean;
  /**
   * `lift` is how far the hand has risen along the board's normal since the grab, in world metres, at work scale `s`.
   * `tether` until it passes one pitch of work (0.00254 * s), then `pulled` until `reset`.
   */
  update(lift: number, s: number): 'tether' | 'pulled';
  reset(): void;
}

export function createPullTracker(): PullTracker {
  let pulled = false;
  return {
    get pulled() {
      return pulled;
    },
    update(lift, s) {
      if (!pulled && lift >= PULL_PITCHES * PITCH_M * s) pulled = true;
      return pulled ? 'pulled' : 'tether';
    },
    reset() {
      pulled = false;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------- wrist yaw

export interface YawStepOptions {
  readonly stepDeg: number;
  /** How far past the half-way point between two steps the wrist has to turn before the next step is taken. */
  readonly hysteresisDeg: number;
}

/** Parts near the board: quarter turns with 15 degrees of hysteresis (design 3.2). */
export const PART_YAW: YawStepOptions = { stepDeg: 90, hysteresisDeg: 15 };
/** Boards: 15 degree steps (design 3.4.9). The hysteresis is not in the design: a fifth of a step, a starting value [device?]. */
export const BOARD_YAW: YawStepOptions = { stepDeg: 15, hysteresisDeg: 3 };

export interface YawStepper {
  /** Whole steps turned since `reset` (negative the other way); the turn is `steps * stepDeg`. */
  readonly steps: number;
  /** Starts at the wrist's yaw now (degrees, any range). */
  reset(yawDeg: number): void;
  /** The wrist's yaw now (degrees, any range: it is unwrapped against the last one); returns `steps`. */
  update(yawDeg: number): number;
}

const wrap180 = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

export function createYawStepper(options: YawStepOptions = PART_YAW): YawStepper {
  const { stepDeg, hysteresisDeg } = options;
  let steps = 0;
  let last = 0;
  let turned = 0;
  return {
    get steps() {
      return steps;
    },
    reset(yawDeg) {
      steps = 0;
      last = yawDeg;
      turned = 0;
    },
    update(yawDeg) {
      turned += wrap180(yawDeg - last);
      last = yawDeg;
      while (turned > (steps + 0.5) * stepDeg + hysteresisDeg) steps++;
      while (turned < (steps - 0.5) * stepDeg - hysteresisDeg) steps--;
      return steps;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------- flick

/** A thumbstick flick: x past 0.7 fires, and it fires again only after coming back under 0.3 (design 3.3). */
export const FLICK_ON = 0.7;
export const FLICK_OFF = 0.3;

export interface Flick {
  /** The stick's x now; +1 or -1 on the frame a flick fires, else 0. */
  update(x: number): -1 | 0 | 1;
  reset(): void;
}

export function createFlick(): Flick {
  let armed = true;
  return {
    update(x) {
      if (!armed) {
        if (Math.abs(x) < FLICK_OFF) armed = true;
        return 0;
      }
      if (x > FLICK_ON || x < -FLICK_ON) {
        armed = false;
        return x > 0 ? 1 : -1;
      }
      return 0;
    },
    reset() {
      armed = true;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------- tracking loss

/** The pointer states with a tracking-loss rule (design 3.5). */
export type LossState = 'hold' | 'place' | 'wire';
/** `hold` and `place`: the part freezes, then goes back to its last valid spot after 500 ms, never seated. */
export const LOSS_RETURN_MS = 500;
/** `wire`: the pending end stays, then the pending wire is dropped after 1000 ms. */
export const LOSS_DROP_MS = 1000;

export type LossStep = 'tracking' | 'frozen' | 'return' | 'drop' | 'over';

export interface TrackingLoss {
  /** Tracking dropped at `tMs` while the pointer was in `state`. */
  lost(tMs: number, state: LossState): void;
  /** Tracking came back: everything carries on. */
  found(): void;
  /**
   * The step now: `frozen` while waiting, `return` (hold, place) or `drop` (wire) once, on the frame its time runs out,
   * then `over` until `found`; `tracking` while tracked.
   */
  update(tMs: number): LossStep;
}

export function createTrackingLoss(): TrackingLoss {
  let since = -1;
  let state: LossState = 'hold';
  let fired = false;
  return {
    lost(tMs, s) {
      if (since >= 0) return;
      since = tMs;
      state = s;
      fired = false;
    },
    found() {
      since = -1;
      fired = false;
    },
    update(tMs) {
      if (since < 0) return 'tracking';
      if (fired) return 'over';
      const wait = state === 'wire' ? LOSS_DROP_MS : LOSS_RETURN_MS;
      if (tMs - since < wait) return 'frozen';
      fired = true;
      return state === 'wire' ? 'drop' : 'return';
    },
  };
}
