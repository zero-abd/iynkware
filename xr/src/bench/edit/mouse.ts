/**
 * The mouse on a flat screen (desktop testing without a headset): drag any part or board on the bench like a hand
 * carries it. Only in flat mode; a headset keeps the hand and controller carry (carry.ts, board.ts).
 *
 *   drag          press on a part or board and move: it follows the mouse over a level plane at its height
 *   wheel         while dragging, lifts it up or lowers it (a part can be carried off the bench and down to the floor)
 *   Q / E         turns the last part or board touched one step (a quarter turn, a board 15 degrees), one undo
 *   release       over the mat: it moves there in the document (a part seats where its first leg lands); off the mat:
 *                 it drops onto the bench top or the floor and stays there, out of the circuit (`setFree`)
 *
 * A breadboard carries its seated parts. Every change is one `app.project.apply`, so undo takes it back.
 */
import { Plane, Raycaster, Vector2, Vector3, type Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { movePart, pullPart, turnPart } from '../core/actions';
import { benchGeometry } from '../core/geometry';
import { benchKit } from '../core/kit';
import { fallEase, fallMs, restBelow } from '../core/rest';
import { benchInternals, type BenchItem } from '../space';
import type { Transitions } from './motion';
import { matOf, onMatRect } from './place';
import { RETURN_MS } from './carry';

/** Pixels the mouse moves before a press becomes a drag (a click stays a click). */
const DRAG_PX = 4;
/** Metres one wheel notch lifts, world. */
const LIFT_STEP = 0.02;
/** A dragged item rides this high above where it was picked up, world metres. */
const LIFT0 = 0.01;
const Y_AXIS = new Vector3(0, 1, 0);

export function mountMouseDrag(app: XrApp, transitions: Transitions): Unsubscribe {
  const bi = benchInternals(app.bench);
  const canvas = (app.world as unknown as { renderer?: { domElement?: HTMLCanvasElement } }).renderer?.domElement;
  if (!bi || !canvas || typeof window === 'undefined') return () => undefined;
  const root = app.bench.root;
  const ray = new Raycaster();
  const ndc = new Vector2();
  const plane = new Plane();
  const hit = new Vector3();
  const _w = new Vector3();
  const _t = new Vector3();

  let last: string | null = null;
  let press: { item: BenchItem; x: number; y: number; id: number } | null = null;
  let drag: {
    item: BenchItem;
    group: BenchItem[];
    bases: Vector3[];
    /** World point under the mouse at the start, and the plane height. */
    start: Vector3;
    height: number;
    lift: number;
  } | null = null;

  const flat = () => app.mode.value === 'flat';
  const aim = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, app.world.camera);
  };
  /** The bench item under the mouse, or null. */
  const itemAt = (e: PointerEvent): BenchItem | null => {
    if (!root.visible) return null;
    aim(e);
    // a small part sits in the breadboard: the part wins over a board, a board over the breadboard
    const rank = { part: 0, board: 1, surface: 2 } as const;
    let best: BenchItem | null = null;
    for (const h of ray.intersectObject(root, true)) {
      let o: Object3D | null = h.object;
      if (!o.visible) continue;
      while (o && typeof o.userData.partId !== 'string') o = o.parent;
      const item = o ? bi.items.get(o.userData.partId as string) : undefined;
      if (item && (!best || (rank[item.role as keyof typeof rank] ?? 3) < (rank[best.role as keyof typeof rank] ?? 3))) best = item;
      if (best?.role === 'part') break;
    }
    return best;
  };
  /** Where the mouse ray meets the level plane at the drag's height, world; null when it points away. */
  const onPlane = (e: PointerEvent | WheelEvent): Vector3 | null => {
    if (!drag) return null;
    aim(e);
    plane.set(Y_AXIS, -(drag.height + drag.lift));
    return ray.ray.intersectPlane(plane, hit);
  };

  const begin = (item: BenchItem) => {
    const group = [item, ...(item.role === 'surface' ? [...bi.items.values()].filter((i) => i.role === 'part' && i.seated) : [])];
    for (const g of group) transitions.hold(g.id, true);
    item.object.getWorldPosition(_w);
    drag = { item, group, bases: group.map((g) => g.object.position.clone()), start: new Vector3(), height: _w.y, lift: LIFT0 };
  };
  const follow = (e: PointerEvent | WheelEvent) => {
    if (!drag) return;
    const p = onPlane(e);
    if (!p) return;
    if (drag.start.lengthSq() === 0) drag.start.copy(p).setY(drag.height);
    // the move in root's frame: root may be scaled and turned with the bench
    const a = root.worldToLocal(_w.copy(drag.start));
    const b = root.worldToLocal(_t.copy(p).setY(drag.height + drag.lift));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    drag.group.forEach((g, i) => g.object.position.set(drag!.bases[i]!.x + dx, drag!.bases[i]!.y + dy, drag!.bases[i]!.z + dz));
  };

  const release = () => {
    if (!drag) return;
    const { item, group } = drag;
    drag = null;
    const o = item.object;
    const doc = app.project.doc;
    const xr = app.settings.xr.value;
    const mat = matOf(benchGeometry(xr.posture, xr.dominantHand).work, benchGeometry(xr.posture, xr.dominantHand).back);
    o.getWorldPosition(_w);
    app.bench.table.updateWorldMatrix(true, false);
    app.bench.table.worldToLocal(_t.copy(_w));
    const overMat = onMatRect(mat, _t.x, _t.z) && _t.y > -0.05 && _t.y < 0.15;
    const done = (ms: number, ease?: (t: number) => number) => {
      for (const g of group) {
        transitions.hint(g.id, ms, ease);
        transitions.hold(g.id, false);
      }
    };

    if (overMat) {
      // the document's corner for where it is now (the same formula the layout draws it with)
      const yaw = 2 * Math.atan2(o.quaternion.y, o.quaternion.w);
      const fp = item.asset.footprint;
      const c = _t.set(-fp.x, 0, -fp.z).applyAxisAngle(Y_AXIS, yaw);
      const to = { x_mm: (o.position.x - c.x) * 1000, y_mm: (o.position.z - c.z) * 1000 };
      bi.setFree(item.id, null, { relayout: false });
      done(RETURN_MS);
      const r = movePart(doc, { part: item.id, to });
      if (!r.ok) return void bi.restore(item.id);
      const res = app.project.apply(r.ops, { label: r.label });
      if (!res.ok) return void bi.restore(item.id);
      benchKit(app).feedback.play('snap', [_w.x, _w.y, _w.z], null);
      return;
    }

    // off the mat: straight down onto the bench top or the floor, and it stays there
    const rest = restBelow(app, _w);
    const drop = Math.max(0, _w.y - rest.y);
    _w.y = rest.y;
    const at: [number, number, number] = [_w.x, _w.y, _w.z];
    root.worldToLocal(_w);
    done(fallMs(drop), fallEase);
    const unseat = item.role === 'part' && item.seated;
    bi.setFree(item.id, { position: _w.clone(), quaternion: o.quaternion.clone() }, { relayout: !unseat });
    if (unseat) {
      const r = pullPart(doc, { part: item.id });
      if (!r.ok || !app.project.apply(r.ops, { label: r.label }).ok) bi.restore(item.id);
    }
    benchKit(app).feedback.play('snap', at, null);
  };

  const turn = (dir: 1 | -1) => {
    if (!last || drag) return;
    const r = turnPart(app.project.doc, { part: last, step: dir });
    if (r.ok) app.project.apply(r.ops, { label: r.label });
  };

  // capture phase: a press on a bench item is ours, and the bench's own pointer handling never sees it
  const onDown = (e: PointerEvent) => {
    if (!flat() || e.button !== 0) return;
    const item = itemAt(e);
    if (!item) return;
    last = item.id;
    press = { item, x: e.clientX, y: e.clientY, id: e.pointerId };
    e.stopPropagation();
  };
  const onMove = (e: PointerEvent) => {
    if (press && !drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_PX) {
      canvas.setPointerCapture?.(press.id);
      begin(press.item);
    }
    if (drag) {
      e.stopPropagation();
      follow(e);
    } else if (flat() && !press) canvas.style.cursor = itemAt(e) ? 'grab' : '';
  };
  const onUp = (e: PointerEvent) => {
    if (drag) {
      e.stopPropagation();
      release();
    }
    press = null;
    if (flat()) canvas.style.cursor = '';
  };
  const onWheel = (e: WheelEvent) => {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    drag.lift = Math.max(-3, Math.min(1, drag.lift + (e.deltaY < 0 ? LIFT_STEP : -LIFT_STEP)));
    follow(e);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!flat() || e.repeat) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'q' || e.key === 'Q') turn(1);
    if (e.key === 'e' || e.key === 'E') turn(-1);
    if (e.key === 'Escape' && drag) {
      const { group } = drag;
      drag = null;
      press = null;
      for (const g of group) {
        transitions.hint(g.id, RETURN_MS);
        transitions.hold(g.id, false);
        bi.restore(g.id);
      }
    }
  };
  // the wheel moves the item, not the page, while dragging
  canvas.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  canvas.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('keydown', onKey);
  return () => {
    canvas.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    canvas.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('keydown', onKey);
  };
}
