/**
 * Pure helpers behind the input service: press classification and the hand's virtual stick. No three.js or IWSDK
 * runtime imports, so the tests run them in Node.
 */
import type { BindOptions, PointerMode, PointerSource } from '../contracts/input';

/**
 * Which IWSDK pointer produced an event. `ray`, `grab` and `touch` are a hand's sub-pointers
 * (`input.xr.multiPointers[hand].getPointer(kind)`), `gaze` is `input.xr.gazePointer.pointer`, `mouse` is any pointer
 * forwarded from the canvas (`screen-mouse`, `screen-pen`, `screen-touch`).
 */
export type PointerKind = 'ray' | 'grab' | 'touch' | 'gaze' | 'mouse';

export interface GrabFlags {
  readonly near: boolean;
  readonly distance: boolean;
}

export function grabFlags(grab: BindOptions['grab']): GrabFlags {
  return {
    near: grab === 'near' || grab === 'both',
    distance: grab === 'distance' || grab === 'both',
  };
}

/**
 * Whether a press from this pointer picks the object up (a grab) rather than selecting it. Near grabs come from the
 * grab sub-pointer (controller grip, or hand pinch when IWSDK routes the pinch to it). Distance grabs come from a ray:
 * the controller or hand ray, gaze, or the mouse on desktop. A fingertip poke always selects.
 */
export function isGrabPress(kind: PointerKind, flags: GrabFlags): boolean {
  if (kind === 'grab') return flags.near;
  if (kind === 'touch') return false;
  return flags.distance;
}

export function modeOf(kind: PointerKind): PointerMode {
  if (kind === 'touch') return 'poke';
  if (kind === 'grab') return 'grab';
  return 'ray';
}

export function sourceOf(kind: PointerKind, handIsPrimary: boolean): PointerSource {
  if (kind === 'mouse') return 'mouse';
  if (kind === 'gaze') return 'gaze';
  return handIsPrimary ? 'hand' : 'controller';
}

/** A pinch that moves this far from where it started is full stick deflection. */
export const VIRTUAL_STICK_FULL_M = 0.06;
/** Fraction of full deflection ignored around the start point, so a held pinch does not drift. */
export const VIRTUAL_STICK_DEADZONE = 0.15;

export interface Stick {
  x: number;
  y: number;
}

export interface Heading {
  /** Unit horizontal forward, x and z of the rig frame. */
  fx: number;
  fz: number;
}

/**
 * Horizontal forward of a head orientation (quaternion x, y, z, w, rig frame). Looking straight down or up has no
 * horizontal forward, so the head's up axis stands in (it points forward when looking down, backward when looking up).
 * Writes into `out` and returns it.
 */
export function headingOf(qx: number, qy: number, qz: number, qw: number, out: Heading): Heading {
  // Rotated -Z.
  let x = -2 * (qx * qz + qw * qy);
  const y = -2 * (qy * qz - qw * qx);
  let z = -(1 - 2 * (qx * qx + qy * qy));
  let len = Math.hypot(x, z);
  if (len < 0.2) {
    // Rotated +Y, flipped when looking up.
    const sign = y < 0 ? 1 : -1;
    x = sign * 2 * (qx * qy - qw * qz);
    z = sign * 2 * (qy * qz + qw * qx);
    len = Math.hypot(x, z);
  }
  if (len < 1e-6) {
    out.fx = 0;
    out.fz = -1;
  } else {
    out.fx = x / len;
    out.fz = z / len;
  }
  return out;
}

/**
 * The virtual stick from a pinch's horizontal offset (dx, dz in metres, rig frame) and the heading at pinch start.
 * Same convention as a Quest thumbstick: right is +x, forward (away from the person) is -y. Radial deadzone, then
 * rescaled so the stick leaves zero smoothly and reaches 1 at {@link VIRTUAL_STICK_FULL_M}. Writes into `out`.
 */
export function virtualStick(dx: number, dz: number, heading: Heading, out: Stick): Stick {
  // Right of forward (fx, 0, fz) is (-fz, 0, fx).
  const right = dx * -heading.fz + dz * heading.fx;
  const forward = dx * heading.fx + dz * heading.fz;
  const len = Math.hypot(right, forward);
  const m = len / VIRTUAL_STICK_FULL_M;
  if (m <= VIRTUAL_STICK_DEADZONE || len === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const s = (Math.min(m, 1) - VIRTUAL_STICK_DEADZONE) / (1 - VIRTUAL_STICK_DEADZONE);
  out.x = (right / len) * s;
  out.y = (-forward / len) * s;
  return out;
}

export function clampUnit(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Joints read for a hand pose, in this order, from a packed `Float32Array` of 4x4 column-major poses. */
export const POSE_JOINTS = [
  'wrist',
  'index-finger-phalanx-proximal',
  'middle-finger-phalanx-proximal',
  'ring-finger-phalanx-proximal',
  'pinky-finger-phalanx-proximal',
  'index-finger-tip',
  'middle-finger-tip',
  'ring-finger-tip',
  'pinky-finger-tip',
] as const;
const WRIST = 0;
const KNUCKLE = 1;
const TIP = 5;

/** A finger counts as stretched out when its tip is this many times further from the wrist than its knuckle. */
export const OPEN_RATIO = 1.5;

const at = (m: ArrayLike<number>, joint: number, axis: number) => m[joint * 16 + 12 + axis]!;
const dist2 = (m: ArrayLike<number>, a: number, b: number) => {
  const dx = at(m, a, 0) - at(m, b, 0);
  const dy = at(m, a, 1) - at(m, b, 1);
  const dz = at(m, a, 2) - at(m, b, 2);
  return dx * dx + dy * dy + dz * dz;
};

/**
 * The palm normal (out of the palm) from packed joint poses in {@link POSE_JOINTS} order, any frame: the cross product
 * of wrist to index knuckle and wrist to little-finger knuckle, which points out of the palm for a right hand and
 * into it for a left one. Writes a unit vector into `out` (unchanged when the joints are degenerate).
 */
export function palmNormal(m: ArrayLike<number>, hand: 'left' | 'right', out: [number, number, number]): [number, number, number] {
  const ax = at(m, KNUCKLE, 0) - at(m, WRIST, 0);
  const ay = at(m, KNUCKLE, 1) - at(m, WRIST, 1);
  const az = at(m, KNUCKLE, 2) - at(m, WRIST, 2);
  const bx = at(m, KNUCKLE + 3, 0) - at(m, WRIST, 0);
  const by = at(m, KNUCKLE + 3, 1) - at(m, WRIST, 1);
  const bz = at(m, KNUCKLE + 3, 2) - at(m, WRIST, 2);
  const sign = hand === 'right' ? 1 : -1;
  const x = sign * (ay * bz - az * by);
  const y = sign * (az * bx - ax * bz);
  const z = sign * (ax * by - ay * bx);
  const len = Math.hypot(x, y, z);
  if (len > 1e-9) {
    out[0] = x / len;
    out[1] = y / len;
    out[2] = z / len;
  }
  return out;
}

/** Whether the index, middle, ring and little fingers are all stretched out, from packed joint poses. */
export function fingersOpen(m: ArrayLike<number>): boolean {
  const k = OPEN_RATIO * OPEN_RATIO;
  for (let f = 0; f < 4; f++) {
    if (dist2(m, TIP + f, WRIST) < k * dist2(m, KNUCKLE + f, WRIST)) return false;
  }
  return true;
}

/** A button's state, written in place each frame. */
export interface MutableButton {
  pressed: boolean;
  down: boolean;
  up: boolean;
}

/** Advances a button by one frame: `down` and `up` are true only on the frame `pressed` changes. */
export function stepButton(s: MutableButton, pressed: boolean): void {
  s.down = pressed && !s.pressed;
  s.up = !pressed && s.pressed;
  s.pressed = pressed;
}

/** A hold's report, written in place. Same shape as the contract's `FreeHold`. */
export interface MutableHold {
  by: 'pinch' | 'grip';
  start: [number, number, number];
  position: [number, number, number];
  sinceMs: number;
}

export interface HoldState {
  /** The pinch or squeeze is down. */
  active: boolean;
  /** Active and not taken by a bound object: the hold to report. */
  free: boolean;
  startMs: number;
  readonly hold: MutableHold;
}

export function newHoldState(): HoldState {
  return {
    active: false,
    free: false,
    startMs: 0,
    hold: { by: 'pinch', start: [0, 0, 0], position: [0, 0, 0], sinceMs: 0 },
  };
}

/**
 * Advances a hold by one frame. A hold is free when it is down and no bound object has taken it (`consumed`): judged
 * on its first frame, and lost for good if a bound object takes it later. `start` is captured once, on that frame.
 */
export function stepHold(
  s: HoldState,
  active: boolean,
  consumed: boolean,
  nowMs: number,
  by: 'pinch' | 'grip',
  x: number,
  y: number,
  z: number,
): void {
  if (!active) {
    s.active = false;
    s.free = false;
    return;
  }
  const h = s.hold;
  if (!s.active) {
    s.active = true;
    s.free = !consumed;
    s.startMs = nowMs;
    h.by = by;
    h.start[0] = x;
    h.start[1] = y;
    h.start[2] = z;
  } else if (consumed) {
    s.free = false;
  }
  if (!s.free) return;
  h.position[0] = x;
  h.position[1] = y;
  h.position[2] = z;
  h.sinceMs = nowMs - s.startMs;
}
