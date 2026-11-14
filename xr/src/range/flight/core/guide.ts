/**
 * Guide flight (XR_DESIGN 8.3): one hand, the craft holds position and follows a point the person drags. A position
 * controller on the flight model's own sticks for an angle-attitude, climb-rate mode (the room's modes): a velocity
 * command from the position error, capped; pitch and roll from the velocity error rotated into the craft's yaw; climb
 * from the height error; yaw held. Course metres throughout; `guideSpeed(k)` converts the room cap.
 */
import { ceilingOf, type SimState, type Sticks } from '@/lib/flight';
import type { Out3 } from './room';

/** The fastest the craft follows the hand, room metres per second. */
export const GUIDE_ROOM_SPEED_M_S = 1.5;
/** And never faster than this in course metres per second, so a small-k course stays controllable. */
export const GUIDE_MAX_COURSE_SPEED_M_S = 6;
/** The target is kept this far inside the field's edge and below the ceiling (course metres). */
export const GUIDE_MARGIN_M = 1;

const G = 9.81;
const KP = 1.1; // 1/s, position error to velocity
const KV = 2.2; // 1/s, velocity error to acceleration
const KZ = 1.5; // 1/s, height error to climb rate

/** The guide's speed cap in course m/s for a course at `k` room metres per course metre. */
export function guideSpeed(k: number): number {
  return Math.min(GUIDE_ROOM_SPEED_M_S / Math.max(1e-6, k), GUIDE_MAX_COURSE_SPEED_M_S);
}

/** Keeps a course target inside the field and under the ceiling; writes into `out`. */
export function clampTarget(x: number, y: number, z: number, field: number, ceiling: number, out: Out3): Out3 {
  const m = GUIDE_MARGIN_M;
  out[0] = Math.min(field - m, Math.max(m, x));
  out[1] = Math.min(field - m, Math.max(m, y));
  out[2] = Math.min(ceiling - 1.5 * m, Math.max(0.3, z));
  return out;
}

const clamp1 = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

/**
 * Sticks that fly `sim`'s craft towards the course point (tx, ty, tz) at no more than `maxSpeed` m/s, for an angle,
 * climb-rate mode. Writes into `out`. The target should already be clamped (`clampTarget`).
 */
export function guideSticks(sim: Readonly<SimState>, tx: number, ty: number, tz: number, maxSpeed: number, out: Sticks): Sticks {
  const c = sim.craft, limit = sim.mode.angleLimit ?? c.angleLimit;
  // velocity command, capped
  let vx = KP * (tx - sim.p[0]), vy = KP * (ty - sim.p[1]);
  const vm = Math.hypot(vx, vy);
  if (vm > maxSpeed) {
    vx *= maxSpeed / vm;
    vy *= maxSpeed / vm;
  }
  // acceleration from the velocity error, capped by the tilt the mode allows
  let ax = KV * (vx - sim.v[0]), ay = KV * (vy - sim.v[1]);
  const amax = G * Math.tan((limit * Math.PI) / 180);
  const am = Math.hypot(ax, ay);
  if (am > amax) {
    ax *= amax / am;
    ay *= amax / am;
  }
  const yaw = (sim.yaw * Math.PI) / 180, hx = Math.cos(yaw), hy = Math.sin(yaw);
  const forward = ax * hx + ay * hy, leftward = -ax * hy + ay * hx;
  out.pitch = clamp1((Math.atan2(forward, G) * 180) / Math.PI / limit);
  out.roll = clamp1((Math.atan2(leftward, G) * 180) / Math.PI / limit);
  out.yaw = 0;
  // climb: the flight model ignores the first 0.05 of the throttle stick around centre, so step over it
  const top = ceilingOf(sim as SimState);
  const vz = Math.max(-c.climbRate, Math.min(c.climbRate, KZ * (Math.min(tz, top - 1.5) - sim.p[2])));
  const r = Math.abs(vz) / c.climbRate;
  out.throttle = r < 0.02 ? 0.5 : 0.5 + Math.sign(vz) * (0.05 + 0.45 * r);
  return out;
}
