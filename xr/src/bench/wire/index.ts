/**
 * Wiring by hand (design 5): a pinch or the trigger on a pin or hole starts a wire, it follows the hand (a pending
 * jumper in the look kit's ink), and releasing over the ringed cell makes it, in one undo. A pinch or trigger tap on a
 * wire opens its chip: ten colours and Remove. A pin or hole always wins over a part body (no tool mode), except a hole
 * a seated leg occupies, which is the part's.
 */
import { Quaternion, Vector3 } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe, Vec3 } from '../../contracts/common';
import type { Hand } from '../../contracts/input';
import { createCallout, type CalloutTone } from '../../look/callout';
import { onLookFrame } from '../../look/runner';
import { endLabel } from '@/studio/rules/connect';
import type { WireEndRef } from '@/studio/rules/connect';
import { addWire, recolourWire, refusalText, removeWire } from '../core/actions';
import { createTrackingLoss, type TrackingLoss } from '../core/gesture';
import { benchKit } from '../core/kit';
import { routerOf, type BenchPress } from '../core/router';
import { say } from '../core/text';
import { benchInternals, type BenchInternals } from '../space';
import { openChip, type Chip } from './chip';
import { endOfCell, refOfCell, sameCell, underSeatedBody } from './ends';
import { createWireHits } from './hits';
import { createPendingWire } from './pending';
import { WIRE_STRINGS } from './strings';

/** How long a callout (the end label, a refusal reason) stays, ms. */
export const CALLOUT_MS = 1500;

interface Pending {
  readonly press: BenchPress;
  readonly hand: Hand;
  readonly from: WireEndRef;
  readonly loss: TrackingLoss;
  /** The press ended while tracking was lost: the end stays until tracking returns or the drop. */
  ended: boolean;
  /** B or Y was held last frame (a press is an edge, whatever frame the input service raised `down` on). */
  upper: boolean;
  readonly start: Vector3;
  readonly end: Vector3;
}

const _a = new Vector3();
const _o = new Vector3();
const _d = new Vector3();
const _q = new Quaternion();

export const wireModule: FeatureModule = {
  id: 'bench/wire',
  mount(app) {
    const bi = benchInternals(app.bench);
    if (!bi) return () => undefined;
    return mountWire(app, bi);
  },
};

function mountWire(app: XrApp, bi: BenchInternals): Unsubscribe {
  const router = routerOf(app);
  const releaseRouter = router.retain();
  const feedback = benchKit(app).feedback;
  const root = app.bench.root;
  const pending = createPendingWire(root);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let cur: Pending | null = null;
  let chip: Chip | null = null;

  const worldOf = (p: Vector3): Vec3 => {
    _a.copy(p);
    root.localToWorld(_a);
    return [_a.x, _a.y, _a.z];
  };

  const callout = (text: string, at: Vector3, tone: CalloutTone, shape: 'tag' | 'card') => {
    const c = createCallout(text, { tone, distance: 0.65, shape });
    c.group.scale.setScalar(1 / app.bench.scale.value);
    c.group.position.copy(at);
    c.group.position.y += 0.004;
    root.add(c.group);
    const t = setTimeout(() => {
      timers.delete(t);
      c.dispose();
    }, CALLOUT_MS);
    timers.add(t);
  };

  const closeChip = () => {
    chip?.close();
    chip = null;
  };

  // ---- the pending wire --------------------------------------------------------------------------------------------

  const stop = () => {
    cur = null;
    pending.hide();
  };

  /** Where the free end is this frame: the ringed cell's anchor, else the pinch point (near) or the ray on the plane. */
  const aim = (p: Pending): boolean => {
    const pose = app.input.pose(p.hand);
    if (!pose) return false;
    const ring = router.ringed(p.hand);
    if (ring && !sameCell(ring, p.press.cell) && bi.anchorBoard(ring.part, ring.anchor, _o)) {
      p.end.copy(_o);
      return true;
    }
    if (p.press.near) {
      p.end.set(pose.position[0], pose.position[1], pose.position[2]);
      root.worldToLocal(p.end);
      return true;
    }
    _o.set(pose.ray.origin[0], pose.ray.origin[1], pose.ray.origin[2]);
    _d.set(pose.ray.direction[0], pose.ray.direction[1], pose.ray.direction[2]);
    root.worldToLocal(_o);
    // a direction only turns with the board frame (it is turned about +y and scaled evenly)
    root.getWorldQuaternion(_q).invert();
    _d.applyQuaternion(_q).normalize();
    if (Math.abs(_d.y) < 1e-4) return true;
    const t = (p.start.y - _o.y) / _d.y;
    if (t > 0 && t < 10) p.end.copy(_o).addScaledVector(_d, t);
    return true;
  };

  const finish = (p: Pending) => {
    const lang = app.settings.lang.value;
    const ring = router.ringed(p.hand);
    if (!ring || sameCell(ring, p.press.cell)) return stop();
    const to = refOfCell(bi.surface, ring.part, ring.anchor);
    const at = p.end.clone();
    const world = worldOf(at);
    const doc = app.project.doc;
    const r = addWire(doc, { from: p.from, to });
    if (r.ok) {
      const res = app.project.apply(r.ops, { label: r.label });
      if (res.ok) {
        feedback.play('wire', world, p.hand);
        callout(say(app, WIRE_STRINGS, 'wire.joined', { a: endLabel(doc, p.from), b: endLabel(doc, to) }), at, 'pass', 'tag');
        return stop();
      }
    }
    feedback.play('invalid', world, p.hand);
    const reason = r.ok ? null : refusalText(lang, r);
    if (reason) callout(reason, at, 'warn', 'card');
    stop();
  };

  const frame = () => {
    const p = cur;
    if (!p) return;
    const now = performance.now();
    const pose = app.input.pose(p.hand);
    if (pose) p.loss.found();
    else p.loss.lost(now, 'wire');
    if (p.loss.update(now) === 'drop') return stop();
    if (pose && p.ended) return stop();
    const upper = app.input.button(p.hand, 'upper').pressed;
    const cancel = upper && !p.upper;
    p.upper = upper;
    if (cancel) return stop();
    if (!p.ended) aim(p);
    pending.set(p.start, p.end);
  };

  const offFrame = onLookFrame(app.world, frame);

  // ---- start -------------------------------------------------------------------------------------------------------

  const offCell = router.on('cell', (press) => {
    if (cur || !press.cell || !press.hand) return null;
    const from = endOfCell(app.project.doc, bi.surface, press.cell.part, press.cell.anchor);
    // the holes between a seated part's legs are under its body: a pinch there grabs the part
    if (press.cell.part === bi.surface && underSeatedBody(app.project.doc, press.cell.anchor, (h) => (bi.anchorBoard(press.cell!.part, h, _o) ? [_o.x, _o.z] : null))) return null;
    if (!from || !bi.anchorBoard(press.cell.part, press.cell.anchor, _o)) return null;
    closeChip();
    const p: Pending = {
      press,
      hand: press.hand,
      from,
      loss: createTrackingLoss(),
      ended: false,
      upper: app.input.button(press.hand, 'upper').pressed,
      start: _o.clone(),
      end: _o.clone(),
    };
    cur = p;
    return {
      keepHover: true,
      end() {
        if (cur !== p) return;
        if (app.input.button(p.hand, 'upper').pressed) return stop();
        if (!app.input.pose(p.hand)) {
          p.ended = true;
          return;
        }
        finish(p);
      },
      cancel() {
        if (cur === p) stop();
      },
    };
  });

  // ---- the chip ----------------------------------------------------------------------------------------------------

  const offHits = createWireHits(app, root, (wire) => {
    if (cur || chip?.wire === wire) return;
    closeChip();
    const mid = app.bench.worldOf({ kind: 'wire', wire });
    if (!mid) return;
    const apply = (r: ReturnType<typeof recolourWire>) => {
      if (r.ok) app.project.apply(r.ops, { label: r.label });
      closeChip();
    };
    chip = openChip(app, wire, mid, {
      onColour: (color) => apply(recolourWire(app.project.doc, { wire, color })),
      onRemove: () => apply(removeWire(app.project.doc, { wire })),
      onClose: () => {
        chip = null;
      },
    });
  });

  return () => {
    offCell();
    offHits();
    offFrame();
    closeChip();
    pending.dispose();
    for (const t of timers) clearTimeout(t);
    timers.clear();
    releaseRouter();
  };
}
