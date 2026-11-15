/**
 * Realises `app.scale.seeThrough` and `app.scale.explode` on the bench's placed parts. It owns no state: the service
 * does. Converted assets are driven through their own lens API (`userData.xrAsset`); placeholders get their body faded
 * on materials this module clones and gives back at 0. Whole-build explode also lifts each placement by its build
 * level, as an offset on top of whatever position the bench writes, and shows dashed lines for the wires meanwhile.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LineDashedMaterial,
  LineSegments,
  Matrix4,
  Vector3,
  type Mesh,
  type Object3D,
} from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import { benchInternals } from '../../bench/space';
import { easeIynk } from '../../look/motion';
import { INK } from '../../look/palette';
import { motionOf } from '../../look/runner';
import { onFrame } from '../kit/frame';
import { ownMaterials, setOpacity, type OwnedMaterials } from '../kit/materials';
import { fadeMs } from '../kit/prefs';
import { bodyOpacity, buildLevel, LENS_MS, lensAmount, liftOf, movedByBench, type BuildLevel } from './lens';

/** What a converted placement's `userData.xrAsset` offers (tools/xr-assets/material/xr-asset.js). */
interface LensApi {
  explode(t: number): unknown;
  seeThrough(t: number): unknown;
}

interface Entry {
  readonly id: string;
  readonly object: Object3D;
  readonly level: BuildLevel;
  readonly api: LensApi | undefined;
  /** Eased values now, and the ends of the running ease. */
  see: number;
  ex: number;
  fromSee: number;
  toSee: number;
  fromEx: number;
  toEx: number;
  /** What was last sent to the asset, so a still part costs nothing. */
  sentSee: number;
  sentEx: number;
  owned: OwnedMaterials | null;
  /** The bench's position for the object, what insight last wrote, and the offset in it. */
  base: Vector3;
  written: Vector3;
  offset: number;
  hasWritten: boolean;
}

const lensApiOf = (o: Object3D): LensApi | undefined => {
  const a = o.userData.xrAsset as Partial<LensApi> | undefined;
  return a && typeof a.explode === 'function' && typeof a.seeThrough === 'function' ? (a as LensApi) : undefined;
};

const WIRE_FADE = 0.15;
const DASH = { dash: 0.0035, gap: 0.0025 } as const;

export interface Insight {
  dispose(): void;
}

export function mountInsight(app: XrApp): Insight {
  const { scale, bench } = app;
  const motion = motionOf(app.world);
  const entries = new Map<string, Entry>();
  /** The whole-build lift amount, eased with the explode lens. */
  let wholeK = 0;
  let fromWhole = 0;
  let toWhole = 0;
  let wireOwned: OwnedMaterials[] = [];
  let needWireRescan = false;
  let lifting = false;

  // ---- dashed connection lines: one draw call ----
  const geometry = new BufferGeometry();
  let capacity = 0;
  let positions = new Float32Array(0);
  let distances = new Float32Array(0);
  const lineMat = new LineDashedMaterial({ color: new Color(INK), dashSize: DASH.dash, gapSize: DASH.gap, transparent: true, opacity: 0 });
  const lines = new LineSegments(geometry, lineMat);
  lines.name = 'insight:wires';
  lines.frustumCulled = false;
  lines.matrixAutoUpdate = false;
  lines.visible = false;
  lines.raycast = () => undefined;
  app.world.scene.add(lines);
  const wireEnds: Array<{ id: string; fromOwner: string; toOwner: string }> = [];
  const _a = new Vector3();
  const _b = new Vector3();

  const ownerOf = (end: { kind: string; c?: string; surface?: string }): string => (end.kind === 'pin' ? (end.c ?? '') : end.kind === 'hole' ? (end.surface ?? '') : '');

  const collectWires = () => {
    wireEnds.length = 0;
    const view = app.project.doc.views.find((v) => v.kind === 'breadboard');
    for (const w of view?.wires ?? []) wireEnds.push({ id: w.id, fromOwner: ownerOf(w.from), toOwner: ownerOf(w.to) });
    if (wireEnds.length > capacity) {
      capacity = wireEnds.length;
      positions = new Float32Array(capacity * 6);
      distances = new Float32Array(capacity * 2);
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      geometry.setAttribute('lineDistance', new BufferAttribute(distances, 1));
    }
  };

  const liftOfOwner = (owner: string): number => {
    const e = entries.get(owner);
    return e ? liftOf(e.level, wholeK) : 0;
  };

  const drawLines = () => {
    let n = 0;
    if (wholeK > 0.002) {
      for (const w of wireEnds) {
        const path = bench.wirePath(w.id);
        if (!path || path.length < 2) continue;
        const p = path[0]!;
        const q = path[path.length - 1]!;
        _a.set(p[0], p[1] + liftOfOwner(w.fromOwner), p[2]);
        _b.set(q[0], q[1] + liftOfOwner(w.toOwner), q[2]);
        const o = n * 6;
        positions[o] = _a.x;
        positions[o + 1] = _a.y;
        positions[o + 2] = _a.z;
        positions[o + 3] = _b.x;
        positions[o + 4] = _b.y;
        positions[o + 5] = _b.z;
        distances[n * 2] = 0;
        distances[n * 2 + 1] = _a.distanceTo(_b);
        n++;
      }
    }
    geometry.setDrawRange(0, n * 2);
    const pos = geometry.getAttribute('position') as BufferAttribute | undefined;
    if (pos) pos.needsUpdate = true;
    const ld = geometry.getAttribute('lineDistance') as BufferAttribute | undefined;
    if (ld) ld.needsUpdate = true;
    lineMat.opacity = wholeK;
    lines.visible = n > 0;
  };

  const _m = new Matrix4();
  const followStage = () => {
    if (!lines.visible) return;
    const root = scale.stage.value.root;
    root.updateWorldMatrix(true, false);
    _m.copy(root.matrixWorld);
    if (!lines.matrix.equals(_m)) {
      lines.matrix.copy(_m);
      lines.matrixWorldNeedsUpdate = true;
    }
  };

  // ---- the real wire tubes fade while the build is taken apart ----
  const restoreWires = () => {
    for (const o of wireOwned) o.restore();
    wireOwned = [];
  };
  const fadeWires = () => {
    if (wholeK <= 0.002) {
      if (wireOwned.length > 0) restoreWires();
      return;
    }
    // A redrawn tube holds the shared material again: take them back and own the current ones.
    if (wireOwned.length === 0 || needWireRescan) {
      restoreWires();
      wireOwned = [ownMaterials(bench.root, (m: Mesh) => typeof m.userData.wireId === 'string')];
      needWireRescan = false;
    }
    const opacity = 1 - (1 - WIRE_FADE) * wholeK;
    for (const o of wireOwned) for (const c of o.clones.values()) setOpacity(c, opacity);
  };

  // ---- per placement ----
  const place = (e: Entry) => {
    const obj = e.object;
    const target = e.level === 0 ? 0 : liftOf(e.level, wholeK);
    if (e.offset === 0 && target === 0) {
      e.hasWritten = false;
      return;
    }
    const cur: [number, number, number] = [obj.position.x, obj.position.y, obj.position.z];
    if (!e.hasWritten || movedByBench(cur, [e.written.x, e.written.y, e.written.z])) e.base.copy(obj.position);
    obj.position.set(e.base.x, e.base.y + target, e.base.z);
    e.written.copy(obj.position);
    e.hasWritten = target !== 0;
    e.offset = target;
  };

  const lensFlat = (e: Entry) => {
    if (e.api) {
      if (Math.abs(e.see - e.sentSee) > 1e-4 || (e.see === 0 && e.sentSee !== 0)) {
        e.api.seeThrough(e.see);
        e.sentSee = e.see;
      }
      if (Math.abs(e.ex - e.sentEx) > 1e-4 || (e.ex === 0 && e.sentEx !== 0)) {
        e.api.explode(e.ex);
        e.sentEx = e.ex;
      }
      return;
    }
    if (e.see > 0) {
      if (!e.owned) e.owned = ownMaterials(e.object);
      const op = bodyOpacity(e.see);
      for (const c of e.owned.clones.values()) setOpacity(c, op);
    } else if (e.owned) {
      e.owned.restore();
      e.owned = null;
    }
    e.sentSee = e.see;
  };

  const render = () => {
    for (const e of entries.values()) {
      lensFlat(e);
      place(e);
    }
    lifting = wholeK > 0;
    for (const e of entries.values()) if (e.offset !== 0) lifting = true;
    fadeWires();
    drawLines();
    followStage();
  };

  // ---- the eases ----
  const retarget = () => {
    const s = scale.seeThrough.value;
    const x = scale.explode.value;
    for (const e of entries.values()) {
      e.toSee = lensAmount(s, e.id);
      e.toEx = lensAmount(x, e.id);
      e.fromSee = e.see;
      e.fromEx = e.ex;
    }
    toWhole = x.part === null ? x.amount : 0;
    fromWhole = wholeK;
  };

  const snapNow = (k: number) => {
    for (const e of entries.values()) {
      e.see = e.fromSee + (e.toSee - e.fromSee) * k;
      e.ex = e.fromEx + (e.toEx - e.fromEx) * k;
    }
    wholeK = fromWhole + (toWhole - fromWhole) * k;
  };

  const run = () => {
    retarget();
    motion.tween({
      key: 'scale/insight',
      ms: fadeMs(app, LENS_MS),
      ease: easeIynk,
      onUpdate: (k) => {
        snapNow(k);
        render();
      },
    });
  };

  // ---- layout ----
  const sync = () => {
    const internals = benchInternals(bench);
    const ids = new Set<string>();
    for (const id of internals ? internals.items.keys() : []) ids.add(id);
    for (const [id, e] of [...entries]) {
      if (!ids.has(id) || bench.objectOf(id) !== e.object) {
        e.owned?.restore();
        entries.delete(id);
      }
    }
    for (const id of ids) {
      if (entries.has(id)) continue;
      const object = bench.objectOf(id);
      if (!object) continue;
      const item = internals!.items.get(id);
      const level = buildLevel(item?.role, item?.seated ?? false, item?.asset.sidecar.kind, id);
      const s = lensAmount(scale.seeThrough.value, id);
      const x = lensAmount(scale.explode.value, id);
      entries.set(id, {
        id, object, level, api: lensApiOf(object),
        see: s, ex: x, fromSee: s, toSee: s, fromEx: x, toEx: x,
        sentSee: -1, sentEx: -1, owned: null,
        base: new Vector3(), written: new Vector3(), offset: 0, hasWritten: false,
      });
    }
    collectWires();
    needWireRescan = true;
    render();
  };

  const offLayout = bench.onLayout(sync);
  const offSee = scale.seeThrough.subscribe(run);
  const offEx = scale.explode.subscribe(run);
  wholeK = scale.explode.value.part === null ? scale.explode.value.amount : 0;
  sync();

  // The bench writes positions while it animates a move: keep the lift on top of them.
  const offFrame = onFrame(app.world, () => {
    if (!lifting) return;
    for (const e of entries.values()) place(e);
    drawLines();
    followStage();
  });

  return {
    dispose() {
      offFrame();
      offLayout();
      offSee();
      offEx();
      motion.cancel('scale/insight');
      // Back to rest: nothing lensed, nothing lifted, materials returned.
      wholeK = 0;
      for (const e of entries.values()) {
        e.see = 0;
        e.ex = 0;
      }
      render();
      for (const e of entries.values()) e.owned?.restore();
      restoreWires();
      entries.clear();
      lines.removeFromParent();
      geometry.dispose();
      lineMat.dispose();
    },
  };
}
