/** Realises the work scale on the bench: eases `bench.setScale` to the step, except where the head is in the way. */
import { Box3, Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Vec3 } from '../../contracts/common';
import { easeIynk } from '../../look/motion';
import type { Motion } from '../../look/motion';
import { motionOf } from '../../look/runner';

export const EASE_MS = 250;
export const COMFORT_MARGIN = 0.1;
export const COMFORT_HEIGHT = 0.3;

export interface Footprint {
  /** Board-frame bounds at scale 1: x and z extents, and the top. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
}

/**
 * True when the head is inside the item or its growth path (design 8.2): the board's footprint at the larger of the two
 * scales, 0.1 m wider on every side, and up to 0.3 m above its top. `origin` is the bench top centre in the world.
 */
export function headInGrowth(head: Vec3, fp: Footprint, origin: Vec3, from: number, to: number): boolean {
  const s = Math.max(from, to);
  const m = COMFORT_MARGIN;
  return (
    head[0] >= origin[0] + fp.minX * s - m &&
    head[0] <= origin[0] + fp.maxX * s + m &&
    head[2] >= origin[2] + fp.minZ * s - m &&
    head[2] <= origin[2] + fp.maxZ * s + m &&
    head[1] <= origin[1] + fp.maxY * s + COMFORT_HEIGHT
  );
}

export interface Realiser {
  /** Gets the bench to `target`: eases, or sets at once when the head is in the way. */
  realise(target: number): void;
  dispose(): void;
}

const KEY = 'scale/zoom';

export function mountApply(app: XrApp): Realiser {
  const motion = motionOf(app.world);
  const box = new Box3();
  const origin = new Vector3();
  const head = new Vector3();
  const fp: Footprint = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, maxY: 0 };
  let goal = -1;
  let running: Motion | null = null;

  const comfortable = (from: number, to: number): boolean => {
    const root = app.bench.root;
    root.updateWorldMatrix(true, true);
    box.setFromObject(root);
    if (box.isEmpty() || from <= 0) return true;
    root.getWorldPosition(origin);
    // The board's bounds back at scale 1 (the root only scales, it does not rotate).
    fp.minX = (box.min.x - origin.x) / from;
    fp.maxX = (box.max.x - origin.x) / from;
    fp.minZ = (box.min.z - origin.z) / from;
    fp.maxZ = (box.max.z - origin.z) / from;
    fp.maxY = (box.max.y - origin.y) / from;
    app.world.camera.getWorldPosition(head);
    return !headInGrowth([head.x, head.y, head.z], fp, [origin.x, origin.y, origin.z], from, to);
  };

  const realise = (target: number): void => {
    const from = app.bench.scale.value;
    if (target === goal && running && !running.done) return;
    goal = target;
    running?.cancel();
    running = null;
    if (from === target) return;
    if (!comfortable(from, target)) {
      app.bench.setScale(target);
      return;
    }
    running = motion.tween({
      key: KEY,
      ms: EASE_MS,
      ease: easeIynk,
      onUpdate: (k) => app.bench.setScale(from + (target - from) * k),
      onDone: () => app.bench.setScale(target),
    });
  };

  goal = app.scale.workScale.value;
  app.bench.setScale(goal);
  const off = app.scale.workScale.subscribe(realise);
  return {
    realise,
    dispose() {
      off();
      running?.cancel();
    },
  };
}
