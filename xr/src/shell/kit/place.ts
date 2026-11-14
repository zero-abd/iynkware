/**
 * Where a shell panel goes when it opens: `distance` metres ahead of the head along its yaw (never its roll or pitch),
 * `belowDeg` under eye level, `sideDeg` towards the right (negative: left), then world-locked. Pure math, so it is
 * tested; `placeAhead` applies it to an object from the camera. XR_DESIGN.md 9.1 (Home 1.30 m, 8 degrees below; the
 * menu 1.00 m, 10 below; touch range 0.45 m).
 */
import { Vector3, type Object3D, type World } from '@iwsdk/core';
import type { Vec3 } from '../../contracts/common';

export interface Placement {
  readonly position: Vec3;
  /** The point the panel's front (+z) turns to: the eye. */
  readonly faceTo: Vec3;
}

export function placementFrom(eye: Vec3, forward: Vec3, o: { distance: number; belowDeg?: number; sideDeg?: number }): Placement {
  let fx = forward[0];
  let fz = forward[2];
  const len = Math.hypot(fx, fz);
  if (len < 1e-6) {
    fx = 0;
    fz = -1;
  } else {
    fx /= len;
    fz /= len;
  }
  const side = ((o.sideDeg ?? 0) * Math.PI) / 180;
  // Turn the heading by `side` towards the right (+x when looking down -z).
  const c = Math.cos(side);
  const s = Math.sin(side);
  const hx = fx * c - fz * s;
  const hz = fx * s + fz * c;
  const below = ((o.belowDeg ?? 0) * Math.PI) / 180;
  const flat = o.distance * Math.cos(below);
  return {
    position: [eye[0] + hx * flat, eye[1] - o.distance * Math.sin(below), eye[2] + hz * flat],
    faceTo: eye,
  };
}

const eye = new Vector3();
const dir = new Vector3();

/** Places `object` (in world space: its parent must be the scene) ahead of the viewer and turns it to face them. */
export function placeAhead(world: World, object: Object3D, o: { distance: number; belowDeg?: number; sideDeg?: number }): void {
  const cam = world.camera;
  cam.updateMatrixWorld(true);
  cam.getWorldPosition(eye);
  cam.getWorldDirection(dir);
  const p = placementFrom([eye.x, eye.y, eye.z], [dir.x, dir.y, dir.z], o);
  object.position.set(p.position[0], p.position[1], p.position[2]);
  object.lookAt(eye);
  delete object.userData.lookRest;
}
