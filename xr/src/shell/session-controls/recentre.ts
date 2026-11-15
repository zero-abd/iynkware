/**
 * Recentre: where the bench goes so it stands in front of the person again (XR_DESIGN.md 2.1 and 2.4, "Bring the bench
 * here"): the top's front edge 0.15 m ahead of the eyes, its centre half a depth further, level, facing the person,
 * the top at eye height minus 0.47 m clamped for the posture. The move is written to `BenchSpace.setBenchTop`, the one
 * transform path; this file only works out the target and the in-between poses. Pure maths, tested.
 */
import type { Vec3 } from '../../contracts/common';
import type { XrSettings } from '../../contracts/settings';
import { yawOfForward, angleDiff } from './follow';

export interface BenchPose {
  readonly position: Vec3;
  readonly yawRad: number;
}

/** Eye to the bench's front edge (2.1). */
export const FRONT_EDGE_M = 0.15;
/** Eye height to the top (2.1: just above elbow height). */
export const EYE_TO_TOP_M = 0.47;
const DEPTH: Record<XrSettings['posture'], number> = { standing: 0.55, seated: 0.5 };
const HEIGHT: Record<XrSettings['posture'], readonly [number, number]> = { standing: [0.8, 1.2], seated: [0.62, 0.85] };

/**
 * The bench pose for a head at `eye` (world metres) looking along `forward` (any length; only its direction on the
 * floor plan counts). `keepYaw` is used when the person looks straight up or down.
 */
export function recentreTarget(eye: Vec3, forward: Vec3, posture: XrSettings['posture'], keepYaw = 0): BenchPose {
  const yawRad = yawOfForward(forward[0], forward[2], keepYaw);
  const ahead = FRONT_EDGE_M + DEPTH[posture] / 2;
  const [lo, hi] = HEIGHT[posture];
  const y = Math.min(hi, Math.max(lo, eye[1] - EYE_TO_TOP_M));
  return { position: [eye[0] - Math.sin(yawRad) * ahead, y, eye[2] - Math.cos(yawRad) * ahead], yawRad };
}

/** The pose `k` of the way from `a` to `b` (k is already eased): position by lerp, yaw the short way round. */
export function lerpPose(a: BenchPose, b: BenchPose, k: number): BenchPose {
  return {
    position: [a.position[0] + (b.position[0] - a.position[0]) * k, a.position[1] + (b.position[1] - a.position[1]) * k, a.position[2] + (b.position[2] - a.position[2]) * k],
    yawRad: a.yawRad + angleDiff(a.yawRad, b.yawRad) * k,
  };
}
