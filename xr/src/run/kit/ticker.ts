/**
 * One per-frame callback list per world for the run pillar: part view `tick`, tweens, billboards, live readouts.
 * `dt` is in seconds. Callbacks must not allocate. One IWSDK system per world, registered on first use.
 */
import { createSystem, type World } from '@iwsdk/core';
import type { Unsubscribe } from '../../contracts/common';

type TickFn = (dt: number, time: number) => void;

const lists = new WeakMap<World, Set<TickFn>>();

/** After the input service (-2.5), so a tick sees this frame's pointer events. */
const PRIORITY = -2;

function listOf(world: World): Set<TickFn> {
  let fns = lists.get(world);
  if (fns) return fns;
  const own = new Set<TickFn>();
  fns = own;
  lists.set(world, own);
  class RunTickSystem extends createSystem({}, {}) {
    update(delta: number, time: number): void {
      // At most a tenth of a second per frame, so a stalled tab does not jump animations.
      const dt = Math.min(0.1, Math.max(0, delta));
      for (const fn of own) {
        try {
          fn(dt, time);
        } catch (err) {
          own.delete(fn);
          console.error('[iynkware] run tick', err);
        }
      }
    }
  }
  world.registerSystem(RunTickSystem, { priority: PRIORITY });
  return own;
}

export function onTick(world: World, fn: TickFn): Unsubscribe {
  const fns = listOf(world);
  fns.add(fn);
  return () => void fns.delete(fn);
}
