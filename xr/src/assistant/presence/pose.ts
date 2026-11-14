/**
 * Where a step will put things, in the bench's board frame (contracts/space.ts), worked out before the step is applied
 * so its ghost stands exactly where the part will land. The rules are the contract's (contracts/assets.ts
 * `Footprint`, contracts/space.ts): a board or surface goes where its footprint corner meets the placement's
 * (x_mm, y_mm), turned about that corner; a leaded part is seated so its first two leg anchors sit in their holes.
 * Plus the paths the companion travels on. Pure maths over three's vectors, so it is unit tested.
 */
import { Vector3 } from '@iwsdk/core';
import type { Footprint } from '../../contracts/assets';

/** A board-frame pose: a position and a turn about +y. */
export interface Pose {
  readonly position: Vector3;
  readonly yaw: number;
}

const Y = new Vector3(0, 1, 0);

/** The pose of a board or surface placed with its footprint corner at (x_mm, y_mm), turned by `rotationDeg`. */
export function cornerPose(fp: Footprint, xMm: number, yMm: number, rotationDeg = 0): Pose {
  const yaw = (-rotationDeg * Math.PI) / 180;
  const w = new Vector3(-fp.x, 0, -fp.z).applyAxisAngle(Y, yaw);
  return { position: new Vector3(xMm / 1000 + w.x, 0, yMm / 1000 + w.z), yaw };
}

/**
 * The pose of a part seated by its legs: `anchorOf` gives a leg's anchor in the asset frame, `holeAt` a hole's
 * board-frame position. Null when the first leg or its hole is unknown.
 */
export function seatedPose(
  legs: ReadonlyArray<readonly [leg: string, hole: string]>,
  anchorOf: (leg: string) => readonly [number, number, number] | undefined,
  holeAt: (hole: string) => Vector3 | null,
): Pose | null {
  const [first, second] = legs;
  if (!first) return null;
  const h1 = holeAt(first[1]);
  const a1 = anchorOf(first[0]);
  if (!h1 || !a1) return null;
  let yaw = 0;
  const h2 = second ? holeAt(second[1]) : null;
  const a2 = second ? anchorOf(second[0]) : undefined;
  if (h2 && a2) {
    const want = Math.atan2(h2.z - h1.z, h2.x - h1.x);
    const have = Math.atan2(a2[2] - a1[2], a2[0] - a1[0]);
    yaw = -(want - have);
  }
  const off = new Vector3(a1[0], a1[1], a1[2]).applyAxisAngle(Y, yaw);
  return { position: h1.clone().sub(off), yaw };
}

/** The control point of the bench's wire arc between two ends (the default renderer's): above the higher end. */
export function wireControl(a: Vector3, b: Vector3, out = new Vector3()): Vector3 {
  out.copy(a).add(b).multiplyScalar(0.5);
  out.y = Math.max(a.y, b.y) + 0.007 + a.distanceTo(b) * 0.18;
  return out;
}

/** A point on the quadratic arc from `a` through the lifted midpoint to `b`, at `t` 0..1. No allocation. */
export function arcPoint(a: Vector3, b: Vector3, lift: number, t: number, out: Vector3): Vector3 {
  const u = 1 - t;
  const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
  const cy = Math.max(a.y, b.y) + lift;
  out.x = u * u * a.x + 2 * u * t * cx + t * t * b.x;
  out.y = u * u * a.y + 2 * u * t * cy + t * t * b.y;
  out.z = u * u * a.z + 2 * u * t * cz + t * t * b.z;
  return out;
}

/** How high a flight from `a` to `b` arcs: a hop for a short move, more for a long one. */
export const arcLift = (a: Vector3, b: Vector3): number => 0.03 + a.distanceTo(b) * 0.35;

/** How long a flight takes, ms: about the site's move for a short one, never dragging for a long one. */
export const flightMs = (distanceM: number): number => Math.round(Math.min(1100, Math.max(450, 380 + distanceM * 900)));

/** The shortest turn from `from` to `to`, radians, in -pi..pi. */
export function turnTo(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** The yaw that turns +z towards (dx, dz). */
export const yawTowards = (dx: number, dz: number): number => Math.atan2(dx, dz);
