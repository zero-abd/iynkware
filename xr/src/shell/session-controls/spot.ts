/**
 * Where the session-controls cluster stands by default: fixed in the room, on the person's left and out of the forward
 * view, a little below eye level, turned to face them. It is worked out once from where the person stands and faces
 * (when the session starts, and again on Recentre) and then never follows the head or body. Pure maths, tested;
 * `index.ts` feeds it the camera. Yaw is the bench's convention: 0 looks down -z, positive turns to the left.
 */
import type { Vec3 } from '../../contracts/common';
import { placementFrom, type Placement } from '../kit/place';

/** The default place, all in one place to tune (owner, 2026-11-14: "on the left side", "a bit further"). */
export const CLUSTER = {
  /** Eyes to the cluster's centre, metres: past touch range, read and pressed by ray or hand ray. */
  distance: 0.85,
  /**
   * Towards the left of the heading (negative is left): clear of the bench's run cluster, the forward view and the
   * panel ring's `side` slot at 58 degrees (bench/core/ring.ts), whose fault panel would otherwise stand behind it.
   */
  sideDeg: -86,
  /**
   * A little under eye level: above the companion on the bench's front-left corner (about 46 degrees left, 12 to 30
   * below from the eyes), which would otherwise stand in front of Exit.
   */
  belowDeg: 6,
} as const;

/** The yaw (bench convention) of a forward vector; keeps `fallback` when the head looks straight up or down. */
export function yawOfForward(fx: number, fz: number, fallback = 0): number {
  return Math.hypot(fx, fz) < 1e-4 ? fallback : Math.atan2(-fx, -fz);
}

/** The signed shortest angle from `a` to `b`, radians, in (-pi, pi]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * The cluster's default centre (world metres) for eyes at `eye` looking along `forward` (only its direction on the
 * floor plan counts, so looking down at the bench does not move it), and the eye it turns to face. `keepYaw` is the
 * heading used when the person looks straight up or down.
 */
export function clusterHome(eye: Vec3, forward: Vec3, keepYaw = 0): Placement {
  const yaw = yawOfForward(forward[0], forward[2], keepYaw);
  return placementFrom(eye, [-Math.sin(yaw), 0, -Math.cos(yaw)], CLUSTER);
}
