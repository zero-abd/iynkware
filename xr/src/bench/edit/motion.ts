/**
 * How the bench's items arrive, move and leave (design 4, look kit motion): adds drop in, moves glide (a seat travels in
 * 90 ms, a slide to the mat in 200, a return in 300), removes shrink away, and reduced motion jumps. Installed through
 * `benchInternals(app.bench).setTransition`; the hook always calls `done()`. A held item is the hand's, so a layout
 * change under it ends at once and the carry keeps writing the pose.
 */
import { Quaternion, Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import { DURATION, easeIynk, type Ease } from '../../look/motion';
import { motionOf } from '../../look/runner';
import { benchInternals, type BenchPose, type Transition } from '../space';

/** The default glide of a move, milliseconds. */
export const GLIDE_MS = 300;
/** Where a dropped part starts above the mat, board frame metres (real size). */
export const DROP_HEIGHT = 0.012;
export const REMOVE_MS = 200;
const STAGGER_MS = 60;

const fall: Ease = (t) => t * t;

export interface Transitions {
  /** The next move of this item takes `ms` (a seat, a slide, a return), with `ease` (a fall). Used once. */
  hint(id: string, ms: number, ease?: Ease): void;
  /** Marks an item as held: layout changes under it end at once. */
  hold(id: string, held: boolean): void;
  dispose(): void;
}

export function installTransitions(app: XrApp): Transitions {
  const bi = benchInternals(app.bench);
  const hints = new Map<string, { ms: number; ease?: Ease }>();
  const held = new Set<string>();
  let adds = 0;
  const motion = motionOf(app.world);
  const _p = new Vector3();
  const _q = new Quaternion();

  const hook: Transition = (item, from, to, kind, done) => {
    const o = item.object;
    motion.cancel(o);
    if (held.has(item.id) || motion.reducedMotion) {
      hints.delete(item.id);
      return done();
    }
    if (kind === 'add' && to === null) return done();
    if (kind === 'add') {
      const delay = Math.min(adds++ * STAGGER_MS, 300);
      queueMicrotask(() => (adds = 0));
      const y = item.target.position.y;
      o.position.y = y + DROP_HEIGHT;
      motion.tween({ key: o, ms: DURATION.dropIn * 0.6, delay, ease: fall, onUpdate: (k) => (o.position.y = y + DROP_HEIGHT * (1 - k)), onDone: done });
      return;
    }
    if (kind === 'remove') {
      const s0 = o.scale.x;
      motion.tween({ key: o, ms: REMOVE_MS, onUpdate: (k) => o.scale.setScalar(Math.max(1e-3, s0 * (1 - k))), onDone: done });
      return;
    }
    // move: from where the object is to the target
    const hinted = hints.get(item.id);
    const ms = hinted?.ms ?? GLIDE_MS;
    const ease = hinted?.ease ?? easeIynk;
    hints.delete(item.id);
    if (!from || !to) return done();
    const a: BenchPose = { position: from.position.clone(), quaternion: from.quaternion.clone() };
    const b: BenchPose = { position: to.position.clone(), quaternion: to.quaternion.clone() };
    motion.tween({
      key: o,
      ms,
      ease,
      onUpdate: (k) => {
        o.position.copy(_p.copy(a.position).lerp(b.position, k));
        o.quaternion.copy(_q.copy(a.quaternion).slerp(b.quaternion, k));
      },
      onDone: done,
    });
  };

  bi?.setTransition(hook);
  return {
    hint: (id, ms, ease) => void hints.set(id, { ms, ease }),
    hold(id, on) {
      if (on) held.add(id);
      else held.delete(id);
    },
    dispose() {
      bi?.setTransition(null);
      hints.clear();
      held.clear();
    },
  };
}
