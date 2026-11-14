/**
 * One motion runner per world, ticked by one IWSDK system, and the per-frame hook every look piece shares (halos,
 * effects, outlines that follow the viewport). Pillars use it instead of adding their own system for a fade.
 *
 *   import { motionOf, onLookFrame } from '../look/runner';
 *   motionOf(app.world).tween({ ms: 300, onUpdate: (k) => setOpacity(mat, k) });
 *   const off = onLookFrame(app.world, (dt, t) => halo.update(dt));
 */
import { createSystem, type World } from '@iwsdk/core';
import type { Unsubscribe } from '../contracts/common';
import { createMotion, type MotionRunner } from './motion';

export type LookTick = (dt: number, t: number) => void;

interface PerWorld {
  motion: MotionRunner;
  ticks: LookTick[];
}

const worlds = new WeakMap<World, PerWorld>();

/** After the input service (-2.5) and the pillars' own frame systems (-2), so poses read this frame are current. */
const PRIORITY = -1;

function of(world: World): PerWorld {
  let w = worlds.get(world);
  if (w) return w;
  const state: PerWorld = { motion: createMotion({ reducedMotion: prefersReducedMotion() }), ticks: [] };
  w = state;
  worlds.set(world, state);
  class LookFrameSystem extends createSystem({}, {}) {
    update(delta: number, time: number): void {
      state.motion.tick(delta);
      const list = state.ticks;
      for (let i = 0; i < list.length; i++) {
        try {
          list[i]!(delta, time);
        } catch (err) {
          console.error('[look] frame tick threw', err);
        }
      }
    }
  }
  world.registerSystem(LookFrameSystem, { priority: PRIORITY });
  return state;
}

/** The world's motion runner. `reducedMotion` on it follows the setting (the look module keeps it in step). */
export const motionOf = (world: World): MotionRunner => of(world).motion;

/** Runs `fn` every frame after the motion runner; returns its removal. Allocates nothing per frame. */
export function onLookFrame(world: World, fn: LookTick): Unsubscribe {
  const w = of(world);
  w.ticks = [...w.ticks, fn];
  let done = false;
  return () => {
    if (done) return;
    done = true;
    w.ticks = w.ticks.filter((f) => f !== fn);
  };
}

/** The browser's own reduced-motion preference (the start value until the setting says otherwise). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
