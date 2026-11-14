/**
 * Where a hand holds a thing, in the board frame, every frame: a near grab holds the pinch or grip point, a far grab the
 * point on the ray at the distance it was grabbed from. Reuses its vectors; nothing is allocated after the first call.
 */
import { Quaternion, Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Vec3 } from '../../contracts/common';
import type { Hand } from '../../contracts/input';

export interface HoldPoint {
  /** The point at the start of the grab, board frame. */
  readonly start: Vector3;
  /** Distance along the ray (board frame metres) of a far grab; 0 for a near one. */
  readonly distance: number;
  /** The point now written into `out`, or null when the hand is untracked. */
  now(out: Vector3): Vector3 | null;
}

export function holdPointOf(app: XrApp, hand: Hand, near: boolean, hit?: Vec3 | undefined): HoldPoint | null {
  const root = app.bench.root;
  const q = new Quaternion();
  const o = new Vector3();
  const d = new Vector3();
  const start = new Vector3();
  let distance = 0;
  const pose0 = app.input.pose(hand);
  if (!pose0) return null;
  if (!near) {
    o.set(pose0.ray.origin[0], pose0.ray.origin[1], pose0.ray.origin[2]);
    root.worldToLocal(o);
    if (hit) start.set(hit[0], hit[1], hit[2]);
    else start.set(pose0.position[0], pose0.position[1], pose0.position[2]);
    root.worldToLocal(start);
    distance = Math.max(0.01, start.distanceTo(o));
  } else {
    start.set(pose0.position[0], pose0.position[1], pose0.position[2]);
    root.worldToLocal(start);
  }
  return {
    start,
    distance,
    now(out) {
      const pose = app.input.pose(hand);
      if (!pose) return null;
      if (near) {
        out.set(pose.position[0], pose.position[1], pose.position[2]);
        return root.worldToLocal(out);
      }
      o.set(pose.ray.origin[0], pose.ray.origin[1], pose.ray.origin[2]);
      root.worldToLocal(o);
      root.getWorldQuaternion(q).invert();
      d.set(pose.ray.direction[0], pose.ray.direction[1], pose.ray.direction[2]).applyQuaternion(q).normalize();
      return out.copy(o).addScaledVector(d, distance);
    },
  };
}
