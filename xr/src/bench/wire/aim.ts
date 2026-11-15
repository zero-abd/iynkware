/**
 * Where the free end of a wire being drawn is this frame (shared by a new wire and a lifted wire end): the ringed
 * cell's anchor, else the pinch point (near) or the ray's hit on the plane of the start height. Allocation-free.
 */
import { Quaternion, Vector3, type Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Hand } from '../../contracts/input';
import type { BenchRouter } from '../core/router';
import type { BenchInternals } from '../space';
import { sameCell } from './ends';

const _o = new Vector3();
const _d = new Vector3();
const _q = new Quaternion();

/**
 * Writes the free end (board frame) into `end`. `skip` is a cell the ring may not snap to (the wire's own start). False
 * when the hand has no pose.
 */
export function aimFreeEnd(
  app: XrApp,
  bi: BenchInternals,
  router: BenchRouter,
  root: Object3D,
  hand: Hand,
  near: boolean,
  skip: { part: string; anchor: string } | null,
  startY: number,
  end: Vector3,
): boolean {
  const pose = app.input.pose(hand);
  if (!pose) return false;
  const ring = router.ringed(hand);
  if (ring && !sameCell(ring, skip) && bi.anchorBoard(ring.part, ring.anchor, _o)) {
    end.copy(_o);
    return true;
  }
  if (near) {
    end.set(pose.position[0], pose.position[1], pose.position[2]);
    root.worldToLocal(end);
    return true;
  }
  _o.set(pose.ray.origin[0], pose.ray.origin[1], pose.ray.origin[2]);
  _d.set(pose.ray.direction[0], pose.ray.direction[1], pose.ray.direction[2]);
  root.worldToLocal(_o);
  // a direction only turns with the board frame (it is turned about +y and scaled evenly)
  root.getWorldQuaternion(_q).invert();
  _d.applyQuaternion(_q).normalize();
  if (Math.abs(_d.y) < 1e-4) return true;
  const t = (startY - _o.y) / _d.y;
  if (t > 0 && t < 10) end.copy(_o).addScaledVector(_d, t);
  return true;
}
