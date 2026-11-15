/**
 * The bench pointer router (design 3.1): one invisible proxy per laid-out item is bound through `app.input.bind`, and a
 * press on one is resolved here into what the person meant: a pin or hole cell, a part body or a board's edge band
 * (`priority.ts`), then handed to the verb handler a sub-module registered (`router.on`). IWSDK's grab handle moves the
 * bound object, so the proxy is the thing that moves and is put back on `grab-end`; what the person sees is moved by
 * the handler, from the pointer pose.
 *
 *   const router = routerOf(app);  const release = router.retain();
 *   router.on('body', (press) => ({ end(e) { ... } }));   // return null to decline: the press falls to the next target
 *
 * Also here, before anything commits: the hover ring on the cell under a hovering pinch or ray (`hover-cell`) and the
 * accent outline of a hovered part body (`hover-grabbable`). Nothing per frame allocates.
 */
import {
  BoxGeometry,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Quaternion,
  Vector3,
  DoubleSide,
} from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import type { Hand, InteractionEvent, PointerSource } from '../../contracts/input';
import { createCallout, type Callout } from '../../look/callout';
import { onLookFrame, motionOf } from '../../look/runner';
import { ACCENT, INK, hexNum } from '../../look/palette';
import { DURATION } from '../../look/motion';
import { benchInternals, type BenchItem } from '../space';
import { CELL_BAND_WORK_M, PITCH_M, createCellIndex, createStickyCell, type CellIndex, type StickyCell } from './cells';
import { benchKit } from './kit';
import { boardRectOf, inEdgeBand, pickTarget, POINTER_EVENTS_ORDER, TARGET_BIT, TARGET_PRIORITY, type TargetKind } from './priority';

export type Verb = 'cell' | 'body' | 'edge';

/** One press, resolved: what it is on and where. */
export interface BenchPress {
  readonly verb: Verb;
  /** The item whose proxy took the press (a part, a board or the breadboard). */
  readonly item: string;
  /** For `cell`: the pin or hole and the item it belongs to. */
  readonly cell: { readonly part: string; readonly anchor: string } | null;
  /** The `grab-start` of the binding. */
  readonly start: InteractionEvent;
  readonly hand: Hand | null;
  /** The pointer is near (a pinch or grip at the object) and not a ray. */
  readonly near: boolean;
  readonly source: PointerSource;
  /** Board frame: the pinch or grip point (near) or the ray's hit (far). */
  readonly point: Vector3;
}

/** What a verb handler does with the press it claimed. */
export interface PressHandler {
  /** `grab-move` of the press. */
  move?(e: InteractionEvent): void;
  /** `grab-end`: the press is over. */
  end?(e: InteractionEvent): void;
  /**
   * The hand keeps its hover ring and cell name while this press runs (a wire being drawn aims with them: the end lands
   * on the ringed cell, `BenchRouter.ringed`). Without it the ring is hidden for the whole press, as for a carry.
   */
  readonly keepHover?: boolean;
  /** The binding went away under the press (the item left the bench, the module tore down). */
  cancel?(): void;
}

export type VerbHandler = (press: BenchPress) => PressHandler | null;

export interface BenchRouter {
  /** Registers a handler for a verb; the last registered is asked first. */
  on(verb: Verb, handler: VerbHandler): Unsubscribe;
  /** Keeps the proxies and the hover alive; the last release takes them down. */
  retain(): Unsubscribe;
  /** The cells of a board or the breadboard (board frame, real size), or undefined. */
  cellsOf(item: string): CellIndex | undefined;
  /** A press of this hand is being handled. */
  pressing(hand: Hand): boolean;
  /** The part body this hand hovers, or null. */
  hovering(hand: Hand): string | null;
  /** The cell this hand's hover ring is on now (a pin or hole and its item), or null when no ring shows. */
  ringed(hand: Hand): { part: string; anchor: string } | null;
}

/** Which verbs are possible for a press, by the candidates found under it. Pure, for tests. */
export function pickVerb(candidates: { cell: boolean; body: boolean; edge: boolean }): Verb | null {
  const mask = (candidates.cell ? TARGET_BIT.cell : 0) | (candidates.body ? TARGET_BIT.body : 0) | (candidates.edge ? TARGET_BIT.edge : 0);
  const kind = pickTarget(mask);
  return kind === 'cell' || kind === 'body' || kind === 'edge' ? kind : null;
}

/** The padded collider of a part: at least 30 mm across in the world (design 2.6), real-size metres. */
export const GRAB_MIN_WORLD_M = 0.03;

/**
 * Other pillars' controls bind with the default order (0), and a press on a button must never go to the invisible board
 * proxy that happens to lie in its ray, so the proxies sit below every default: body above edge, both under 0.
 */
export const PROXY_ORDER_BASE = -10;

interface ProxyRec {
  readonly id: string;
  readonly role: BenchItem['role'];
  readonly proxy: Mesh;
  readonly outline: LineSegments | null;
  unbind: Unsubscribe;
  /** The proxy's own pose in the item's frame, to put it back after a grab. */
  readonly base: { x: number; y: number; z: number; sx: number; sy: number; sz: number };
  hovers: number;
}

interface CellEntry {
  readonly id: string;
  index: CellIndex;
  readonly sticky: Record<Hand, StickyCell>;
}

interface ActivePress {
  readonly rec: ProxyRec;
  readonly hand: Hand | null;
  handler: PressHandler | null;
  keeps: boolean;
}

const HANDS: readonly Hand[] = ['left', 'right'];
const RING_LIFT = 0.0003;

const proxyGeometry = new BoxGeometry(1, 1, 1);
const proxyMaterial = new MeshBasicMaterial({ visible: false });

const _p = new Vector3();
const _o = new Vector3();
const _d = new Vector3();
const _h = new Vector3();
const _cam = new Vector3();
const _q = new Quaternion();
const _iq = new Quaternion();
const _l = new Vector3();

const routers = new WeakMap<object, BenchRouter>();

/** The bench router of `app`, one per app. */
export function routerOf(app: XrApp): BenchRouter {
  let r = routers.get(app);
  if (!r) {
    r = createRouter(app);
    routers.set(app, r);
  }
  return r;
}

function createRouter(app: XrApp): BenchRouter {
  const handlers: Record<Verb, VerbHandler[]> = { cell: [], body: [], edge: [] };
  const proxies = new Map<string, ProxyRec>();
  const active = new Map<number, ActivePress>();
  const busy: Record<Hand, number> = { left: 0, right: 0 };
  const hoverBody: Record<Hand, string | null> = { left: null, right: null };
  /** Presses of a hand whose handler asked to keep the hover ring (`PressHandler.keepHover`). */
  const keepRing: Record<Hand, number> = { left: 0, right: 0 };
  let cells: CellEntry[] = [];
  let retained = 0;
  let teardown: Unsubscribe | null = null;

  // ---- proxies ---------------------------------------------------------------------------------------------------

  function sizeProxy(rec: ProxyRec, item: BenchItem) {
    const s = app.bench.scale.value;
    const { min, max } = item.asset.sidecar.bounds;
    const floor = GRAB_MIN_WORLD_M / s;
    let sx = Math.max(max[0] - min[0], floor);
    let sz = Math.max(max[2] - min[2], floor);
    let y0 = min[1];
    let y1 = max[1];
    if (item.role !== 'part') {
      // a plate over the whole top: the work edge band lies inside the outline, so the outline is the plate
      y1 += CELL_BAND_WORK_M / s;
    } else {
      y1 = Math.max(y1, y0 + floor);
    }
    const sy = Math.max(y1 - y0, 0.004 / s);
    const cx = (min[0] + max[0]) / 2;
    const cz = (min[2] + max[2]) / 2;
    sx = Math.max(sx, 1e-4);
    sz = Math.max(sz, 1e-4);
    Object.assign(rec.base, { x: cx, y: (y0 + y1) / 2, z: cz, sx, sy, sz });
    restoreProxy(rec);
    if (rec.outline) {
      // the outline hugs the padded box, a little proud of it
      rec.outline.position.set(cx, (y0 + y1) / 2, cz);
      rec.outline.scale.set(sx + 0.001 / s, sy + 0.001 / s, sz + 0.001 / s);
    }
  }

  function restoreProxy(rec: ProxyRec) {
    const b = rec.base;
    rec.proxy.position.set(b.x, b.y, b.z);
    rec.proxy.quaternion.identity();
    rec.proxy.scale.set(b.sx, b.sy, b.sz);
    rec.proxy.updateMatrix();
  }

  function makeProxy(item: BenchItem) {
    const proxy = new Mesh(proxyGeometry, proxyMaterial);
    proxy.name = `bench:proxy:${item.id}`;
    proxy.pointerEventsOrder = PROXY_ORDER_BASE + (item.role === 'part' ? POINTER_EVENTS_ORDER.body : POINTER_EVENTS_ORDER.edge);
    let outline: LineSegments | null = null;
    if (item.role === 'part') {
      outline = new LineSegments(unitEdges(), new LineBasicMaterial({ color: hexNum(ACCENT), transparent: true, toneMapped: false }));
      outline.name = `bench:outline:${item.id}`;
      outline.visible = false;
      outline.raycast = () => undefined;
    }
    const rec: ProxyRec = { id: item.id, role: item.role, proxy, outline, unbind: () => undefined, base: { x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1 }, hovers: 0 };
    item.object.add(proxy);
    if (outline) item.object.add(outline);
    sizeProxy(rec, item);
    rec.unbind = app.input.bind(proxy, { id: item.id, ray: true, grab: 'both' }, (e) => onEvent(rec, e));
    proxies.set(item.id, rec);
  }

  function dropProxy(id: string) {
    const rec = proxies.get(id);
    if (!rec) return;
    proxies.delete(id);
    rec.unbind();
    for (const [pid, a] of [...active]) {
      if (a.rec !== rec) continue;
      active.delete(pid);
      if (a.hand) busy[a.hand] = Math.max(0, busy[a.hand] - 1);
      if (a.keeps && a.hand) keepRing[a.hand] = Math.max(0, keepRing[a.hand] - 1);
      a.handler?.cancel?.();
    }
    for (const hand of HANDS) if (hoverBody[hand] === id) hoverBody[hand] = null;
    rec.proxy.removeFromParent();
    if (rec.outline) {
      motionOf(app.world).cancel(rec.outline);
      rec.outline.removeFromParent();
      (rec.outline.material as LineBasicMaterial).dispose();
    }
  }

  // ---- cells -----------------------------------------------------------------------------------------------------

  function rebuildCells(ids: Iterable<string>) {
    const bi = benchInternals(app.bench);
    if (!bi) return;
    const next = new Map(cells.map((c) => [c.id, c] as const));
    for (const id of ids) {
      const item = bi.items.get(id);
      if (!item || item.role === 'part') {
        next.delete(id);
        continue;
      }
      const anchors = [];
      for (const a of item.asset.sidecar.anchors) {
        if ((a.kind !== 'pin' && a.kind !== 'hole') || a.layer === 'xray') continue;
        if (!bi.anchorBoard(id, a.id, _p)) continue;
        anchors.push({ id: a.id, x: _p.x, y: _p.y, z: _p.z });
      }
      const index = createCellIndex(anchors);
      const old = next.get(id);
      if (old) {
        old.index = index;
        old.sticky.left = createStickyCell(index);
        old.sticky.right = createStickyCell(index);
      } else next.set(id, { id, index, sticky: { left: createStickyCell(index), right: createStickyCell(index) } });
    }
    cells = [...next.values()];
  }

  const entryOf = (id: string): CellEntry | undefined => cells.find((c) => c.id === id);

  // ---- press -----------------------------------------------------------------------------------------------------

  /** The cell a pointer at this event targets over any board (board frame), writing the choice into `found`. */
  function cellUnder(e: InteractionEvent, hand: Hand | null, near: boolean, point: Vector3): { entry: CellEntry; i: number } | null {
    const s = app.bench.scale.value;
    const side: Hand = hand ?? 'right';
    for (let k = 0; k < cells.length; k++) {
      const entry = cells[k]!;
      const st = entry.sticky[side];
      let i: number;
      if (near) i = st.near(point.x, point.y, point.z, s);
      else {
        _o.set(e.pointer.origin[0], e.pointer.origin[1], e.pointer.origin[2]);
        app.bench.root.worldToLocal(_o);
        dirToBoard(e.pointer.direction[0], e.pointer.direction[1], e.pointer.direction[2], _d);
        i = st.ray(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, s, viewDistanceOf(entry.index));
      }
      if (i >= 0) return { entry, i };
    }
    return null;
  }

  function dirToBoard(x: number, y: number, z: number, out: Vector3): Vector3 {
    out.set(x, y, z);
    // the board frame is the world turned about +y and scaled evenly: a direction only turns
    app.bench.root.getWorldQuaternion(_q).invert();
    return out.applyQuaternion(_q).normalize();
  }
  function viewDistanceOf(index: CellIndex): number {
    if (!Number.isFinite(index.hitX)) return 0.5;
    _h.set(index.hitX, index.planeY, index.hitZ);
    app.bench.root.localToWorld(_h);
    app.world.camera.getWorldPosition(_cam);
    return Math.max(0.1, _h.distanceTo(_cam));
  }

  /**
   * The grab sphere takes the nearest proxy, and the plate of a board is as near as a part standing on it, so for a near
   * press the part under the point is found here, on the bench's own data: the part whose padded box holds the point or
   * is within 20 mm (world) of it, the nearest first.
   */
  function partUnder(point: Vector3, s: number): BenchItem | null {
    const bi = benchInternals(app.bench);
    if (!bi) return null;
    let best: BenchItem | null = null;
    let bestD = 0.02 / s;
    for (const rec of proxies.values()) {
      if (rec.role !== 'part') continue;
      const item = bi.items.get(rec.id);
      if (!item) continue;
      _l.copy(point).sub(item.object.position).applyQuaternion(_iq.copy(item.object.quaternion).invert());
      const b = rec.base;
      const dx = Math.max(Math.abs(_l.x - b.x) - b.sx / 2, 0);
      const dy = Math.max(Math.abs(_l.y - b.y) - b.sy / 2, 0);
      const dz = Math.max(Math.abs(_l.z - b.z) - b.sz / 2, 0);
      const d = Math.hypot(dx, dy, dz);
      if (d <= bestD) {
        best = item;
        bestD = d;
      }
    }
    return best;
  }

  function resolve(e: InteractionEvent, rec: ProxyRec): BenchPress | null {
    const bi = benchInternals(app.bench);
    let item = bi?.items.get(rec.id);
    if (!bi || !item) return null;
    const hand = e.pointer.hand;
    const near = e.pointer.mode === 'grab';
    const point = new Vector3();
    // the point the system's pointer holds: the grab sphere (near) or the ray's hit (far)
    const p = near ? e.pointer.origin : (e.point ?? e.pointer.origin);
    point.set(p[0], p[1], p[2]);
    app.bench.root.worldToLocal(point);
    const s = app.bench.scale.value;
    if (near && item.role !== 'part') item = partUnder(point, s) ?? item;

    const cell = handlers.cell.length > 0 ? cellUnder(e, hand, near, point) : null;
    let edge = false;
    if (item.role !== 'part' && handlers.edge.length > 0) {
      const rect = boardRectOf(app.project.doc, item.id);
      edge = (e.pointer.source === 'controller' && near) || (rect !== undefined && inEdgeBand(rect, point.x, point.z, s, entryOf(item.id)?.index));
    }
    const body = item.role === 'part' && handlers.body.length > 0;
    const verb = pickVerb({ cell: cell !== null, body, edge });
    if (!verb) return null;
    const anchor = cell ? cell.entry.index.ids[cell.i]! : null;
    return {
      verb,
      item: item.id,
      cell: cell && anchor ? { part: cell.entry.id, anchor } : null,
      start: e,
      hand,
      near,
      source: e.pointer.source,
      point,
    };
  }

  /** The verb whose handler the last `claim` found (a press the cell verb declined can still be a body press). */
  let claimedVerb: Verb | null = null;
  function claim(press: BenchPress, e: InteractionEvent): PressHandler | null {
    claimedVerb = null;
    // the winning verb first, then the ones below it, as `pickTarget` orders them
    const order: readonly TargetKind[] = TARGET_PRIORITY;
    const start = order.indexOf(press.verb);
    for (let k = start; k < order.length; k++) {
      const verb = order[k]!;
      if (verb !== 'cell' && verb !== 'body' && verb !== 'edge') continue;
      if (verb === 'cell' && !press.cell) continue;
      if (verb === 'body' && benchInternals(app.bench)?.items.get(press.item)?.role !== 'part') continue;
      if (verb === 'edge' && benchInternals(app.bench)?.items.get(press.item)?.role === 'part') continue;
      const list = handlers[verb];
      for (let i = list.length - 1; i >= 0; i--) {
        const h = list[i]!(verb === press.verb ? press : { ...press, verb });
        if (h) {
          claimedVerb = verb;
          return h;
        }
      }
    }
    void e;
    return null;
  }

  function onEvent(rec: ProxyRec, e: InteractionEvent) {
    const pid = e.pointer.id;
    switch (e.type) {
      case 'hover-start':
        if (rec.role === 'part' && e.pointer.hand) hoverOn(rec, e.pointer.hand);
        return;
      case 'hover-end':
        if (rec.role === 'part' && e.pointer.hand) hoverOff(rec, e.pointer.hand);
        return;
      case 'grab-start': {
        const press = resolve(e, rec);
        const a: ActivePress = { rec, hand: e.pointer.hand, handler: null, keeps: false };
        active.set(pid, a);
        if (a.hand) busy[a.hand]++;
        if (press) a.handler = claim(press, e);
        if (a.handler?.keepHover && a.hand) {
          a.keeps = true;
          keepRing[a.hand]++;
        }
        if (a.handler && press && a.hand && claimedVerb === 'body') {
          const held = proxies.get(press.item);
          if (held) hoverOn(held, a.hand, true);
        }
        return;
      }
      case 'grab-move':
        active.get(pid)?.handler?.move?.(e);
        return;
      case 'grab-end': {
        const a = active.get(pid);
        if (!a) return;
        active.delete(pid);
        if (a.hand) busy[a.hand] = Math.max(0, busy[a.hand] - 1);
        if (a.keeps && a.hand) keepRing[a.hand] = Math.max(0, keepRing[a.hand] - 1);
        restoreProxy(rec);
        if (a.hand && hoverBody[a.hand]) {
          const held = proxies.get(hoverBody[a.hand]!);
          if (held) hoverOff(held, a.hand);
        }
        a.handler?.end?.(e);
        return;
      }
      default:
        return;
    }
  }

  // ---- hover: a part body ------------------------------------------------------------------------------------------

  function hoverOn(rec: ProxyRec, hand: Hand, force = false) {
    if ((!force && busy[hand] > 0) || hoverBody[hand] === rec.id) return;
    hoverBody[hand] = rec.id;
    rec.hovers++;
    if (rec.hovers === 1 && rec.outline) {
      const line = rec.outline;
      const mat = line.material as LineBasicMaterial;
      const pad = 0.001 / app.bench.scale.value;
      const target = [rec.base.sx + pad, rec.base.sy + pad, rec.base.sz + pad] as const;
      const wasVisible = line.visible;
      const fromOpacity = wasVisible ? mat.opacity : 0;
      const from = wasVisible
        ? ([line.scale.x, line.scale.y, line.scale.z] as const)
        : (target.map((n) => n * 1.08) as [number, number, number]);
      line.visible = true;
      mat.opacity = fromOpacity;
      line.scale.set(from[0], from[1], from[2]);
      motionOf(app.world).tween({
        key: line,
        ms: 140,
        onUpdate: (k) => {
          if (rec.hovers === 0) return;
          mat.opacity = fromOpacity + (1 - fromOpacity) * k;
          line.scale.set(
            from[0] + (target[0] - from[0]) * k,
            from[1] + (target[1] - from[1]) * k,
            from[2] + (target[2] - from[2]) * k,
          );
        },
      });
    }
    const at = app.bench.worldOf({ kind: 'part', part: rec.id });
    benchKit(app).feedback.play('hover-grabbable', at, hand);
  }

  function hoverOff(rec: ProxyRec, hand: Hand) {
    if (hoverBody[hand] !== rec.id) return;
    hoverBody[hand] = null;
    rec.hovers = Math.max(0, rec.hovers - 1);
    if (rec.hovers === 0 && rec.outline) {
      const line = rec.outline;
      const mat = line.material as LineBasicMaterial;
      const fromOpacity = mat.opacity;
      const pad = 0.001 / app.bench.scale.value;
      const target = [rec.base.sx + pad, rec.base.sy + pad, rec.base.sz + pad] as const;
      const from = [line.scale.x, line.scale.y, line.scale.z] as const;
      motionOf(app.world).tween({
        key: line,
        ms: DURATION.hoverOff,
        onUpdate: (k) => {
          if (rec.hovers !== 0) return;
          mat.opacity = fromOpacity * (1 - k);
          line.scale.set(
            from[0] + (target[0] - from[0]) * k,
            from[1] + (target[1] - from[1]) * k,
            from[2] + (target[2] - from[2]) * k,
          );
        },
        onDone: () => {
          if (rec.hovers === 0) line.visible = false;
        },
      });
    }
  }

  // ---- hover: a cell -----------------------------------------------------------------------------------------------

  const ringGeometry = { s: 0, geometry: null as RingGeometry | null };
  const ringMaterial = new MeshBasicMaterial({ color: hexNum(INK), side: DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const hover: Record<Hand, { ring: Mesh | null; label: Callout | null; shownName: string; cell: number; entry: CellEntry | null }> = {
    left: { ring: null, label: null, shownName: '', cell: -1, entry: null },
    right: { ring: null, label: null, shownName: '', cell: -1, entry: null },
  };

  function refreshRingGeometry(s: number) {
    if (ringGeometry.s === s && ringGeometry.geometry) return;
    ringGeometry.s = s;
    ringGeometry.geometry?.dispose();
    // one pitch across, a 2 dmm stroke at 0.65 m (1.3 mm of the world): 1.3 mm / s of the board frame
    const outer = PITCH_M / 2;
    const stroke = Math.min(outer * 0.6, 0.0013 / s);
    const g = new RingGeometry(outer - stroke, outer, 32);
    g.rotateX(-Math.PI / 2);
    ringGeometry.geometry = g;
    for (const h of HANDS) if (hover[h].ring) hover[h].ring!.geometry = g;
  }

  function hideHover(hand: Hand) {
    const h = hover[hand];
    if (h.ring) h.ring.visible = false;
    if (h.label) h.label.group.visible = false;
    h.cell = -1;
    h.entry = null;
  }

  function frameHand(hand: Hand) {
    if (busy[hand] > 0 && keepRing[hand] === 0) return hideHover(hand);
    const pose = app.input.pose(hand);
    if (!pose || cells.length === 0) return hideHover(hand);
    const s = app.bench.scale.value;
    let found: CellEntry | null = null;
    let at = -1;
    _p.set(pose.position[0], pose.position[1], pose.position[2]);
    app.bench.root.worldToLocal(_p);
    for (let k = 0; k < cells.length && at < 0; k++) {
      const entry = cells[k]!;
      const i = entry.sticky[hand].near(_p.x, _p.y, _p.z, s);
      if (i >= 0) {
        found = entry;
        at = i;
      }
    }
    if (at < 0) {
      _o.set(pose.ray.origin[0], pose.ray.origin[1], pose.ray.origin[2]);
      app.bench.root.worldToLocal(_o);
      dirToBoard(pose.ray.direction[0], pose.ray.direction[1], pose.ray.direction[2], _d);
      for (let k = 0; k < cells.length && at < 0; k++) {
        const entry = cells[k]!;
        const i = entry.sticky[hand].ray(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, s, viewDistanceOf(entry.index));
        if (i >= 0) {
          found = entry;
          at = i;
        }
      }
    }
    if (!found || at < 0) return hideHover(hand);
    const h = hover[hand];
    if (!h.ring) {
      refreshRingGeometry(s);
      h.ring = new Mesh(ringGeometry.geometry!, ringMaterial);
      h.ring.name = `bench:hover-cell:${hand}`;
      h.ring.raycast = () => undefined;
      h.ring.renderOrder = 5;
      app.bench.root.add(h.ring);
    }
    refreshRingGeometry(s);
    const idx = found.index;
    h.ring.visible = true;
    h.ring.position.set(idx.xs[at]!, idx.ys[at]! + RING_LIFT, idx.zs[at]!);
    if (!h.label) {
      h.label = createCallout('', { bare: true, shape: 'tag', distance: 0.65 });
      h.label.group.name = `bench:hover-name:${hand}`;
      h.label.group.traverse((o) => (o.raycast = () => undefined));
      app.bench.root.add(h.label.group);
    }
    const name = idx.ids[at]!;
    if (name !== h.shownName) {
      h.shownName = name;
      h.label.set(name);
    }
    h.label.group.visible = true;
    h.label.group.scale.setScalar(1 / s);
    h.label.group.position.set(idx.xs[at]!, idx.ys[at]! + 0.014 / s + 0.004, idx.zs[at]!);
    h.entry = found;
    h.cell = at;
  }

  function frame() {
    for (let i = 0; i < HANDS.length; i++) frameHand(HANDS[i]!);
  }

  // ---- lifecycle -------------------------------------------------------------------------------------------------

  function mount(): Unsubscribe {
    const bi = benchInternals(app.bench);
    if (!bi) return () => undefined;
    const sync = (addedIn: Iterable<string>, movedIn: Iterable<string>, removedIn: Iterable<string>) => {
      const added = [...addedIn];
      const moved = [...movedIn];
      const removed = [...removedIn];
      for (const id of removed) dropProxy(id);
      for (const id of added) {
        dropProxy(id);
        const item = bi.items.get(id);
        if (item) makeProxy(item);
      }
      const touched = new Set<string>([...added, ...moved, ...removed]);
      rebuildCells(touched);
    };
    sync(bi.items.keys(), [], []);
    const offItems = bi.onItems((c) => sync(c.added, c.moved, c.removed));
    const offScale = app.bench.scale.subscribe(() => {
      for (const rec of proxies.values()) {
        const item = bi.items.get(rec.id);
        if (item) sizeProxy(rec, item);
      }
    });
    const offFrame = onLookFrame(app.world, frame);
    return () => {
      offItems();
      offScale();
      offFrame();
      for (const id of [...proxies.keys()]) dropProxy(id);
      for (const hand of HANDS) {
        const h = hover[hand];
        h.ring?.removeFromParent();
        h.label?.dispose();
        h.ring = null;
        h.label = null;
      }
      ringGeometry.geometry?.dispose();
      ringGeometry.geometry = null;
      ringGeometry.s = 0;
      cells = [];
    };
  }

  return {
    on(verb, handler) {
      handlers[verb].push(handler);
      return () => {
        const i = handlers[verb].lastIndexOf(handler);
        if (i >= 0) handlers[verb].splice(i, 1);
      };
    },
    retain() {
      if (retained++ === 0) teardown = mount();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        if (--retained === 0) {
          teardown?.();
          teardown = null;
        }
      };
    },
    cellsOf: (item) => entryOf(item)?.index,
    pressing: (hand) => busy[hand] > 0,
    hovering: (hand) => hoverBody[hand],
    ringed(hand) {
      const h = hover[hand];
      if (!h.ring?.visible || !h.entry || h.cell < 0) return null;
      const anchor = h.entry.index.ids[h.cell];
      return anchor === undefined ? null : { part: h.entry.id, anchor };
    },
  };
}

let edgesUnit: EdgesGeometry | null = null;
/** The twelve edges of a unit box, shared by every outline (it is scaled to the part). */
function unitEdges(): EdgesGeometry {
  return (edgesUnit ??= new EdgesGeometry(new BoxGeometry(1, 1, 1)));
}
