/**
 * The stage: how the bench is framed before anyone enters the headset. The flat page shows the bench the way an iynk
 * figure shows its object: from the front left and above, through a long lens (near isometric), filling the plate with
 * a margin, on the page's paper. In a session the person's own head is the camera and nothing here moves it.
 *
 *   const off = mountStage(app);    // the look module does this; it follows the bench pose and the window size
 */
import { PerspectiveCamera } from '@iwsdk/core';
import type { XrApp } from '../contracts/app';
import type { Unsubscribe } from '../contracts/common';

/** The flat camera: a long lens from the front left and above, like the figures' default view. */
export const FLAT_VIEW = {
  /** Vertical field of view, degrees: long enough to read as a figure, short enough to keep depth. */
  fov: 30,
  /** Turned this far to the person's left of straight on, degrees (the figures look from the front left). */
  yawDeg: -22,
  /** Looking down by this much, degrees. */
  elevationDeg: 38,
  /** The width the frame must hold, metres (the bench with its shelf and rail), and a margin around it. */
  width: 1.3,
  margin: 1.15,
  /** Aim this far behind the bench top centre, metres, so the rail and the board share the middle of the frame. */
  aimBack: 0.04,
} as const;

/** The camera distance that fits `width` metres across a frame of `aspect` with a vertical fov of `fovDeg`. */
export function fitDistance(width: number, aspect: number, fovDeg: number, margin = 1): number {
  const v = (fovDeg * Math.PI) / 360;
  const h = Math.atan(Math.tan(v) * Math.max(aspect, 0.2));
  return ((width / 2) * margin) / Math.tan(h);
}

export function mountStage(app: XrApp): Unsubscribe {
  const cam = app.world.camera as PerspectiveCamera;
  const frame = () => {
    if (app.mode.value !== 'flat' || !(cam instanceof PerspectiveCamera)) return;
    const { position, yawRad } = app.bench.benchTop.value;
    const aspect = cam.aspect || (typeof innerWidth === 'number' ? innerWidth / Math.max(1, innerHeight) : 1.6);
    // a portrait phone holds the bench's depth too, not only its width
    const dist = Math.max(fitDistance(FLAT_VIEW.width, aspect, FLAT_VIEW.fov, FLAT_VIEW.margin), 1.35);
    const yaw = yawRad + (FLAT_VIEW.yawDeg * Math.PI) / 180;
    const el = (FLAT_VIEW.elevationDeg * Math.PI) / 180;
    const tx = position[0] - Math.sin(yawRad) * FLAT_VIEW.aimBack;
    const tz = position[2] - Math.cos(yawRad) * FLAT_VIEW.aimBack;
    cam.fov = FLAT_VIEW.fov;
    cam.position.set(tx + Math.sin(yaw) * Math.cos(el) * dist, position[1] + Math.sin(el) * dist, tz + Math.cos(yaw) * Math.cos(el) * dist);
    cam.lookAt(tx, position[1], tz);
    cam.updateProjectionMatrix();
  };
  frame();
  const offMode = app.mode.subscribe(frame);
  const offPose = app.bench.benchTop.subscribe(frame);
  // the renderer updates the aspect on resize; frame after it
  const onResize = () => requestAnimationFrame(frame);
  addEventListener('resize', onResize);
  return () => {
    offMode();
    offPose();
    removeEventListener('resize', onResize);
  };
}
