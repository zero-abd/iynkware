/**
 * The twelve bins' contents: each shows its part at 3x of real size (scaled down to fit when bigger, as a board is),
 * standing on the tray floor with a small name label. A grab of a bin item hands a new part to the edit module
 * (`benchKit(app).carry`): the bin item hides, the press's events are forwarded to the carry, and the item comes back
 * with an eased move when the carry returns it, or a moment after it was placed (a bin never runs out).
 */
import { BoxGeometry, Group, Mesh, DoubleSide, MeshBasicMaterial, Vector3, type Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Vec3 } from '../../contracts/common';
import type { InteractionEvent } from '../../contracts/input';
import type { PartAsset } from '../../contracts/assets';
import { createCallout, type Callout } from '../../look/callout';
import { fadeIn, hoverLift } from '../../look/moves';
import { placePart } from '../core/actions';
import { benchGeometry } from '../core/geometry';
import { benchKit, type Carry } from '../core/kit';
import type { ShelfEntry } from './groups';
import type { ShelfLayout } from './layout';

/** The bins show parts at this multiple of real size (design 3.4: bins at 3x). */
export const SHELF_SCALE = 3;
/** The grab collider is never smaller than this (design 2.6: 30 mm for hands). */
export const MIN_COLLIDER = 0.03;
const LIFT = 0.006;
const MAX_HEIGHT = 0.05;
/** A placed part's bin item comes back after this long (a returned one comes back on `onReturn`). */
const REFILL_MS = 400;

const unitBox = new BoxGeometry(1, 1, 1);
// double sided: a grab sphere whose centre is inside the box must still find its walls
const invisible = new MeshBasicMaterial({ visible: false, side: DoubleSide });
const _v = new Vector3();

interface Item {
  readonly index: number;
  readonly slot: Group;
  readonly holder: Group;
  readonly collider: Mesh;
  entry: ShelfEntry | null;
  label: Callout | null;
  object: Object3D | null;
  /** The scale the object shows at: 3x, less when it does not fit its bin. */
  shown: number;
  hidden: boolean;
  /** Bumped whenever the bin gets other contents, so a late asset or a late return knows it is stale. */
  gen: number;
  hovering: number;
  carrying: { readonly carry: Carry; readonly pointer: number } | null;
  unbind: () => void;
}

export interface Bins {
  /** Where the bins stand (call before `show`, and again when the posture or hand changes). */
  layout(l: ShelfLayout): void;
  /** Shows these entries (at most 12) in the bins, nearest tier first. */
  show(entries: readonly ShelfEntry[]): void;
  dispose(): void;
}

/** The scale a part of this size shows at in a bin of `w` by `d` metres, `height` tall at most. */
export function fitScale(size: { w: number; h: number; d: number }, bin: { w: number; d: number }, height = MAX_HEIGHT): number {
  const k = Math.min(
    1,
    size.w > 0 ? bin.w / (size.w * SHELF_SCALE) : 1,
    size.d > 0 ? bin.d / (size.d * SHELF_SCALE) : 1,
    size.h > 0 ? height / (size.h * SHELF_SCALE) : 1,
  );
  return SHELF_SCALE * k;
}

/**
 * The bins live in `parent` for as long as the shelf does: their colliders are bound to the input service, which gives
 * every bound object (and its ancestors) an entity that keeps it in the scene, so a bin is never removed, only given
 * other contents (or none, hidden and unbound).
 */
export function createBins(app: XrApp, parent: Object3D): Bins {
  const kit = benchKit(app);
  const items: Item[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let layout: ShelfLayout | null = null;
  let disposed = false;

  const worldOf = (item: Item): Vec3 => {
    item.holder.getWorldPosition(_v);
    return [_v.x, _v.y, _v.z];
  };

  const reveal = (item: Item) => {
    if (!item.entry || !item.hidden) return;
    item.hidden = false;
    item.holder.visible = true;
    const o = item.object;
    if (!o) return;
    fadeIn(app.world, (a) => o.scale.setScalar(Math.max(1e-4, item.shown * a)), { ms: 200, from: 0.4, key: item });
  };

  const hide = (item: Item) => {
    item.hidden = true;
    item.holder.visible = false;
    item.hovering = 0;
    hoverLift(app.world, item.holder, LIFT, false, 'y');
  };

  /** No edit module carries: the part goes straight on the mat's back strip. */
  const placeOnBack = (entry: ShelfEntry) => {
    const xr = app.settings.xr.value;
    const back = benchGeometry(xr.posture, xr.dominantHand).back;
    _v.set(back.x, 0, back.z);
    app.bench.table.localToWorld(_v);
    app.bench.root.worldToLocal(_v);
    const at = app.bench.boardToDoc([_v.x, _v.y, _v.z]);
    const r = placePart(app.project.doc, { ref: entry.ref, at: { x_mm: at.xMm, y_mm: at.yMm } });
    if (r.ok) app.project.apply(r.ops, { label: r.label });
  };

  const take = (item: Item, e: InteractionEvent) => {
    const entry = item.entry;
    if (!entry || item.carrying) return;
    const gen = item.gen;
    const carry = kit.carry.begin({
      ref: entry.ref,
      version: entry.version,
      start: e,
      from: worldOf(item),
      fromScale: item.shown / app.bench.scale.value,
      onReturn: () => {
        if (item.gen === gen) reveal(item);
      },
    });
    if (!carry) {
      placeOnBack(entry);
      return;
    }
    item.carrying = { carry, pointer: e.pointer.id };
    hide(item);
  };

  const handle = (item: Item, e: InteractionEvent) => {
    switch (e.type) {
      case 'hover-start':
        if (item.hidden || !item.object) return;
        if (item.hovering++ === 0) {
          hoverLift(app.world, item.holder, LIFT, true, 'y');
          kit.feedback.play('hover-grabbable', e.point ?? worldOf(item), e.pointer.hand);
        }
        break;
      case 'hover-end':
        if (item.hovering > 0 && --item.hovering === 0) hoverLift(app.world, item.holder, LIFT, false, 'y');
        break;
      case 'grab-start':
        take(item, e);
        break;
      case 'grab-move':
      case 'drag-move':
        if (item.carrying && item.carrying.pointer === e.pointer.id) item.carrying.carry.move(e);
        break;
      case 'grab-end': {
        const c = item.carrying;
        if (!c || c.pointer !== e.pointer.id) return;
        item.carrying = null;
        restoreCollider(item);
        c.carry.end(e);
        // placed parts leave the bin full: it refills, eased (a returned one is already back)
        const gen = item.gen;
        const t = setTimeout(() => {
          timers.delete(t);
          if (item.gen === gen && !item.carrying) reveal(item);
        }, REFILL_MS);
        timers.add(t);
        break;
      }
      default:
        break;
    }
  };

  /** The grab handle moves the bound collider with the hand: it goes back to its bin the moment the press ends. */
  const restoreCollider = (item: Item) => {
    item.collider.position.set(0, item.collider.scale.y / 2, 0);
    item.collider.quaternion.identity();
    item.collider.updateMatrix();
  };

  const fill = (item: Item, asset: PartAsset) => {
    const l = layout;
    if (!l) return;
    const object = asset.instantiate();
    object.name = `bench:shelf-item:${item.entry?.ref ?? ''}`;
    const b = asset.sidecar.bounds;
    const size = { w: b.max[0] - b.min[0], h: b.max[1] - b.min[1], d: b.max[2] - b.min[2] };
    item.shown = fitScale(size, { w: l.binW - 0.008, d: l.tierD - 0.02 });
    object.position.set(0, 0, -0.004);
    item.holder.add(object);
    item.object = object;
    const k = item.shown;
    const cw = Math.max(MIN_COLLIDER, Math.min(l.binW - 0.003, size.w * k + 0.01));
    const cd = Math.max(MIN_COLLIDER, Math.min(l.tierD - 0.008, size.d * k + 0.01));
    const ch = Math.max(MIN_COLLIDER, size.h * k + 0.01);
    item.collider.scale.set(cw, ch, cd);
    item.collider.position.y = ch / 2;
    if (item.hidden) {
      object.scale.setScalar(k);
      return;
    }
    fadeIn(app.world, (a) => object.scale.setScalar(Math.max(1e-4, k * a)), { ms: 220, from: 0.3, key: item });
  };

  /** Empties a bin: its binding, its item, its label (the bin itself stays). */
  const empty = (item: Item) => {
    item.gen++;
    item.carrying?.carry.cancel();
    item.carrying = null;
    restoreCollider(item);
    item.unbind();
    item.unbind = () => undefined;
    item.label?.dispose();
    item.label = null;
    if (item.object) {
      item.holder.remove(item.object);
      item.object = null;
    }
    item.entry = null;
    item.hidden = false;
    item.hovering = 0;
    item.holder.visible = true;
    item.slot.visible = false;
  };

  const ensureItems = (n: number) => {
    while (items.length < n) {
      const index = items.length;
      const slot = new Group();
      slot.name = `bench:shelf-bin:${index}`;
      slot.visible = false;
      const holder = new Group();
      slot.add(holder);
      const collider = new Mesh(unitBox, invisible);
      collider.name = 'bench:shelf-collider';
      slot.add(collider);
      parent.add(slot);
      items.push({ index, slot, holder, collider, entry: null, label: null, object: null, shown: SHELF_SCALE, hidden: false, gen: 0, hovering: 0, carrying: null, unbind: () => undefined });
    }
  };

  return {
    layout(l) {
      layout = l;
      ensureItems(l.bins.length);
      for (const item of items) {
        const b = l.bins[item.index]!;
        item.slot.position.set(b.x, b.y, b.z);
      }
    },
    show(entries) {
      const l = layout;
      if (disposed || !l) return;
      void app.assets.preload(entries.map((e) => e.ref)).catch(() => undefined);
      for (const item of items) {
        empty(item);
        const entry = entries[item.index];
        if (!entry) continue;
        const slotDef = l.bins[item.index]!;
        const gen = item.gen;
        item.entry = entry;
        item.slot.visible = true;
        item.collider.scale.set(MIN_COLLIDER, MIN_COLLIDER, MIN_COLLIDER);
        item.collider.position.y = MIN_COLLIDER / 2;
        const label = createCallout(entry.name, { bare: true, shape: 'tag', distance: 0.45, lean: 0.5 });
        label.group.position.set(0, label.height / 2 + 0.002, slotDef.d / 2 + 0.001);
        label.group.scale.setScalar(Math.min(1, (slotDef.w - 0.002) / Math.max(1e-6, label.width)));
        label.group.traverse((o) => {
          o.raycast = () => undefined;
        });
        item.slot.add(label.group);
        item.label = label;
        item.unbind = app.input.bind(item.collider, { id: `shelf:${entry.ref}`, ray: true, grab: 'both' }, (e) => handle(item, e));
        void app.assets.get(entry.ref, entry.version).then(
          (asset) => {
            if (item.gen === gen && !disposed) fill(item, asset);
          },
          () => undefined,
        );
      }
    },
    dispose() {
      disposed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const item of items) empty(item);
    },
  };
}
