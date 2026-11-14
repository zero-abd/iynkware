/**
 * The bench space: lays the project's breadboard view out in 3D from the placements, leg holes and wires, and converts
 * between document millimetres, the board frame and the world. Contract: contracts/space.ts.
 *
 * Incremental layout. Every placed item keeps one Object3D (keyed by its entity id) across document changes. On each
 * change the breadboard view is resolved again into target poses: an item whose pose and definition are unchanged is
 * left untouched (same instance, no transform written), a moved one is handed its new pose, a changed definition
 * (`ref@version`) re-instantiates, and a removed one leaves `root` and disposes only what its placement owns (the
 * materials of its channel nodes; shared geometry and materials never). Seated parts follow their surface. Assets are
 * cached by `ref@version`, so a change whose assets are known is laid out synchronously, inside `project.apply`; one
 * that waits for an asset is dropped when a newer change arrives first (the newest document always wins). A change that
 * leaves the view, boards, components and dependencies the same objects (the store shares what an op did not touch, which
 * is also what `DocChange.touched` is computed from) is skipped; nothing else depends on `touched`.
 *
 * Still frame. `root` is offset so the layout's bounds are centred on the bench top, computed only when a document is
 * opened (the first layout, and a change with `origin: 'load'`), so an edit never moves anything else.
 *
 * Placement: a board or surface goes where its asset's `footprint` corner meets the document's (x_mm, y_mm), turned
 * about that corner by `rotation_deg`; a leaded part is seated so its first two leg anchors sit in their holes. Anchor
 * ids are the sidecar's (contracts/assets.ts): pins and holes by their simulation id. Part objects carry
 * `userData.partId` while they are laid out.
 *
 * Bench internals, for the bench sub-modules (which get `app.bench` typed as the contract): `benchInternals(app.bench)`
 * gives, read-only,
 *   items          the laid-out items by id: role (`surface` | `board` | `part`), `PartAsset`, Object3D, `seated`,
 *                  `legs`, and `target`, the board-frame pose the document gives it (the end of any transition).
 *   anchorBoard    an anchor's board-frame position at its item's target pose, written into `out` (no allocation).
 *   viewId, surface  the breadboard view's id and its surface component.
 *   onItems        after each layout: the ids added (including an id whose definition changed, which has a new
 *                  object), moved (a new target pose, including seated parts whose surface moved) and removed.
 *   setWireRenderer  replaces how wires are drawn (null restores the default, one tube per wire). The renderer is told
 *                  about a wire when it is new or changed or an end's item was added, moved or removed.
 *   setTransition  a hook `(item, from, to, kind, done)` that animates an add, move or remove. `from` is the object's
 *                  pose now (null for add), `to` its target (null for remove); both are board frame and the hook's to
 *                  keep. Without a hook, items jump and removed ones leave at once. With one, an added object is in
 *                  `root` at its target and a moved one where it was; the hook moves it and calls `done()` once, which
 *                  snaps it to its target (or, for remove, takes it out of `root` and disposes it). A newer transition
 *                  of the same item supersedes an older one, whose `done` is then ignored. Replacing the hook finishes
 *                  every running transition. Transitions start after the layout pass, so the hook sees it whole.
 *   restore        sends an item's object back to its target as a `move` (a hand moved it, the edit changed nothing).
 *   settled        resolves when the newest change is laid out.
 * `objectOf`, `partOf`, `worldOf` and `onLayout` follow the contract; `worldOf`, `anchorBoard` and wires read target
 * poses, not where a running transition has an object.
 */
import {
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  QuadraticBezierCurve3,
  Quaternion,
  TubeGeometry,
  Vector3,
  type Material,
  type Object3D,
} from '@iwsdk/core';
import type { AssetRegistry, PartAsset } from '../contracts/assets';
import type { Unsubscribe, Vec3 } from '../contracts/common';
import type { DocChange, Project, ProjectStore } from '../contracts/project';
import type { BenchSpace, BoardTarget } from '../contracts/space';
import { value } from '../ui/value';

type View = Project['views'][number];
type Placement = NonNullable<View['placements']>[number];
type Def = Project['components'][number]['definition'];
/** A wire of the breadboard view, as the document has it. */
export type BenchWire = NonNullable<View['wires']>[number];
type WireEnd = BenchWire['from'];

export const WIRE_COLOURS: Record<string, number> = {
  red: 0xd8342c, black: 0x2b2722, orange: 0xf28c28, yellow: 0xf2c230, green: 0x2e9d4f,
  blue: 0x2f6fd8, purple: 0x8a4fd0, white: 0xeeeae0, grey: 0x8b8b8b, brown: 0x7a4b2a,
};

export type BenchRole = 'surface' | 'board' | 'part';

/** A pose in the board frame (`root`'s local frame); scale is always 1. */
export interface BenchPose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

/** One laid-out item. Read-only: the bench owns every field. */
export interface BenchItem {
  readonly id: string;
  readonly role: BenchRole;
  readonly asset: PartAsset;
  readonly object: Object3D;
  /** Seated by its legs in the view's surface. */
  readonly seated: boolean;
  readonly legs: Readonly<Record<string, string>> | undefined;
  /** Where the document puts it: the end of any running transition. */
  readonly target: BenchPose;
}

export interface ItemsChange {
  readonly added: readonly string[];
  readonly moved: readonly string[];
  readonly removed: readonly string[];
}

export type TransitionKind = 'add' | 'move' | 'remove';
export type Transition = (item: BenchItem, from: BenchPose | null, to: BenchPose | null, kind: TransitionKind, done: () => void) => void;

/** Draws the view's wires in `root` (board frame). The end points are reused between calls: copy what you keep. */
export interface WireRenderer {
  /** A wire that is new, changed, or whose end item was added, moved or removed. An end is null when it is not on the bench. */
  draw(wire: BenchWire, from: Vector3 | null, to: Vector3 | null): void;
  /** The wire left the view. */
  erase(wireId: string): void;
  /** A board-frame point on the wire for `worldOf({ kind: 'wire' })`, written into `out`, or null when it is not drawn. */
  pointOf(wireId: string, out: Vector3): Vector3 | null;
  /** The renderer is replaced or the bench is disposed: take every wire out. */
  dispose(): void;
}

export interface BenchInternals {
  readonly items: ReadonlyMap<string, BenchItem>;
  anchorBoard(partId: string, anchorId: string, out: Vector3): Vector3 | null;
  readonly viewId: string | undefined;
  readonly surface: string | undefined;
  onItems(fn: (change: ItemsChange) => void): Unsubscribe;
  setWireRenderer(renderer: WireRenderer | null): void;
  setTransition(hook: Transition | null): void;
  /** Sends an item's object back to its target as a `move` transition (after a hand moved it and the edit was refused or changed nothing). */
  restore(partId: string): void;
  settled(): Promise<void>;
}

const internals = new WeakMap<BenchSpace, BenchInternals>();

/** The bench's read-only internals for bench sub-modules, or undefined for a BenchSpace this file did not create. */
export function benchInternals(bench: BenchSpace): BenchInternals | undefined {
  return internals.get(bench);
}

const _v = new Vector3();
const _w = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _h1 = new Vector3();
const _h2 = new Vector3();
const _m = new Matrix4();
const ONE = new Vector3(1, 1, 1);
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

/** What one layout pass wants for an item. */
interface Plan {
  id: string;
  role: BenchRole;
  key: string;
  asset: PartAsset;
  seated: boolean;
  legs: Readonly<Record<string, string>> | undefined;
  position: Vector3;
  quaternion: Quaternion;
  matrix: Matrix4;
}

interface Rec {
  readonly id: string;
  role: BenchRole;
  readonly key: string;
  readonly asset: PartAsset;
  readonly object: Object3D;
  seated: boolean;
  legs: Readonly<Record<string, string>> | undefined;
  readonly target: { readonly position: Vector3; readonly quaternion: Quaternion };
  /** `target` as a matrix, for anchors. */
  readonly matrix: Matrix4;
  /** The current transition; a `done` of an older one is ignored. */
  token: number;
}

const keyOf = (def: Def) => `${def.ref}@${def.version}`;

function anchorAt(matrix: Matrix4, asset: PartAsset, anchor: string, out: Vector3): Vector3 | null {
  const a = asset.anchors.get(anchor);
  if (!a) return null;
  return out.set(a.position[0], a.position[1], a.position[2]).applyMatrix4(matrix);
}

const samePose = (a: BenchPose, b: BenchPose) =>
  a.position.distanceToSquared(b.position) < 1e-14 && Math.abs(a.quaternion.dot(b.quaternion)) > 1 - 1e-12;

const poseOf = (o: Object3D): BenchPose => ({ position: o.position.clone(), quaternion: o.quaternion.clone() });

function setPose(o: Object3D, pose: BenchPose) {
  o.position.copy(pose.position);
  o.quaternion.copy(pose.quaternion);
  o.scale.copy(ONE);
  o.updateMatrix();
}

/** Disposes the materials a placement owns: those of its channel nodes (contracts/assets.ts `instantiate`). */
function disposeOwned(asset: PartAsset, object: Object3D) {
  const seen = new Set<Material>();
  for (const ch of asset.sidecar.channels) {
    for (const name of ch.nodes) {
      object.getObjectByName(name)?.traverse((o) => {
        const m = (o as Mesh).material;
        if (m) for (const x of Array.isArray(m) ? m : [m]) seen.add(x);
      });
    }
  }
  for (const m of seen) m.dispose();
}

/** Today's wires: one tube per wire arching between its ends, one shared material per colour. */
function tubeRenderer(root: Object3D): WireRenderer {
  const meshes = new Map<string, Mesh>();
  const mids = new Map<string, Vector3>();
  const materials = new Map<number, MeshStandardMaterial>();
  const erase = (id: string) => {
    const mesh = meshes.get(id);
    if (!mesh) return;
    mesh.removeFromParent();
    mesh.geometry.dispose();
    meshes.delete(id);
    mids.delete(id);
  };
  return {
    draw(w, from, to) {
      if (!from || !to) return erase(w.id);
      const a = from.clone();
      const b = to.clone();
      const ctrl = a.clone().add(b).multiplyScalar(0.5);
      ctrl.y = Math.max(a.y, b.y) + 0.007 + a.distanceTo(b) * 0.18;
      const curve = new QuadraticBezierCurve3(a, ctrl, b);
      const colour = WIRE_COLOURS[w.color ?? ''] ?? WIRE_COLOURS.orange!;
      let material = materials.get(colour);
      if (!material) materials.set(colour, (material = new MeshStandardMaterial({ color: new Color(colour), roughness: 0.6 })));
      const geometry = new TubeGeometry(curve, 20, 0.0009, 6, false);
      let mesh = meshes.get(w.id);
      if (mesh) {
        mesh.geometry.dispose();
        mesh.geometry = geometry;
        mesh.material = material;
      } else {
        mesh = new Mesh(geometry, material);
        mesh.name = w.id;
        mesh.userData.wireId = w.id;
        meshes.set(w.id, mesh);
        root.add(mesh);
      }
      mids.set(w.id, curve.getPoint(0.5));
    },
    erase,
    pointOf(id, out) {
      const mid = mids.get(id);
      return mid ? out.copy(mid) : null;
    },
    dispose() {
      for (const id of [...meshes.keys()]) erase(id);
      for (const m of materials.values()) m.dispose();
      materials.clear();
    },
  };
}

export function createBenchSpace(opts: BenchSpaceOptions): BenchSpaceImpl {
  const root = new Group();
  root.name = 'board';
  // The bench top's own frame. It draws nothing itself: the look kit lays the inked work mat and rail in it
  // (look/bench.ts), so in passthrough the real table shows under the mat instead of a slab.
  const table = new Group();
  table.name = 'bench';

  const scale = value(opts.scale ?? 4);
  const benchTop = value(opts.benchTop ?? { position: [0, 0.74, -0.6] as Vec3, yawRad: 0 });
  const items = new Map<string, Rec>();
  const assetCache = new Map<string, PartAsset | null>();
  const layoutFns = new Set<() => void>();
  const itemFns = new Set<(change: ItemsChange) => void>();
  /** Running transitions, so replacing the hook or disposing can finish them. */
  const running = new Map<Rec, TransitionKind>();
  /** The wire objects last drawn, by id. */
  const drawnWires = new Map<string, BenchWire>();
  let wires: WireRenderer = tubeRenderer(root);
  let transition: Transition | null = null;
  const centre = new Vector3();
  let recentre = true;
  let generation = 0;
  let laidOut = 0;
  let last: { view: View | undefined; boards: unknown; components: unknown; deps: unknown } | null = null;
  let viewId: string | undefined;
  let surfaceId: string | undefined;
  let settleFns: Array<() => void> = [];
  let markReady!: () => void;
  const ready = new Promise<void>((r) => (markReady = r));

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
    const rec = items.get(partId);
    return rec ? anchorAt(rec.matrix, rec.asset, anchor, out) : null;
  };

  const endPart = (end: WireEnd): string => (end.kind === 'pin' ? end.c : end.kind === 'hole' ? end.surface : '');
  const endBoard = (end: WireEnd, out: Vector3): Vector3 | null => {
    if (end.kind === 'pin') return anchorBoard(end.c, end.p, out);
    if (end.kind === 'hole') return anchorBoard(end.surface, end.hole, out);
    return null;
  };

  /** Target poses for every placement of the view whose asset is known. */
  function plan(doc: Project, view: View | undefined): Map<string, Plan> {
    const out = new Map<string, Plan>();
    if (!view) return out;
    const defOf = new Map<string, Def>();
    for (const b of doc.boards) defOf.set(b.id, b.definition);
    for (const c of doc.components) defOf.set(c.id, c.definition);
    const boards = new Set(doc.boards.map((b) => b.id));
    const roles = new Map<string, BenchRole>();
    for (const d of doc.dependencies.components) roles.set(`${d.ref}@${d.version}`, d.interface.role);
    const roleOf = (id: string, key: string): BenchRole =>
      id === view.surface ? 'surface' : (roles.get(key) ?? (boards.has(id) ? 'board' : 'part'));

    // Surfaces and boards first (placed by x_mm, y_mm), then parts seated by their legs.
    const seated: Array<{ p: Placement; key: string; asset: PartAsset; legs: Array<[string, string]> }> = [];
    for (const p of view.placements ?? []) {
      const def = defOf.get(p.c);
      const key = def && keyOf(def);
      const asset = key ? assetCache.get(key) : undefined;
      if (!key || !asset) continue;
      const legs = Object.entries(p.legs ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string');
      if (legs.length > 0) {
        seated.push({ p, key, asset, legs });
        continue;
      }
      const yaw = (-(p.rotation_deg ?? 0) * Math.PI) / 180;
      const fp = asset.footprint;
      // The footprint corner sits on (x_mm, y_mm); the part turns about it.
      _w.set(-fp.x, 0, -fp.z).applyAxisAngle(Y_AXIS, yaw);
      const position = new Vector3(p.x_mm / 1000 + _w.x, 0, p.y_mm / 1000 + _w.z);
      const quaternion = new Quaternion().setFromAxisAngle(Y_AXIS, yaw);
      out.set(p.c, {
        id: p.c, role: roleOf(p.c, key), key, asset, seated: false, legs: undefined,
        position, quaternion, matrix: new Matrix4().compose(position, quaternion, ONE),
      });
    }
    const surface = view.surface ? out.get(view.surface) : undefined;
    for (const { p, key, asset, legs } of seated) {
      if (!surface) continue;
      const [first, second] = legs;
      const h1 = first ? anchorAt(surface.matrix, surface.asset, first[1], _h1) : null;
      const a1 = first ? asset.anchors.get(first[0]) : undefined;
      if (!h1 || !a1) continue;
      let yaw = 0;
      const h2 = second ? anchorAt(surface.matrix, surface.asset, second[1], _h2) : null;
      const a2 = second ? asset.anchors.get(second[0]) : undefined;
      if (h2 && a2) {
        const want = Math.atan2(h2.z - h1.z, h2.x - h1.x);
        const have = Math.atan2(a2.position[2] - a1.position[2], a2.position[0] - a1.position[0]);
        yaw = -(want - have);
      }
      _w.set(a1.position[0], a1.position[1], a1.position[2]).applyMatrix4(_m.makeRotationY(yaw));
      const position = h1.clone().sub(_w);
      const quaternion = new Quaternion().setFromAxisAngle(Y_AXIS, yaw);
      out.set(p.c, {
        id: p.c, role: roleOf(p.c, key), key, asset, seated: true, legs: Object.freeze(Object.fromEntries(legs)),
        position, quaternion, matrix: new Matrix4().compose(position, quaternion, ONE),
      });
    }
    return out;
  }

  function finish(rec: Rec, kind: TransitionKind) {
    running.delete(rec);
    if (kind === 'remove') {
      rec.object.removeFromParent();
      disposeOwned(rec.asset, rec.object);
    } else setPose(rec.object, rec.target);
  }

  function transit(rec: Rec, kind: TransitionKind, from: BenchPose | null) {
    const token = ++rec.token;
    const done = () => {
      if (rec.token === token && running.get(rec) === kind) finish(rec, kind);
    };
    running.set(rec, kind);
    const hook = transition;
    if (!hook) return done();
    const to = kind === 'remove' ? null : { position: rec.target.position.clone(), quaternion: rec.target.quaternion.clone() };
    try {
      hook(rec, from, to, kind, done);
    } catch (err) {
      console.error('[iynkware] bench transition', err);
      done();
    }
  }

  /** Takes an item out of the layout: `objectOf` and `partOf` stop naming it. */
  function release(rec: Rec) {
    items.delete(rec.id);
    delete rec.object.userData.partId;
  }

  function apply(doc: Project, view: View | undefined) {
    const next = plan(doc, view);
    const added: string[] = [];
    const moved: string[] = [];
    const removed: string[] = [];
    // Transitions start once the whole layout is consistent, so a hook may read the internals.
    const transits: Array<[Rec, TransitionKind, BenchPose | null]> = [];
    for (const rec of [...items.values()]) {
      if (next.has(rec.id)) continue;
      release(rec);
      removed.push(rec.id);
      transits.push([rec, 'remove', poseOf(rec.object)]);
    }
    for (const want of next.values()) {
      const rec = items.get(want.id);
      if (rec && rec.key === want.key) {
        rec.role = want.role;
        rec.seated = want.seated;
        rec.legs = want.legs;
        if (samePose(rec.target, want)) continue;
        rec.target.position.copy(want.position);
        rec.target.quaternion.copy(want.quaternion);
        rec.matrix.copy(want.matrix);
        moved.push(want.id);
        transits.push([rec, 'move', poseOf(rec.object)]);
        continue;
      }
      if (rec) {
        // Another definition: the old object goes now and a new one comes.
        release(rec);
        rec.token++;
        finish(rec, 'remove');
      }
      const object = want.asset.instantiate();
      object.userData.partId = want.id;
      object.name = want.id;
      const fresh: Rec = {
        id: want.id, role: want.role, key: want.key, asset: want.asset, object, seated: want.seated, legs: want.legs,
        target: { position: want.position, quaternion: want.quaternion }, matrix: want.matrix, token: 0,
      };
      setPose(object, fresh.target);
      root.add(object);
      items.set(want.id, fresh);
      added.push(want.id);
      transits.push([fresh, 'add', null]);
    }

    if (recentre) {
      recentre = false;
      const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (const rec of items.values()) {
        const { min, max } = rec.asset.sidecar.bounds;
        for (const x of [min[0], max[0]]) for (const z of [min[2], max[2]]) {
          _v.set(x, 0, z).applyQuaternion(rec.target.quaternion).add(rec.target.position);
          box.minX = Math.min(box.minX, _v.x);
          box.maxX = Math.max(box.maxX, _v.x);
          box.minZ = Math.min(box.minZ, _v.z);
          box.maxZ = Math.max(box.maxZ, _v.z);
        }
      }
      if (Number.isFinite(box.minX)) centre.set((box.minX + box.maxX) / 2, 0, (box.minZ + box.maxZ) / 2);
      else centre.set(0, 0, 0);
      placeRoot();
    }

    const changed = new Set([...added, ...moved, ...removed]);
    const now = new Set<string>();
    for (const w of view?.wires ?? []) {
      now.add(w.id);
      if (drawnWires.get(w.id) === w && !changed.has(endPart(w.from)) && !changed.has(endPart(w.to))) continue;
      drawnWires.set(w.id, w);
      wires.draw(w, endBoard(w.from, _a), endBoard(w.to, _b));
    }
    for (const id of [...drawnWires.keys()]) {
      if (now.has(id)) continue;
      drawnWires.delete(id);
      wires.erase(id);
    }

    viewId = view?.id;
    surfaceId = view?.surface;
    last = { view, boards: doc.boards, components: doc.components, deps: doc.dependencies };
    for (const [rec, kind, from] of transits) transit(rec, kind, from);
    const change: ItemsChange = { added, moved, removed };
    for (const fn of [...itemFns]) fn(change);
    for (const fn of [...layoutFns]) fn();
  }

  function settle(gen: number) {
    // A listener may apply a change inside a layout, which is then laid out before this one returns.
    laidOut = Math.max(laidOut, gen);
    if (laidOut !== generation) return;
    markReady();
    const fns = settleFns;
    settleFns = [];
    for (const fn of fns) fn();
  }

  async function layout() {
    const gen = ++generation;
    const doc = opts.project.doc;
    const view = breadboardView(doc);
    if (!recentre && last && last.view === view && last.boards === doc.boards && last.components === doc.components && last.deps === doc.dependencies) {
      return settle(gen);
    }
    const missing = new Map<string, Def>();
    const need = (def: Def) => {
      const key = keyOf(def);
      if (!assetCache.has(key)) missing.set(key, def);
    };
    const placed = new Set((view?.placements ?? []).map((p) => p.c));
    for (const b of doc.boards) if (placed.has(b.id)) need(b.definition);
    for (const c of doc.components) if (placed.has(c.id)) need(c.definition);
    if (missing.size > 0) {
      await Promise.all(
        [...missing].map(async ([key, def]) => {
          const asset = await opts.assets.get(def.ref, def.version).catch(() => null);
          if (!assetCache.get(key)) assetCache.set(key, asset);
        }),
      );
      // A newer change is laid out instead.
      if (gen !== generation) return;
    }
    try {
      apply(doc, view);
    } finally {
      settle(gen);
    }
  }

  const unsub = opts.project.subscribe((change: DocChange) => {
    if (change.origin === 'load') recentre = true;
    void layout();
  });
  void layout();
  const offScale = scale.subscribe(placeRoot);
  const offTop = benchTop.subscribe(placeRoot);

  const toWorld = (p: Vector3): Vec3 => {
    root.updateWorldMatrix(true, false);
    p.applyMatrix4(root.matrixWorld);
    return [p.x, p.y, p.z];
  };

  const bench: BenchSpaceImpl = {
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
          const rec = items.get(target.part);
          if (!rec) return null;
          const tag = rec.asset.sidecar.anchors.find((x) => x.kind === 'label' && x.layer !== 'xray');
          if (tag && anchorAt(rec.matrix, rec.asset, tag.id, v)) return toWorld(v);
          const { min, max } = rec.asset.sidecar.bounds;
          v.set((min[0] + max[0]) / 2, max[1], (min[2] + max[2]) / 2);
          return toWorld(v.applyMatrix4(rec.matrix));
        }
        case 'pin':
          return anchorBoard(target.part, target.pin, v) ? toWorld(v) : null;
        case 'hole':
          return anchorBoard(target.surface, target.hole, v) ? toWorld(v) : null;
        case 'anchor':
          return anchorBoard(target.part, target.anchor, v) ? toWorld(v) : null;
        case 'wire':
          return wires.pointOf(target.wire, v) ? toWorld(v) : null;
      }
    },
    objectOf: (id) => items.get(id)?.object,
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
      offScale();
      offTop();
      generation++;
      for (const [rec, kind] of [...running]) {
        rec.token++;
        finish(rec, kind);
      }
      for (const rec of items.values()) disposeOwned(rec.asset, rec.object);
      wires.dispose();
      root.removeFromParent();
      table.removeFromParent();
    },
  };

  internals.set(bench, {
    items,
    anchorBoard,
    get viewId() {
      return viewId;
    },
    get surface() {
      return surfaceId;
    },
    onItems(fn): Unsubscribe {
      itemFns.add(fn);
      return () => itemFns.delete(fn);
    },
    setWireRenderer(renderer) {
      wires.dispose();
      wires = renderer ?? tubeRenderer(root);
      for (const w of drawnWires.values()) wires.draw(w, endBoard(w.from, _a), endBoard(w.to, _b));
    },
    setTransition(hook) {
      for (const [rec, kind] of [...running]) {
        rec.token++;
        finish(rec, kind);
      }
      transition = hook;
    },
    restore(partId) {
      const rec = items.get(partId);
      if (rec) transit(rec, 'move', poseOf(rec.object));
    },
    settled() {
      return laidOut === generation ? Promise.resolve() : new Promise<void>((r) => settleFns.push(r));
    },
  });
  return bench;
}
