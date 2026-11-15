/**
 * `placeInRing`: stands a scene-level panel in its slot of the bench's panel ring (`bench/core/ring.ts`), turned to
 * the eyes, as `placeAhead` does for a panel opened in front of the head. Panels parented to the table set
 * `ringSpot(...).position` on themselves instead.
 */
import { Vector3, type Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import { ringSpot, type RingSlot } from '../../bench/core/ring';

const at = new Vector3();
const eye = new Vector3();

/** `belowDeg` overrides the slot's own angle under the eyes (a panel that must sit lower than the slot's usual one). */
export function placeInRing(app: XrApp, object: Object3D, slot: RingSlot, belowDeg?: number): void {
  const xr = app.settings.xr.value;
  const p = ringSpot(slot, xr.posture, xr.dominantHand, belowDeg).position;
  app.bench.table.updateMatrixWorld(true);
  app.bench.table.localToWorld(at.set(p[0], p[1], p[2]));
  object.position.copy(at);
  const cam = app.world.camera;
  cam.updateMatrixWorld(true);
  cam.getWorldPosition(eye);
  object.lookAt(eye);
  delete object.userData.lookRest;
}
