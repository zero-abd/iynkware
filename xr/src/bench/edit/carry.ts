/**
 * Carrying a part (design 3.2, 3.4, 3.5): grab it and it follows the hand 1:1, level and yawed by the wrist; over the
 * breadboard the fit's ghost shows where it would seat (`core/fit.ts`, drawn by `ghost.ts`); releasing seats it at the
 * ghost, lays it on the mat beside the board with the reason, lays it where it was dropped, or sends it back.
 *
 * The same holder carries a part that is already on the bench (a seated one has to be lifted one pitch before it leaves
 * its holes, and a tether shows until then) and a new one handed over by the shelf (`benchKit(app).carry`). Nothing in
 * the document changes while a part is held: the whole carry ends in one `app.project.apply` (one undo) or in none.
 * Per-frame work reuses its vectors and allocates nothing; the document is touched only through `core/actions.ts`.
 */
import { Object3D, Vector3, Euler, Matrix4 } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { PartAsset } from '../../contracts/assets';
import type { Hand, PointerSource } from '../../contracts/input';
import type { Vec3 } from '../../contracts/common';
import { createCallout } from '../../look/callout';
import { easeIynk, DURATION } from '../../look/motion';
import { motionOf, onLookFrame } from '../../look/runner';
import { movePart, partOrigin, placePart, seatPart, type ActionRefusal, type ActionResult } from '../core/actions';
import { fallEase, fallMs, restBelow } from '../core/rest';
import { createGhostFit, type GhostFit } from '../core/fit';
import { benchKit } from '../core/kit';
import { createFlick, createPullTracker, createTrackingLoss, createYawStepper, PART_YAW } from '../core/gesture';
import { benchGeometry } from '../core/geometry';
import type { BenchRouter } from '../core/router';
import { benchInternals, type BenchItem } from '../space';
import { binUnder, removeOnBin, showRefusal } from './bin';
import { createGhostView, type GhostView } from './ghost';
import { holdPointOf } from './hand';
import type { Transitions } from './motion';
import {
  decideRelease,
  freeSpot,
  headingDeg,
  matOf,
  onMatRect,
  progress,
  refusalOfProblem,
  rotationOfYaw,
  turned,
  yawOfRotation,
  type RectMm,
  type Release,
  type Rotation,
} from './place';
import { reasonText } from './strings';
import { createTether, type Tether } from './tether';

/** The pull from the holes, as the legs rise: how long the part takes to come to the hand once it is pulled. */
export const PULL_MS = 80;
/** A far grab flies to the ray's end (design 3.2). */
export const FLY_MS = 250;
/** Snap ticks come at most 12 a second (design 4). */
export const SNAP_MIN_MS = 1000 / 12;
/** How long the reason of an invalid release shows. */
export const REASON_MS = 1500;
/** Slide to the free spot beside a board, and back to where it came from. */
export const SLIDE_MS = 200;
/**
 * A pinch is not settled when it starts: the fingers are still closing, so the point it holds moves by centimetres. For this
 * long after a near grab the hold point and the offset to the part are taken again every frame, and the part waits.
 */
export const ARM_MS = 120;
export const RETURN_MS = 300;

const Y = new Vector3(0, 1, 0);
const _e = new Euler();
const _hold = new Vector3();
const _o = new Vector3();
const _d = new Vector3();
const _pos = new Vector3();
const _off = new Vector3();
const _tip = new Vector3();
const _top = new Vector3();
const _top2 = new Vector3();
const _w = new Vector3();
const _M = new Matrix4();
const _tq = new Vector3();

/** Everything a holder needs to know about what it holds. */
export interface Held {
  /** The part's id when it is on the bench; null for a new part from the shelf. */
  readonly id: string | null;
  readonly ref: string;
  readonly asset: PartAsset;
  /** What is shown in the hand: the item's own object, or a fresh instance for a new part. */
  readonly object: Object3D;
  /** On the bench and seated in holes (a lift has to pull it out). */
  readonly seated: boolean;
}

export interface HoldStart {
  readonly hand: Hand;
  readonly near: boolean;
  readonly source: PointerSource;
  /** World hit of a far press. */
  readonly hit?: Vec3 | undefined;
  /** A new part starts where the bin item was (world), and the hand takes it from there. */
  readonly from?: Vec3 | undefined;
}

export interface Holder {
  /** Once a frame while the hand is tracked or lost. Returns false when the carry is over. */
  frame(dtMs: number, tMs: number): boolean;
  end(): void;
  cancel(): void;
  readonly done: boolean;
}

interface Deps {
  app: XrApp;
  transitions: Transitions;
  router: BenchRouter;
  /** A new part's carry ended without placing it. */
  onReturn?: () => void;
}

function yawOf(o: Object3D): number {
  return _e.setFromQuaternion(o.quaternion, 'YXZ').y;
}

/** The parts of `asset` the carry needs: the anchor leg, the lowest leg tip, a point on top of the part. */
function legInfo(asset: PartAsset, anchorPin: string) {
  const a = asset.anchors.get(anchorPin);
  let lowest = Infinity;
  for (const an of asset.sidecar.anchors) if (an.kind === 'pin' && an.layer !== 'xray') lowest = Math.min(lowest, an.position[1]);
  const { min, max } = asset.sidecar.bounds;
  return {
    anchor: a ? ([a.position[0], a.position[1], a.position[2]] as const) : ([0, 0, 0] as const),
    lowest: Number.isFinite(lowest) ? lowest : min[1],
    top: [(min[0] + max[0]) / 2, max[1], (min[2] + max[2]) / 2] as const,
  };
}

/** Bounds of an asset turned by `yaw`, as a rectangle in millimetres relative to its layout corner. */
export function rectRelativeToCorner(asset: Pick<PartAsset, 'sidecar' | 'footprint'>, yaw: number): RectMm {
  const { min, max } = asset.sidecar.bounds;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // a vector turned about +y by yaw: (x, z) -> (x c + z s, -x s + z c)
  const rot = (x: number, z: number) => [x * c + z * s, -x * s + z * c] as const;
  const [cx, cz] = rot(asset.footprint.x, asset.footprint.z);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const x of [min[0], max[0]]) {
    for (const z of [min[2], max[2]]) {
      const [rx, rz] = rot(x, z);
      minX = Math.min(minX, rx - cx);
      maxX = Math.max(maxX, rx - cx);
      minY = Math.min(minY, rz - cz);
      maxY = Math.max(maxY, rz - cz);
    }
  }
  return { minX: minX * 1000, maxX: maxX * 1000, minY: minY * 1000, maxY: maxY * 1000 };
}

/** The rectangle an item covers, document millimetres (its bounds at its target pose). */
function rectOfItem(item: BenchItem): RectMm {
  const { min, max } = item.asset.sidecar.bounds;
  const yaw = yawOf({ quaternion: item.target.quaternion } as Object3D);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const x of [min[0], max[0]]) {
    for (const z of [min[2], max[2]]) {
      const rx = x * c + z * s + item.target.position.x;
      const rz = -x * s + z * c + item.target.position.z;
      minX = Math.min(minX, rx);
      maxX = Math.max(maxX, rx);
      minY = Math.min(minY, rz);
      maxY = Math.max(maxY, rz);
    }
  }
  return { minX: minX * 1000, maxX: maxX * 1000, minY: minY * 1000, maxY: maxY * 1000 };
}

export function createHolder(deps: Deps, held: Held, start: HoldStart): Holder | null {
  const { app, transitions, router } = deps;
  const bi = benchInternals(app.bench);
  if (!bi) return null;
  const root = app.bench.root;
  const kit = benchKit(app);
  const { hand, near } = start;
  const object = held.object;
  const world = app.world;

  // ---- the start ---------------------------------------------------------------------------------------------------
  const point = holdPointOf(app, hand, near, start.hit);
  if (!point) return null;
  const hold0 = point.start.clone();
  const holdNow = (out: Vector3): Vector3 | null => point.now(out);
  motionOf(world).cancel(object);
  if (held.id !== null) transitions.hold(held.id, true);
  const yaw0 = yawOf(object);
  const rotation0: Rotation = rotationOfYaw(yaw0);
  const seatPos = object.position.clone();
  const off = new Vector3();
  if (held.id === null && start.from) {
    // a new part starts at its bin and comes to the hand
    const f = new Vector3(start.from[0], start.from[1], start.from[2]);
    root.worldToLocal(f);
    object.position.copy(f);
  }
  off.copy(object.position).sub(hold0);

  // ---- state -------------------------------------------------------------------------------------------------------
  const s0 = app.bench.scale.value;
  const surfaceId = bi.surface;
  const topY = surfaceId ? router.cellsOf(surfaceId)?.planeY : undefined;
  const doc0 = app.project.doc;
  const ghost: GhostFit | null =
    surfaceId && topY !== undefined && surfaceId !== held.id
      ? createGhostFit(doc0, held.id !== null ? { part: held.id, rotation: rotation0 } : { ref: held.ref, rotation: rotation0 }, { topY })
      : null;
  const view: GhostView | null = ghost && surfaceId ? createGhostView(root, held.asset, bi, surfaceId, () => app.bench.scale.value) : null;
  const legs = ghost ? legInfo(held.asset, ghost.anchorPin) : legInfo(held.asset, '');
  const tetherSeat: Tether = createTether(root);
  const tetherGhost: Tether = createTether(root);
  const pull = createPullTracker();
  const stepper = createYawStepper(PART_YAW);
  const flick = createFlick();
  const loss = createTrackingLoss();
  let pulled = !held.seated;
  let pulledAt = pulled ? 0 : -1;
  let startedAt = -1;
  let wristSteps = 0;
  let flickSteps = 0;
  let headingSeen = false;
  let lastSnap = -1e9;
  let lastDoc = doc0;
  let ending: 'none' | 'lost' = 'none';
  let isDone = false;
  let nowMs = 0;
  /** The bin lit as taking this part (-1: none); only a part of the bench is taken, a new one just goes back. */
  let lit = false;
  let litBin = -1;
  let rotation: Rotation = rotation0;
  const lastHold = hold0.clone();

  // while held, the part shows level at the hand's pose
  const topOf = (pos: Vector3, yaw: number, out: Vector3): Vector3 => out.set(legs.top[0], legs.top[1], legs.top[2]).applyAxisAngle(Y, yaw).add(pos);

  const finish = () => {
    isDone = true;
    tetherSeat.dispose();
    tetherGhost.dispose();
    view?.dispose();
    if (lit) kit.bins.highlight(-1);
    if (held.id !== null) transitions.hold(held.id, false);
    if (held.id === null) {
      object.removeFromParent();
    }
  };

  // ---- the end -----------------------------------------------------------------------------------------------------
  const matTest = (): ((x: number, z: number) => boolean) => {
    const xr = app.settings.xr.value;
    const g = benchGeometry(xr.posture, xr.dominantHand);
    const mat = matOf(g.work, g.back);
    root.updateWorldMatrix(true, false);
    app.bench.table.updateWorldMatrix(true, false);
    _M.copy(app.bench.table.matrixWorld).invert().multiply(root.matrixWorld);
    return (x, z) => onMatRect(mat, _tq.set(x, 0, z).applyMatrix4(_M).x, _tq.z);
  };

  const showReason = (text: string, at: Vector3) => {
    const c = createCallout(text, { tone: 'warn', distance: 0.65, shape: 'card' });
    const s = app.bench.scale.value;
    c.group.scale.setScalar(1 / s);
    c.group.position.copy(at);
    c.group.position.y += 0.004;
    root.add(c.group);
    setTimeout(() => c.dispose(), REASON_MS);
  };

  const back = (ms: number) => {
    if (held.id !== null) {
      transitions.hint(held.id, ms);
      transitions.hold(held.id, false);
      bi.restore(held.id);
    }
    deps.onReturn?.();
  };

  /** Applies a build action's result; false when it refused. */
  const applyResult = (r: ActionResult): ActionRefusal | null => {
    if (!r.ok) return r;
    const res = app.project.apply(r.ops, { label: r.label });
    return res.ok ? null : { ok: false, reason: 'bad-args', args: {} };
  };

  const release = (): void => {
    const lang = app.settings.lang.value;
    if (!pulled) {
      // never left its holes: nothing changes, the tether goes
      if (held.id !== null) transitions.hold(held.id, false);
      return;
    }
    const state = ghost?.state ?? null;
    _hold.copy(lastHold);
    const onMat = matTest();
    const bin = binUnder(app, topOf(object.position, yawOf(object), _top));
    const decision: Release = decideRelease({ ghost: state, onMat: onMat(object.position.x, object.position.z), bin });
    const doc = app.project.doc;
    const feedbackAt = (p: Vector3): Vec3 => {
      _w.copy(p);
      root.localToWorld(_w);
      return [_w.x, _w.y, _w.z];
    };

    // a new part from the shelf let go off the mat, or over a bin, goes back to the shelf
    if ((decision.kind === 'back' || decision.kind === 'bin') && held.id === null) return back(0);
    // a part of the bench let go over a bin shrinks into it and leaves the project (one undo)
    if (decision.kind === 'bin' && held.id !== null) {
      const refused = removeOnBin(app, transitions, held.id, [], decision.bin, hand);
      if (!refused) return;
      showRefusal(app, refused, object.position, hand);
      return back(RETURN_MS);
    }
    // anything else that lands back on the mat stops being set down in the room
    if (decision.kind !== 'back' && held.id !== null) bi.setFree(held.id, null, { relayout: false });

    // where the part would lie if it did not seat: its rectangle clears the others, on the mat
    const lieAt = (): { x: number; y: number } | null => {
      const placement = held.id !== null ? doc.views.find((v) => v.kind === 'breadboard')?.placements.find((p) => p.c === held.id) : undefined;
      const yaw = yawOfRotation(placement?.rotation_deg ?? 0);
      const rel = rectRelativeToCorner(held.asset, yaw);
      const cornerOff = _top.set(held.asset.footprint.x, 0, held.asset.footprint.z).applyAxisAngle(Y, yaw);
      const want = { x: (object.position.x + cornerOff.x) * 1000, y: (object.position.z + cornerOff.z) * 1000 };
      const others: RectMm[] = [];
      for (const [id, item] of bi.items) if (id !== held.id) others.push(rectOfItem(item));
      return freeSpot(want, rel, others, (r) => onMat((r.minX + r.maxX) / 2000, (r.minY + r.maxY) / 2000));
    };

    const lie = (reason: Pick<ActionRefusal, 'reason' | 'args'> | null, at: Vector3): void => {
      const spot = lieAt();
      if (!spot) return back(RETURN_MS);
      if (held.id !== null) {
        const r = movePart(doc, { part: held.id, to: { x_mm: spot.x, y_mm: spot.y }, seat: false });
        transitions.hint(held.id, reason ? SLIDE_MS : RETURN_MS);
        transitions.hold(held.id, false);
        const refused = applyResult(r);
        if (refused) {
          bi.restore(held.id);
          if (refused.reason !== 'unchanged') showReason(reasonText(lang, refused), at);
          return;
        }
      } else {
        // a new part: its middle at the spot
        const rel = rectRelativeToCorner(held.asset, 0);
        const r = placePart(doc, { ref: held.ref, at: { x_mm: spot.x + (rel.minX + rel.maxX) / 2, y_mm: spot.y + (rel.minY + rel.maxY) / 2 } });
        const refused = applyResult(r);
        if (refused) {
          showReason(reasonText(lang, refused), at);
          return back(0);
        }
      }
      if (reason) {
        kit.feedback.play('invalid', feedbackAt(at), hand);
        showReason(reasonText(lang, reason), at);
      } else kit.feedback.play('snap', feedbackAt(at), hand);
    };

    // let go off the mat: like in real life it stays where it was let go, dropped onto what is under it (the bench
    // top or the floor). Pulled out of its holes, it leaves the circuit (the document keeps it, unseated).
    if (decision.kind === 'back' && held.id !== null) {
      const id = held.id;
      _w.copy(object.position);
      root.localToWorld(_w);
      const rest = restBelow(app, _w);
      const drop = Math.max(0, _w.y - rest.y);
      _w.y = rest.y;
      const at = _w.clone();
      root.worldToLocal(_w);
      transitions.hold(id, false);
      transitions.hint(id, fallMs(drop), fallEase);
      bi.setFree(id, { position: _w.clone(), quaternion: object.quaternion.clone() }, { relayout: !held.seated });
      if (held.seated) {
        const spot = lieAt();
        const to = spot ? { x_mm: spot.x, y_mm: spot.y } : partOrigin(doc, id);
        const refused = to ? applyResult(movePart(doc, { part: id, to, seat: false })) : null;
        if (!to || refused) bi.restore(id);
      }
      kit.feedback.play('snap', [at.x, at.y, at.z], hand);
      return;
    }

    if (decision.kind === 'seat') {
      const r = seatPart(doc, held.id !== null ? { part: held.id, fit: decision.fit } : { ref: held.ref, fit: decision.fit });
      if (held.id !== null) {
        transitions.hint(held.id, DURATION.seat);
        transitions.hold(held.id, false);
      }
      const refused = applyResult(r);
      if (!refused) {
        const at = _w.set(0, 0, 0);
        const bx = bi.anchorBoard(surfaceId!, decision.fit.anchorHole, at);
        kit.feedback.play('seat', bx ? feedbackAt(at) : null, hand);
        if (held.id === null) object.visible = false;
        return;
      }
      if (refused.reason === 'unchanged') {
        if (held.id !== null) bi.restore(held.id);
        return;
      }
      // the document moved under the ghost: say why and lay the part beside
      bi.anchorBoard(surfaceId!, decision.fit.anchorHole, _pos);
      return lie(refused, _pos.clone());
    }

    if (decision.kind === 'beside') {
      const problem = decision.problem;
      const holeAt = problem?.hole && surfaceId ? bi.anchorBoard(surfaceId, problem.hole, _pos) : null;
      const at = (holeAt ? _pos : object.position).clone();
      const reason = problem ? refusalOfProblem(problem) : ({ reason: 'bad-args' as const, args: {} } satisfies Pick<ActionRefusal, 'reason' | 'args'>);
      return lie(reason, at);
    }
    return lie(null, object.position.clone());
  };

  // ---- per frame ---------------------------------------------------------------------------------------------------
  const holder: Holder = {
    get done() {
      return isDone;
    },
    frame(_dt, tMs) {
      if (isDone) return false;
      nowMs = tMs;
      if (startedAt < 0) startedAt = tMs;
      const pose = app.input.pose(hand);
      if (!pose) loss.lost(tMs, 'hold');
      else {
        if (ending === 'lost') {
          // tracking is back, but the press is over: it was a loss, so the part goes back
          finish();
          back(RETURN_MS);
          return false;
        }
        loss.found();
      }
      const step = loss.update(tMs);
      if (step === 'return') {
        finish();
        back(RETURN_MS);
        return false;
      }
      if (step === 'frozen' || step === 'over' || !pose) return true;
      if (!holdNow(_hold)) return true;
      lastHold.copy(_hold);
      if (near && tMs - startedAt < ARM_MS) {
        hold0.copy(_hold);
        off.copy(object.position).sub(hold0);
        return true;
      }
      const s = app.bench.scale.value;

      // turning: the wrist's heading, or a flick of the stick
      const h = headingDeg(pose.normal[0], pose.normal[2]);
      if (h !== null) {
        if (!headingSeen) {
          stepper.reset(h);
          headingSeen = true;
        } else wristSteps = stepper.update(h);
      }
      if (pose.source === 'controller') flickSteps -= flick.update(app.input.stick(hand).x);
      const steps = wristSteps + flickSteps;
      const yaw = yaw0 + (steps * Math.PI) / 2;
      const nextRotation = turned(rotation0, steps);
      if (nextRotation !== rotation) {
        rotation = nextRotation;
        ghost?.setRotation(rotation);
      }

      // the pull threshold of a seated part
      if (!pulled) {
        const lift = (_hold.y - hold0.y) * s;
        if (pull.update(lift, s) === 'pulled') {
          pulled = true;
          pulledAt = tMs;
          stepper.reset(h ?? 0);
          wristSteps = 0;
          flickSteps = 0;
          _w.copy(object.position);
          root.localToWorld(_w);
          kit.feedback.play('pull', [_w.x, _w.y, _w.z], hand);
        }
      }
      if (!pulled) {
        // below the threshold it stays put and a tether shows
        topOf(seatPos, yaw0, _top);
        _off.copy(off);
        topOf(_pos.copy(_hold).add(_off), yaw0, _top2);
        tetherSeat.set(_top.x, _top.y, _top.z, _top2.x, _top2.y, _top2.z);
        return true;
      }
      tetherSeat.hide();

      // where the part is: the hand's point plus its offset, which a far grab lets fly in
      _off.copy(off).applyAxisAngle(Y, yaw - yaw0);
      if (!near || held.id === null) _off.multiplyScalar(1 - easeIynk(progress(tMs - startedAt, FLY_MS)));
      _pos.copy(_hold).add(_off);
      if (pulledAt >= 0 && held.seated && tMs - pulledAt < PULL_MS) {
        const k = easeIynk(progress(tMs - pulledAt, PULL_MS));
        _pos.lerpVectors(seatPos, _pos, k);
      }
      object.position.copy(_pos);
      object.quaternion.setFromAxisAngle(Y, yaw);

      if (held.id !== null) {
        const bin = binUnder(app, topOf(_pos, yaw, _top));
        if (bin !== litBin) {
          litBin = bin;
          lit = bin >= 0;
          kit.bins.highlight(bin);
          if (lit) {
            _w.copy(_pos);
            root.localToWorld(_w);
            kit.feedback.play('hover-grabbable', [_w.x, _w.y, _w.z], hand);
          }
        }
      }

      if (ghost && view) {
        const doc = app.project.doc;
        if (doc !== lastDoc) {
          lastDoc = doc;
          ghost.setDoc(doc);
        }
        _tip.set(legs.anchor[0], legs.anchor[1], legs.anchor[2]).applyAxisAngle(Y, yaw).add(_pos);
        const st = ghost.update(tMs / 1000, _tip.x, _tip.y, _tip.z, _pos.y + legs.lowest, s);
        if (st.changed && st.fit && tMs - lastSnap >= SNAP_MIN_MS) {
          lastSnap = tMs;
          bi.anchorBoard(surfaceId!, st.fit.anchorHole, _w);
          root.localToWorld(_w);
          kit.feedback.play('snap', [_w.x, _w.y, _w.z], hand);
        }
        view.update(st);
        const seatAt = view.pose;
        if (st.shown && st.fit && seatAt) {
          topOf(_pos, yaw, _top);
          topOf(seatAt.position, seatAt.yaw, _top2);
          tetherGhost.set(_top.x, _top.y, _top.z, _top2.x, _top2.y, _top2.z);
        } else tetherGhost.hide();
      }
      return true;
    },
    end() {
      if (isDone) return;
      const pose = app.input.pose(hand);
      if (!pose) {
        // tracking dropped with the press: frozen, then back after 500 ms, never seated
        ending = 'lost';
        loss.lost(nowMs, 'hold');
        return;
      }
      view?.hide();
      tetherGhost.hide();
      tetherSeat.hide();
      release();
      finish();
    },
    cancel() {
      if (isDone) return;
      finish();
      back(RETURN_MS);
    },
  };
  return holder;
}

/** One frame loop for every holder in the app. */
export function createCarryLoop(app: XrApp) {
  const holders = new Set<Holder>();
  const off = onLookFrame(app.world, (dt, t) => {
    for (const h of holders) if (!h.frame(dt * 1000, t * 1000)) holders.delete(h);
    for (const h of holders) if (h.done) holders.delete(h);
  });
  return {
    add(h: Holder) {
      holders.add(h);
    },
    dispose() {
      off();
      for (const h of [...holders]) h.cancel();
      holders.clear();
    },
  };
}
