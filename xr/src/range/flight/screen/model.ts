/** The FPV and chase screen's maths (issue #125): the view cycle, the cameras and the render rate. Pure, no allocation. */
import type { RoomVolume } from '../core';

export type View = 'los' | 'chase' | 'fpv';

/** Line of sight, then chase, then FPV, then back. */
export function nextView(v: View): View {
  return v === 'los' ? 'chase' : v === 'chase' ? 'fpv' : 'los';
}

/** The screen's picture is 16:9. */
export const ASPECT = 16 / 9;
/** The picture is drawn this often. */
export const SCREEN_HZ = 15;
/** Chase camera: this far behind the craft along its yaw and above it (room metres). */
export const CHASE_BACK_M = 0.7;
export const CHASE_UP_M = 0.3;
const EDGE_M = 0.05;

const RAD = Math.PI / 180;

/** A horizontal field of view (degrees) for a picture of `aspect` (w / h) as a vertical one (degrees). */
export function verticalFov(horizontalDeg: number, aspect = ASPECT): number {
  const h = Math.min(170, Math.max(1, horizontalDeg)) * RAD;
  return (2 * Math.atan(Math.tan(h / 2) / aspect)) / RAD;
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  /** Euler 'YXZ' radians: the craft's own (yaw about +Y, then pitch, then roll). */
  ry: number;
  rx: number;
  rz: number;
}

export interface Vec {
  x: number;
  y: number;
  z: number;
}

/** A quaternion as x, y, z, w. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

function mul(a: Quat, b: Quat, o: Quat): Quat {
  const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
  const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
  const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
  const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
  o.x = x;
  o.y = y;
  o.z = z;
  o.w = w;
  return o;
}

const qa: Quat = { x: 0, y: 0, z: 0, w: 1 };
const qb: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Euler 'YXZ' to a quaternion (three.js's convention). */
export function eulerYXZ(rx: number, ry: number, rz: number, o: Quat): Quat {
  const c1 = Math.cos(rx / 2), c2 = Math.cos(ry / 2), c3 = Math.cos(rz / 2);
  const s1 = Math.sin(rx / 2), s2 = Math.sin(ry / 2), s3 = Math.sin(rz / 2);
  o.x = s1 * c2 * c3 + c1 * s2 * s3;
  o.y = c1 * s2 * c3 - s1 * c2 * s3;
  o.z = c1 * c2 * s3 - s1 * s2 * c3;
  o.w = c1 * c2 * c3 + s1 * s2 * s3;
  return o;
}

/**
 * The FPV camera: at the craft, looking along its nose (+Z of the craft; a camera looks down -Z, so it is turned half a
 * turn about Y) and tilted up by the camera's uptilt, rolling and pitching with the craft.
 */
export function fpvCamera(p: Pose, camTiltDeg: number, outPos: Vec, outQuat: Quat): void {
  outPos.x = p.x;
  outPos.y = p.y;
  outPos.z = p.z;
  eulerYXZ(p.rx, p.ry, p.rz, qa);
  qb.x = 0;
  qb.y = 1;
  qb.z = 0;
  qb.w = 0;
  mul(qa, qb, qa);
  const t = (camTiltDeg * RAD) / 2;
  qb.x = Math.sin(t);
  qb.y = 0;
  qb.z = 0;
  qb.w = Math.cos(t);
  mul(qa, qb, outQuat);
}

/**
 * The chase camera's place: `back` metres behind the craft along its yaw (its nose is `(sin ry, 0, cos ry)`) and `up`
 * above it, clamped inside the flight volume so it never sits in a net or the floor. The caller looks at the craft.
 */
export function chasePosition(p: Pose, v: RoomVolume, out: Vec, back = CHASE_BACK_M, up = CHASE_UP_M): void {
  let x = p.x - Math.sin(p.ry) * back;
  let z = p.z - Math.cos(p.ry) * back;
  let y = p.y + up;
  const lat = (x - v.ox) * v.rx + (z - v.oz) * v.rz;
  const fwd = (x - v.ox) * v.fx + (z - v.oz) * v.fz;
  const cl = Math.min(v.right - EDGE_M, Math.max(v.left + EDGE_M, lat));
  const cf = Math.min(v.far - EDGE_M, Math.max(v.near + EDGE_M, fwd));
  x += (cl - lat) * v.rx + (cf - fwd) * v.fx;
  z += (cl - lat) * v.rz + (cf - fwd) * v.fz;
  y = Math.min(v.floorY + v.top - EDGE_M, Math.max(v.floorY + v.bottom + EDGE_M, y));
  out.x = x;
  out.y = y;
  out.z = z;
}

/** True when a frame is due at `hz`; `state.t` is the caller's accumulator. A long stall drops frames rather than bursting. */
export function frameDue(state: { t: number }, dt: number, hz = SCREEN_HZ): boolean {
  state.t += dt;
  const step = 1 / hz;
  if (state.t < step) return false;
  state.t = state.t > 4 * step ? 0 : state.t - step;
  return true;
}
