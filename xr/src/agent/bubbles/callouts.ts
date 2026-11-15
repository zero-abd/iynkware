/**
 * Callouts drawn: for each entry of the callout list, a glow ring on the target, an ink leader line up to a bubble
 * (the look kit's callout card, bare) offset up and toward the viewer, billboarded to the camera. The target is a lab
 * item (its drawn group, `lab-item:<id>`, at its top) or a bench part, pin or anchor (`BenchSpace.worldOf`, held in the
 * part's own frame so it follows the part). Tracked every frame with reused vectors: no allocation per frame.
 */
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
  type Object3D,
} from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { modelOf } from '../../lab/model/registry';
import { createCallout, type Callout } from '../../look/callout';
import { onLookFrame } from '../../look/runner';
import { ACCENT, hexNum, INK, STATE } from '../../look/palette';
import type { CalloutList, CalloutSpec, CalloutTone } from './model';

const RING_COLOUR: Readonly<Record<CalloutTone, string>> = { info: STATE.info, do: ACCENT, warn: STATE.bad };
/** Bubble height above the target, metres, plus this much per slot so several do not overlap. */
const LIFT = 0.15;
const LIFT_STEP = 0.075;
const TOWARD = 0.06;

interface Shown {
  readonly spec: CalloutSpec;
  readonly group: Group;
  readonly label: Callout;
  readonly line: Line;
  readonly ring: Mesh;
  anchor: Object3D | null;
  readonly local: Vector3;
}

export function mountCallouts(app: XrApp, list: CalloutList): Unsubscribe {
  const scene = app.world.scene;
  const root = new Group();
  root.name = 'agent:callouts';
  scene.add(root);
  const lineMat = new LineBasicMaterial({ color: hexNum(INK), depthTest: false, toneMapped: false });
  const ringGeo = new RingGeometry(0.012, 0.019, 32);
  const ringMats = Object.fromEntries(
    (Object.keys(RING_COLOUR) as CalloutTone[]).map((t) => [t, new MeshBasicMaterial({ color: hexNum(RING_COLOUR[t]), transparent: true, opacity: 0.85, depthTest: false, side: DoubleSide, toneMapped: false })]),
  ) as Record<CalloutTone, MeshBasicMaterial>;
  const shown = new Map<string, Shown>();
  const box = new Box3();
  const piece = new Box3();

  const resolve = (s: Shown) => {
    const t = s.spec.target;
    if (t.kind === 'lab') {
      s.anchor = scene.getObjectByName(`lab-item:${t.id}`) ?? null;
      s.local.set(0, Math.min(modelOf(t.itemKind).foot[2], 300) / 1000, 0);
      // The top of what is drawn (the item's visual, not its foot box), once it is there.
      const visual = s.anchor?.getObjectByName(`lab-visual:${t.itemKind}`);
      if (s.anchor && visual) {
        visual.updateWorldMatrix(true, true);
        box.makeEmpty();
        visual.traverseVisible((o) => {
          const m = o as Mesh;
          if (!m.isMesh || !m.geometry || (m.material as MeshBasicMaterial).visible === false) return;
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          box.union(piece.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld));
        });
        if (!box.isEmpty()) {
          const footTop = s.local.y;
          s.anchor.worldToLocal(box.getCenter(s.local).setY(box.max.y));
          s.local.y = Math.min(s.local.y, footTop);
        }
      }
      return;
    }
    const at = app.bench.worldOf(t.target);
    const part = 'part' in t.target ? t.target.part : undefined;
    s.anchor = at ? ((part && app.bench.objectOf(part)) || app.bench.root) : null;
    if (at && s.anchor) {
      s.anchor.updateWorldMatrix(true, false);
      s.anchor.worldToLocal(s.local.set(at[0], at[1], at[2]));
    }
  };

  const add = (spec: CalloutSpec) => {
    const group = new Group();
    group.name = `agent-callout:${spec.id}`;
    const label = createCallout(spec.text, { bare: true, shape: 'card', tone: spec.tone, distance: 0.85, lean: 0 });
    label.group.name = 'agent-callout-label';
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    const line = new Line(geo, lineMat);
    line.name = 'agent-callout-leader';
    line.frustumCulled = false;
    line.renderOrder = 10;
    const ring = new Mesh(ringGeo, ringMats[spec.tone]);
    ring.name = 'agent-callout-ring';
    ring.renderOrder = 10;
    group.add(line, ring, label.group);
    root.add(group);
    const s: Shown = { spec, group, label, line, ring, anchor: null, local: new Vector3() };
    resolve(s);
    shown.set(spec.id, s);
  };
  const remove = (id: string) => {
    const s = shown.get(id);
    if (!s) return;
    s.label.dispose();
    s.line.geometry.dispose();
    s.group.removeFromParent();
    shown.delete(id);
  };
  const sync = () => {
    for (const id of [...shown.keys()]) if (!list.list.some((c) => c.id === id)) remove(id);
    for (const c of list.list) if (!shown.has(c.id)) add(c);
  };
  const offList = list.subscribe(sync);
  const offLayout = app.bench.onLayout(() => {
    for (const s of shown.values()) if (s.spec.target.kind === 'bench') resolve(s);
  });
  sync();

  const tp = new Vector3();
  const cam = new Vector3();
  const toward = new Vector3();
  const q = new Quaternion();
  let clock = 0;
  const offFrame = onLookFrame(app.world, (dt) => {
    list.prune();
    if (shown.size === 0) return;
    clock += dt;
    const camera = app.world.camera;
    camera.getWorldPosition(cam);
    camera.getWorldQuaternion(q);
    let slot = 0;
    for (const c of list.list) {
      const s = shown.get(c.id);
      if (!s) continue;
      if (s.spec.target.kind === 'lab' && !s.anchor?.parent) s.anchor = null;
      if (!s.anchor) resolve(s);
      // A target on the hidden circuit bench (a lab is open) or gone: no callout.
      const visible = !!s.anchor && (s.spec.target.kind === 'lab' || app.bench.root.visible);
      s.group.visible = visible;
      if (!visible) continue;
      s.anchor!.localToWorld(tp.copy(s.local));
      toward.set(cam.x - tp.x, 0, cam.z - tp.z);
      if (toward.lengthSq() > 1e-6) toward.normalize().multiplyScalar(TOWARD);
      const lift = LIFT + slot * LIFT_STEP;
      slot++;
      s.label.group.position.set(tp.x + toward.x, tp.y + lift, tp.z + toward.z);
      s.label.group.quaternion.copy(q);
      s.ring.position.copy(tp);
      s.ring.quaternion.copy(q);
      s.ring.scale.setScalar(1 + 0.18 * Math.sin(clock * 5));
      const a = s.line.geometry.getAttribute('position') as Float32BufferAttribute;
      a.setXYZ(0, tp.x, tp.y, tp.z);
      a.setXYZ(1, tp.x + toward.x, tp.y + lift - s.label.height / 2, tp.z + toward.z);
      a.needsUpdate = true;
    }
  });

  return () => {
    offFrame();
    offList();
    offLayout();
    for (const id of [...shown.keys()]) remove(id);
    root.removeFromParent();
    lineMat.dispose();
    ringGeo.dispose();
    for (const m of Object.values(ringMats)) m.dispose();
  };
}
