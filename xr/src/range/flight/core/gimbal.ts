/**
 * Hand gimbal sticks (XR_DESIGN 8.3): a pinch in the air off any target makes a ring at the pinch point, and the hand's
 * offset from it is the stick. 60 mm is full deflection and the first 15 % is dead, radially, rescaled so the stick
 * leaves zero smoothly (the numbers of `virtualStick` in `xr/src/input/helpers.ts`). The axes are the person's, fixed
 * by the head's heading when the pinch began: the left hand's up and down is climb, its left and right is yaw; the
 * right hand's away and back is pitch, its left and right is roll. Letting go centres the stick: a hover.
 */
import type { Sticks } from '@/lib/flight';
import type { Vec3 } from '../../../contracts/common';
import { VIRTUAL_STICK_DEADZONE, VIRTUAL_STICK_FULL_M, type Heading } from '../../../input/helpers';

/** One pinch ring: where the pinch began, where the pinch point is now (world), and the heading fixed at its start. */
export interface GimbalPinch {
  readonly origin: Vec3;
  readonly point: Vec3;
  readonly heading: Heading;
}

/** A ring's two axes, -1..1: `x` to the person's right, `y` up (left hand) or away (right hand). */
export interface RingAxes {
  x: number;
  y: number;
}

/** Radial dead zone and full deflection on a 2D offset in metres. */
export function ringStick(a: number, b: number, out: RingAxes): RingAxes {
  const len = Math.hypot(a, b);
  const m = len / VIRTUAL_STICK_FULL_M;
  if (len === 0 || m <= VIRTUAL_STICK_DEADZONE) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const s = (Math.min(m, 1) - VIRTUAL_STICK_DEADZONE) / (1 - VIRTUAL_STICK_DEADZONE);
  out.x = (a / len) * s;
  out.y = (b / len) * s;
  return out;
}

/** The left ring: right and up of the pinch origin. */
export function leftRing(p: GimbalPinch, out: RingAxes): RingAxes {
  const dx = p.point[0] - p.origin[0], dy = p.point[1] - p.origin[1], dz = p.point[2] - p.origin[2];
  return ringStick(dx * -p.heading.fz + dz * p.heading.fx, dy, out);
}

/** The right ring: right and away of the pinch origin. */
export function rightRing(p: GimbalPinch, out: RingAxes): RingAxes {
  const dx = p.point[0] - p.origin[0], dz = p.point[2] - p.origin[2];
  return ringStick(dx * -p.heading.fz + dz * p.heading.fx, dx * p.heading.fx + dz * p.heading.fz, out);
}

const ring: RingAxes = { x: 0, y: 0 };

/** Both hands (either may be null: centred) to `Sticks` for a climb-rate throttle, written into `out`. */
export function handSticks(left: GimbalPinch | null, right: GimbalPinch | null, out: Sticks): Sticks {
  if (left) {
    leftRing(left, ring);
    out.throttle = 0.5 + ring.y / 2;
    out.yaw = ring.x;
  } else {
    out.throttle = 0.5;
    out.yaw = 0;
  }
  if (right) {
    rightRing(right, ring);
    out.pitch = ring.y;
    out.roll = 0 - ring.x;
  } else {
    out.pitch = 0;
    out.roll = 0;
  }
  return out;
}
