/**
 * The bench space: lays the project's breadboard view out in 3D from the placements, leg holes and wires, and converts
 * between document millimetres, the board frame and the world. Contract: contracts/space.ts.
 *
 * Rebuilds the whole layout on every document change for now (a skeleton: diffing by `DocChange.touched` is issue
 * work). Part objects carry `userData.partId`.
 *
 * Placement: a board or surface goes where its asset's `footprint` corner meets the document's (x_mm, y_mm), turned
 * about that corner by `rotation_deg`; a leaded part is seated so its first two leg anchors sit in their holes. Anchor
 * ids are the sidecar's (contracts/assets.ts): pins and holes by their simulation id.
 */
import {
  BoxGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  QuadraticBezierCurve3,
  TubeGeometry,
  Vector3,
  type Object3D,
} from '@iwsdk/core';
import type { AssetRegistry, PartAsset } from '../contracts/assets';
import type { Unsubscribe, Vec3 } from '../contracts/common';
import type { Project, ProjectStore } from '../contracts/project';
import type { BenchSpace, BoardTarget } from '../contracts/space';
import { value } from '../ui/value';

type View = Project['views'][number];
type Placement = NonNullable<View['placements']>[number];
type Wire = NonNullable<View['wires']>[number];
type WireEnd = Wire['from'];

export const WIRE_COLOURS: Record<string, number> = {
  red: 0xd8342c, black: 0x2b2722, orange: 0xf28c28, yellow: 0xf2c230, green: 0x2e9d4f,
  blue: 0x2f6fd8, purple: 0x8a4fd0, white: 0xeeeae0, grey: 0x8b8b8b, brown: 0x7a4b2a,
};

const _v = new Vector3();
const _w = new Vector3();
const Y_AXIS = new Vector3(0, 1, 0);

export interface BenchSpaceOptions {
  project: ProjectStore;
  assets: AssetRegistry;
  /** Initial pose of the bench top centre and the initial board scale. */
  benchTop?: { position: Vec3; yawRad: number };
  scale?: number;
}

export interface BenchSpaceImpl extends BenchSpace {
  /** Resolves after the first layout. */
  readonly ready: Promise<void>;
  dispose(): void;
}

export function createBenchSpace(opts: BenchSpaceOptions): BenchSpaceImpl {
  const root = new Group();
  root.name = 'board';
  const table = new Group();
  table.name = 'bench';
  const slab = new Mesh(new BoxGeometry(1.1, 0.03, 0.6), new MeshStandardMaterial({ color: 0xc9b48f, roughness: 0.9 }));
  slab.position.y = -0.015;
  table.add(slab);

  const scale = value(opts.scale ?? 4);
  const benchTop = value(opts.benchTop ?? { position: [0, 0.74, -0.6] as Vec3, yawRad: 0 });
  const parts = new Map<string, Object3D>();
  const assetsOf = new Map<string, PartAsset>();
  const wires = new Map<string, Vec3>();
  const layoutFns = new Set<() => void>();
  let centre = new Vector3();
  let generation = 0;

  const placeRoot = () => {
    const { position, yawRad } = benchTop.value;
    table.position.set(position[0], position[1], position[2]);
    table.rotation.set(0, yawRad, 0);
    root.scale.setScalar(scale.value);
    root.rotation.set(0, yawRad, 0);
    _v.copy(centre).multiplyScalar(scale.value).applyAxisAngle(Y_AXIS, yawRad);
    root.position.set(position[0] - _v.x, position[1], position[2] - _v.z);
    root.updateMatrixWorld(true);
  };

  const breadboardView = (doc: Project): View | undefined => doc.views.find((v) => v.kind === 'breadboard');

  const anchorBoard = (partId: string, anchor: string, out: Vector3): Vector3 | null => {
    const obj = parts.get(partId);
    const a = assetsOf.get(partId)?.anchors.get(anchor);
    if (!obj || !a) return null;
    out.set(a.position[0], a.position[1], a.position[2]);
    obj.updateMatrix();
    return out.applyMatrix4(obj.matrix);
  };

  const endBoard = (end: WireEnd, out: Vector3): Vector3 | null => {
    if (end.kind === 'pin') return anchorBoard(end.c, end.p, out);
    if (end.kind === 'hole') return anchorBoard(end.surface, end.hole, out);
    return null;
  };

  async function layout() {
    const gen = ++generation;
    const doc = opts.project.doc;
    const view = breadboardView(doc);
    const placements = view?.placements ?? [];
    const refOf = new Map<string, { ref: string; version: string }>();
    for (const b of doc.boards) refOf.set(b.id, b.definition);
    for (const c of doc.components) refOf.set(c.id, c.definition);
    const resolved = await Promise.all(
      placements.map(async (p) => {
        const def = refOf.get(p.c);
        return def ? { p, asset: await opts.assets.get(def.ref, def.version).catch(() => null) } : null;
      }),
    );
    if (gen !== generation) return;

    root.clear();
    parts.clear();
    assetsOf.clear();
    wires.clear();
    // Surfaces and boards first (placed by x_mm, y_mm), then parts seated by their legs.
    const seated: Array<{ p: Placement; asset: PartAsset }> = [];
    for (const r of resolved) {
      if (!r?.asset) continue;
      if (r.p.legs && Object.keys(r.p.legs).length > 0) {
        seated.push({ p: r.p, asset: r.asset });
        continue;
      }
      const obj = r.asset.instantiate();
      const yaw = (-(r.p.rotation_deg ?? 0) * Math.PI) / 180;
      const fp = r.asset.footprint;
      // The footprint corner sits on (x_mm, y_mm); the part turns about it.
      _w.set(-fp.x, 0, -fp.z).applyAxisAngle(Y_AXIS, yaw);
      obj.position.set(r.p.x_mm / 1000 + _w.x, 0, r.p.y_mm / 1000 + _w.z);
      obj.rotation.y = yaw;
      add(r.p.c, obj, r.asset);
    }
    const surface = view?.surface;
    for (const { p, asset } of seated) {
      const obj = asset.instantiate();
      const legs = Object.entries(p.legs ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string');
      const holeAt = (hole: string, out: Vector3) => (surface ? anchorBoard(surface, hole, out) : null);
      const [first, second] = legs;
      const h1 = first ? holeAt(first[1], new Vector3()) : null;
      const a1 = first ? asset.anchors.get(first[0]) : undefined;
      if (!h1 || !a1) continue;
      let yaw = 0;
      const h2 = second ? holeAt(second[1], new Vector3()) : null;
      const a2 = second ? asset.anchors.get(second[0]) : undefined;
      if (h2 && a2) {
        const want = Math.atan2(h2.z - h1.z, h2.x - h1.x);
        const have = Math.atan2(a2.position[2] - a1.position[2], a2.position[0] - a1.position[0]);
        yaw = -(want - have);
      }
      obj.rotation.y = yaw;
      _w.set(a1.position[0], a1.position[1], a1.position[2]).applyMatrix4(new Matrix4().makeRotationY(yaw));
      obj.position.copy(h1).sub(_w);
      add(p.c, obj, asset);
    }
    for (const w of view?.wires ?? []) drawWire(w);

    const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const [id, obj] of parts) {
      const { min, max } = assetsOf.get(id)!.sidecar.bounds;
      for (const x of [min[0], max[0]]) for (const z of [min[2], max[2]]) {
        _v.set(x, 0, z).applyAxisAngle(Y_AXIS, obj.rotation.y).add(obj.position);
        box.minX = Math.min(box.minX, _v.x);
        box.maxX = Math.max(box.maxX, _v.x);
        box.minZ = Math.min(box.minZ, _v.z);
        box.maxZ = Math.max(box.maxZ, _v.z);
      }
    }
    centre = Number.isFinite(box.minX) ? new Vector3((box.minX + box.maxX) / 2, 0, (box.minZ + box.maxZ) / 2) : new Vector3();
    placeRoot();
    for (const fn of [...layoutFns]) fn();
  }

  function add(id: string, obj: Object3D, asset: PartAsset) {
    obj.userData.partId = id;
    obj.name = id;
    root.add(obj);
    obj.updateMatrix();
    parts.set(id, obj);
    assetsOf.set(id, asset);
  }

  function drawWire(w: Wire) {
    const a = endBoard(w.from, new Vector3());
    const b = endBoard(w.to, new Vector3());
    if (!a || !b) return;
    const ctrl = a.clone().add(b).multiplyScalar(0.5);
    ctrl.y = Math.max(a.y, b.y) + 0.007 + a.distanceTo(b) * 0.18;
    const curve = new QuadraticBezierCurve3(a, ctrl, b);
    const colour = new Color(WIRE_COLOURS[w.color ?? ''] ?? WIRE_COLOURS.orange);
    const mesh = new Mesh(new TubeGeometry(curve, 20, 0.0009, 6, false), new MeshStandardMaterial({ color: colour, roughness: 0.6 }));
    mesh.name = w.id;
    mesh.userData.wireId = w.id;
    root.add(mesh);
    const mid = curve.getPoint(0.5);
    wires.set(w.id, [mid.x, mid.y, mid.z]);
  }

  const unsub = opts.project.subscribe(() => void layout());
  const ready = layout();
  scale.subscribe(placeRoot);
  benchTop.subscribe(placeRoot);

  const toWorld = (p: Vector3): Vec3 => {
    root.updateMatrixWorld(true);
    p.applyMatrix4(root.matrixWorld);
    return [p.x, p.y, p.z];
  };

  return {
    root,
    table,
    ready,
    scale,
    benchTop,
    setScale(next) {
      scale.set(Math.min(40, Math.max(0.25, next)));
    },
    setBenchTop(pose) {
      benchTop.set(pose);
    },
    docToBoard: (xMm, yMm, heightMm = 0) => [xMm / 1000, heightMm / 1000, yMm / 1000],
    boardToDoc: (p) => ({ xMm: p[0] * 1000, yMm: p[2] * 1000, heightMm: p[1] * 1000 }),
    worldOf(target: BoardTarget): Vec3 | null {
      const v = new Vector3();
      switch (target.kind) {
        case 'part': {
          // The part's tag (`label:<part>` naming the item) when the sidecar has one, else the top of its bounds.
          const obj = parts.get(target.part);
          const a = assetsOf.get(target.part);
          if (!obj || !a) return null;
          const tag = a.sidecar.anchors.find((x) => x.kind === 'label' && x.layer !== 'xray');
          if (tag && anchorBoard(target.part, tag.id, v)) return toWorld(v);
          const { min, max } = a.sidecar.bounds;
          v.set((min[0] + max[0]) / 2, max[1], (min[2] + max[2]) / 2);
          obj.updateMatrix();
          return toWorld(v.applyMatrix4(obj.matrix));
        }
        case 'pin':
          return anchorBoard(target.part, target.pin, v) ? toWorld(v) : null;
        case 'hole':
          return anchorBoard(target.surface, target.hole, v) ? toWorld(v) : null;
        case 'anchor':
          return anchorBoard(target.part, target.anchor, v) ? toWorld(v) : null;
        case 'wire': {
          const mid = wires.get(target.wire);
          return mid ? toWorld(v.set(mid[0], mid[1], mid[2])) : null;
        }
      }
    },
    objectOf: (id) => parts.get(id),
    partOf(object) {
      for (let o: Object3D | null = object; o; o = o.parent) if (typeof o.userData.partId === 'string') return o.userData.partId;
      return undefined;
    },
    onLayout(fn): Unsubscribe {
      layoutFns.add(fn);
      return () => layoutFns.delete(fn);
    },
    dispose() {
      unsub();
      root.removeFromParent();
      table.removeFromParent();
    },
  };
}
