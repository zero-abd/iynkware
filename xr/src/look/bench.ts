/**
 * The bench in the figures' look, mounted by the look module: the inked work mat and front rail under everything (sized
 * by posture, rebuilt when it changes), inked wires, and the bench's motion. Parts arrive by dropping onto the mat and
 * settling with one small squash, move by easing to their new place, and leave by lifting and shrinking away; on the
 * bench's arrival every item drops in turn and then the wires draw themselves on. Reduced motion jumps (the runner's
 * 150 ms cap). Draws and moves only: what the bench lays out, and where, is the bench's (bench/space.ts).
 *
 * The wire renderer and the transition hook go through the bench internals. A bench module that installs its own later
 * replaces these (it mounts after the look module); the running moves end where the bench puts things anyway.
 */
import { Quaternion, Vector3, type Object3D, type World } from '@iwsdk/core';
import { benchGeometry } from '../bench/core/geometry';
import { benchInternals, type BenchItem, type BenchPose, type Transition } from '../bench/space';
import type { Unsubscribe } from '../contracts/common';
import type { XrApp } from '../contracts/app';
import { inkKit, loadInk } from './ink';
import { createWorkMat, type WorkMat } from './mat';
import { DURATION, easeIynk } from './motion';
import { motionOf } from './runner';
import { inkWires } from './wires';

/** How far a part falls on arrival, metres on the bench (it is divided by the board scale in the board frame). */
const DROP = 0.05;
/** The stagger between items on the bench's arrival (the site's stagger-in). */
const STAGGER = 70;

const fall = (t: number) => t * t;

/**
 * The bench's transition hook: add drops in, move eases, remove lifts and shrinks. Keyed per object, so a newer move of
 * the same item replaces the running one.
 */
export function benchMoves(world: World, scaleOf: () => number): Transition & { arrive(item: BenchItem, delay: number): void } {
  const keys = new WeakMap<Object3D, object>();
  const keyOf = (o: Object3D) => {
    let k = keys.get(o);
    if (!k) keys.set(o, (k = {}));
    return k;
  };
  const m = motionOf(world);

  /** Falls onto `to` from `h` above it, squashes and settles; then `done`. */
  const drop = (o: Object3D, to: BenchPose, delay: number, done: () => void) => {
    const h = DROP / Math.max(0.25, scaleOf());
    const k = keyOf(o);
    o.position.copy(to.position);
    o.quaternion.copy(to.quaternion);
    o.position.y = to.position.y + h;
    m.tween({
      key: k,
      ms: DURATION.dropIn * 0.6,
      delay,
      ease: fall,
      onUpdate: (t) => {
        o.position.y = to.position.y + h * (1 - t);
      },
      onDone: () => {
        if (m.reducedMotion) return done();
        m.spring({
          key: k,
          from: 0.94,
          to: 1,
          velocity: -1.2,
          preset: 'wobble',
          onUpdate: (s) => {
            const spread = 1 + (1 - s) * 0.4;
            o.scale.set(spread, s, spread);
          },
          onDone: () => {
            o.scale.set(1, 1, 1);
            done();
          },
        });
      },
    });
  };

  const hook = ((item, from, to, kind, done) => {
    const o = item.object;
    if (kind === 'add' && to) return drop(o, to, 0, done);
    if (kind === 'move' && to) {
      const p0 = (from ?? to).position.clone();
      const q0 = (from ?? to).quaternion.clone();
      const q = new Quaternion();
      const p = new Vector3();
      m.tween({
        key: keyOf(o),
        ms: DURATION.fade,
        ease: easeIynk,
        onUpdate: (t) => {
          o.position.copy(p.lerpVectors(p0, to.position, t));
          o.quaternion.copy(q.slerpQuaternions(q0, to.quaternion, t));
          o.scale.set(1, 1, 1);
        },
        onDone: done,
      });
      return;
    }
    // remove: up a little and away.
    const y0 = o.position.y;
    const lift = 0.02 / Math.max(0.25, scaleOf());
    m.tween({
      key: keyOf(o),
      ms: DURATION.release,
      ease: easeIynk,
      onUpdate: (t) => {
        o.position.y = y0 + lift * t;
        o.scale.setScalar(1 - 0.6 * t);
      },
      onDone: done,
    });
  }) as Transition & { arrive(item: BenchItem, delay: number): void };

  /** An item already on the bench arriving again (the bench's arrival): it drops in after `delay`. */
  hook.arrive = (item, delay) => {
    const target = item.target;
    drop(item.object, target, delay, () => {
      item.object.position.copy(target.position);
      item.object.quaternion.copy(target.quaternion);
      item.object.scale.set(1, 1, 1);
    });
  };
  return hook;
}

const ORDER: Record<BenchItem['role'], number> = { surface: 0, board: 1, part: 2 };

/** Mounts the bench look; resolves its cleanup (nothing to clean when the ink material is not in the tree). */
export function mountBenchLook(app: XrApp): Unsubscribe {
  let disposed = false;
  const offs: Unsubscribe[] = [];
  void (async () => {
    const ink = await loadInk();
    if (!ink || disposed) return;
    const bench = app.bench;
    const internals = benchInternals(bench);
    const tableKit = inkKit(ink, bench.table);
    const boardKit = inkKit(ink, bench.root);
    const renderer = app.world.renderer as { capabilities?: { getMaxAnisotropy?(): number } } | undefined;
    const anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);

    // The mat, sized by the posture's bench top.
    let mat: WorkMat | undefined;
    let size = '';
    const place = () => {
      const xr = app.settings.xr.value;
      const top = benchGeometry(xr.posture, xr.dominantHand).top;
      const key = `${top.w}x${top.d}`;
      if (key === size) return;
      size = key;
      mat?.dispose();
      mat = createWorkMat(tableKit, top, { anisotropy });
      bench.table.add(mat.group);
    };
    place();
    offs.push(app.settings.xr.subscribe(place));
    const relight = () => {
      tableKit.relight();
      boardKit.relight();
    };
    offs.push(bench.benchTop.subscribe(relight));
    offs.push(() => mat?.dispose());
    if (!internals) return;

    // The bench's arrival: items drop in turn (surface, boards, parts), then the wires draw on.
    const moves = benchMoves(app.world, () => bench.scale.value || 1);
    const items = [...internals.items.values()].sort((a, b) => ORDER[a.role] - ORDER[b.role]);
    items.forEach((item, i) => moves.arrive(item, i * STAGGER));
    const landed = items.length * STAGGER + DURATION.dropIn;
    internals.setWireRenderer(inkWires(app.world, bench.root, boardKit, { introDelay: landed }));
    internals.setTransition(moves);
    offs.push(() => {
      internals.setTransition(null);
      internals.setWireRenderer(null);
    });
  })();
  return () => {
    disposed = true;
    for (const off of offs.splice(0)) off();
  };
}
