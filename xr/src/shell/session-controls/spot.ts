/**
 * Where the session-controls cluster stands by default: fixed in the room, about 48 degrees to the person's left, just
 * above eye level, beside the companion, turned to face them. It is worked out once from where the person stands and faces
 * (when the session starts, and again on Recentre) and then never follows the head or body. Pure maths, tested;
 * `index.ts` feeds it the camera. Yaw is the bench's convention: 0 looks down -z, positive turns to the left.
 */
import type { Vec3 } from '../../contracts/common';
import { placementFrom, type Placement } from '../kit/place';

/**
 * The default place, all in one place to tune (owner, 2026-11-14: "on the left side", "a bit further"; 2026-11-15 on a
 * Quest 3S: "around 45 to 50 degree to the left from the center", "a couple degrees above horizontal", beside the
 * companion).
 */
export const CLUSTER = {
  /** Eyes to the cluster's centre, metres: past touch range, read and pressed by ray or hand ray. */
  distance: 0.85,
  /**
   * Towards the left of the heading (negative is left): half way round, between the lesson guide (31 degrees) and the
   * panel ring's `side` slot (58 degrees, bench/core/ring.ts), above the panels' top edges.
   */
  sideDeg: -48,
  /**
   * Negative is above eye level: just over the horizon, so it sits above the companion on the bench's front-left
   * corner (about 46 degrees left, 12 to 30 below from the eyes) and above the ring's panels, not in front of them.
   */
  belowDeg: -3,
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

/**
 * The heading Recentre and the cluster are placed from (owner, 2026-11-15: pressing Recentre on the left must put the
 * bench in front, not where the head turned to reach the button). While the head looks towards the cluster, within
 * `cone`, that look is not a heading; the heading is the last one the head held for `steadyS` seconds, within
 * `steadyRad`, anywhere else. A head that does not look at the cluster is its own heading (a ray pressed from the side).
 */
export const HEADING = { cone: (30 * Math.PI) / 180, steadyS: 0.5, steadyRad: (12 * Math.PI) / 180 } as const;

export interface HeadingTracker {
  /** Feeds one frame: the head's yaw, the cluster's yaw from the eyes (null when it is not shown), seconds since the last. */
  update(headYaw: number, clusterYaw: number | null, dt: number): void;
  /** The heading for a press now, with the head at `headYaw` and the cluster at `clusterYaw` from the eyes. */
  heading(headYaw: number, clusterYaw: number | null): number;
  /** Starts over from `yaw` (the cluster was just placed from it). */
  reset(yaw: number): void;
}

export function headingTracker(initialYaw = 0): HeadingTracker {
  let settled = initialYaw;
  let anchor: number | null = null;
  let held = 0;
  const atCluster = (head: number, cluster: number | null) => cluster !== null && Math.abs(angleDiff(head, cluster)) < HEADING.cone;
  return {
    update(head, cluster, dt) {
      if (atCluster(head, cluster)) {
        anchor = null;
        return;
      }
      if (anchor === null || Math.abs(angleDiff(anchor, head)) > HEADING.steadyRad) {
        anchor = head;
        held = 0;
        return;
      }
      held += dt;
      if (held >= HEADING.steadyS) settled = anchor;
    },
    heading: (head, cluster) => (atCluster(head, cluster) ? settled : head),
    reset(yaw) {
      settled = yaw;
      anchor = null;
      held = 0;
    },
  };
}
