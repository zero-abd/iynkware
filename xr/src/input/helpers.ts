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
