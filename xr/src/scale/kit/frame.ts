/**
 * One per-frame system for the whole pillar: sub-modules register a tick instead of each adding an IWSDK system.
 * The list is an array rebuilt only when a tick is added or removed, so a frame allocates nothing here.
 */
import { createSystem, type World } from '@iwsdk/core';
import type { Unsubscribe } from '../../contracts/common';

/** `dt` and `t` in seconds, as IWSDK systems get them. */
export type Tick = (dt: number, t: number) => void;

interface Ticker {
  list: Tick[];
}

const tickers = new WeakMap<World, Ticker>();

/** After the input service (-2.5) and before the default systems, so poses read this frame are current. */
const PRIORITY = -2;

export function onFrame(world: World, fn: Tick): Unsubscribe {
  let ticker = tickers.get(world);
  if (!ticker) {
    const t: Ticker = { list: [] };
    ticker = t;
    tickers.set(world, t);
    class ScaleFrameSystem extends createSystem({}, {}) {
      update(delta: number, time: number): void {
        const list = t.list;
        for (let i = 0; i < list.length; i++) {
          try {
            list[i]!(delta, time);
          } catch (err) {
            console.error('[scale] frame tick threw', err);
          }
        }
      }
    }
    world.registerSystem(ScaleFrameSystem, { priority: PRIORITY });
  }
  const t = ticker;
  t.list = [...t.list, fn];
  let done = false;
  return () => {
    if (done) return;
    done = true;
    t.list = t.list.filter((f) => f !== fn);
  };
}

/** Eases 0..1 in and out (smoothstep). */
export const ease = (x: number): number => {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return c * c * (3 - 2 * c);
};
