/**
 * One per-frame system for learn: sub-modules add a tick instead of each registering an IWSDK system. The list is
 * rebuilt only when a tick is added or removed, so a frame allocates nothing here.
 *
 * Usage: const off = onFrame(app.world, (dt, t) => panel.face(head));
 */
import { createSystem, type World } from '@iwsdk/core';
import type { Unsubscribe } from '../../contracts/common';

/** `dt` and `t` in seconds, as IWSDK systems get them. */
export type Tick = (dt: number, t: number) => void;

const lists = new WeakMap<World, { list: Tick[] }>();

/** After the input service (-2.5), so poses read this frame are current. */
const PRIORITY = -2;

export function onFrame(world: World, fn: Tick): Unsubscribe {
  let ticker = lists.get(world);
  if (!ticker) {
    const t = { list: [] as Tick[] };
    ticker = t;
    lists.set(world, t);
    class LearnFrameSystem extends createSystem({}, {}) {
      update(delta: number, time: number): void {
        const list = t.list;
        for (let i = 0; i < list.length; i++) {
          try {
            list[i]!(delta, time);
          } catch (err) {
            console.error('[learn] frame tick threw', err);
          }
        }
      }
    }
    world.registerSystem(LearnFrameSystem, { priority: PRIORITY });
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
