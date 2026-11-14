/**
 * Incremental layout on Uno Blink: one object per placed item across document changes, a board frame that only moves
 * when a document is opened, removals, wires and seated parts that follow, the newest document winning a burst, and
 * the transition hook bench sub-modules animate with.
 */
import { describe, expect, it } from 'vitest';
import { Vector3, type Material, type Mesh, type Object3D, type TubeGeometry } from '@iwsdk/core';
import { builtinRegistry } from '@/parts/builtin';
import { createAssetRegistry, describeFrom } from '../src/assets/registry';
import {
  benchInternals,
  createBenchSpace,
  type BenchItem,
  type BenchPose,
  type BenchWire,
  type ItemsChange,
  type TransitionKind,
  type WireRenderer,
} from '../src/bench/space';
import type { AssetRegistry } from '../src/contracts/assets';
import type { Project, ProjectStore } from '../src/contracts/project';
import type { BenchSpace } from '../src/contracts/space';
import { createProjectStore, createTemplateSource } from '../src/project/store';

const parts = builtinRegistry();
const VIEW = 'vw_bb';
const IDS = ['brd_main', 'cmp_bb', 'cmp_led1', 'cmp_res1'] as const;
const TOP = { position: [0, 0.74, -0.6] as [number, number, number], yawRad: 0 };

const registry = () => createAssetRegistry({ describe: describeFrom(parts) });

async function blink(doc?: Project, assets: AssetRegistry = registry()) {
  const start = doc ?? (await createTemplateSource().load('prj_uno-r3-blink'));
  const project = createProjectStore(start, parts);
  const bench = createBenchSpace({ project, assets, scale: 4, benchTop: TOP });
  await bench.ready;
  return { project, bench, inner: benchInternals(bench)! };
}

const placementOf = (project: ProjectStore, c: string) =>
  project.doc.views.find((v) => v.id === VIEW)!.placements.find((p) => p.c === c)!;

function place(project: ProjectStore, c: string, patch: Record<string, unknown>) {
  const r = project.apply({ k: 'view.place', view: VIEW, placement: { ...placementOf(project, c), ...patch } }, { label: 'Move' });
  expect(r.ok, JSON.stringify(r)).toBe(true);
}

const partAt = (bench: BenchSpace, id: string) => new Vector3(...bench.worldOf({ kind: 'part', part: id })!);
const worldPos = (o: Object3D) => o.getWorldPosition(new Vector3());

/** Where the document puts a board's footprint corner, in the board frame, against where the bench put it. */
function cornerOf(bench: BenchSpace, id: string) {
  const item = benchInternals(bench)!.items.get(id)!;
  const fp = item.asset.footprint;
  return new Vector3(fp.x, 0, fp.z).applyQuaternion(item.target.quaternion).add(item.target.position);
}

describe('bench space: incremental layout', () => {
  it('moves one part and leaves every other object the same instance in the same place', async () => {
    const { project, bench, inner } = await blink();
    bench.root.updateMatrixWorld(true);
    const before = new Map(IDS.map((id) => [id, { obj: bench.objectOf(id)!, at: partAt(bench, id), world: worldPos(bench.objectOf(id)!) }]));
    const changes: ItemsChange[] = [];
    inner.onItems((c) => changes.push(c));

    place(project, 'brd_main', { x_mm: -120, y_mm: 10 });
    await inner.settled();
    bench.root.updateMatrixWorld(true);

    for (const id of IDS) {
      expect(bench.objectOf(id), id).toBe(before.get(id)!.obj);
      if (id === 'brd_main') continue;
      expect(partAt(bench, id).distanceTo(before.get(id)!.at), id).toBeLessThan(1e-9);
      expect(worldPos(bench.objectOf(id)!).distanceTo(before.get(id)!.world), id).toBeLessThan(1e-9);
    }
    // The moved board's footprint corner is where the document now says.
    const corner = cornerOf(bench, 'brd_main');
    expect(corner.x).toBeCloseTo(-0.12, 9);
    expect(corner.z).toBeCloseTo(0.01, 9);
    expect(bench.objectOf('brd_main')!.position.distanceTo(inner.items.get('brd_main')!.target.position)).toBeLessThan(1e-12);
    expect(changes).toEqual([{ added: [], moved: ['brd_main'], removed: [] }]);
  });

  it('keeps the board frame still on an edit and centres it again when a document is opened', async () => {
    const { project, bench, inner } = await blink();
    const frame = bench.root.position.clone();
    const led = bench.objectOf('cmp_led1');
    place(project, 'brd_main', { x_mm: -200 });
    expect(bench.root.position.distanceTo(frame)).toBe(0);
    place(project, 'cmp_bb', { x_mm: 40, y_mm: 30 });
    expect(bench.root.position.distanceTo(frame)).toBe(0);

    const edited = project.doc;
    project.open(edited);
    await inner.settled();
    expect(bench.root.position.distanceTo(frame)).toBeGreaterThan(0.05);
    // Centred as a bench that started from the edited document is.
    const fresh = await blink(edited);
    expect(bench.root.position.distanceTo(fresh.bench.root.position)).toBeLessThan(1e-9);
    // Opening keeps the objects of items the new document places the same way.
    expect(bench.objectOf('cmp_led1')).toBe(led);
  });

  it('takes a removed placement out of root and disposes only the materials it owns', async () => {
    const { project, bench } = await blink();
    const led = bench.objectOf('cmp_led1')!;
    const disposed: string[] = [];
    led.traverse((o) => {
      const m = (o as Mesh).material as Material | undefined;
      m?.addEventListener('dispose', () => disposed.push(o.name));
    });
    expect(project.apply({ k: 'view.unplace', view: VIEW, c: 'cmp_led1' }).ok).toBe(true);
    expect(bench.objectOf('cmp_led1')).toBeUndefined();
    expect(led.parent).toBeNull();
    expect(bench.partOf(led)).toBeUndefined();
    expect(bench.root.children).not.toContain(led);
    // The lens is the placement's own; the body and pins are shared with every LED.
    expect(disposed).toEqual(['light']);

    project.undo();
    const back = bench.objectOf('cmp_led1')!;
    expect(back).toBeDefined();
    expect(back).not.toBe(led);
    expect(back.parent).toBe(bench.root);
    expect(back.getObjectByName('light')).toBeDefined();
  });

  it('redraws a wire whose end part moved, and only that', async () => {
    const { project, bench, inner } = await blink();
    const tube = (id: string) => bench.root.getObjectByName(id) as Mesh;
    const start = (id: string) => (tube(id).geometry as TubeGeometry).parameters.path.getPoint(0);
    const geometries = () => ['wir_1', 'wir_2'].map((id) => tube(id).geometry);

    // The LED moves to other holes: no wire touches it.
    const kept = geometries();
    place(project, 'cmp_led1', { legs: { A: 'c20', K: 'c21' } });
    expect(geometries()).toEqual(kept);
    expect(geometries()[0]).toBe(kept[0]);

    const midBefore = bench.worldOf({ kind: 'wire', wire: 'wir_1' })!;
    place(project, 'brd_main', { x_mm: -130, y_mm: 15 });
    expect(tube('wir_1').geometry).not.toBe(kept[0]);
    expect(start('wir_1').distanceTo(inner.anchorBoard('brd_main', 'D13', new Vector3())!)).toBeLessThan(1e-9);
    expect(start('wir_2').distanceTo(inner.anchorBoard('brd_main', 'GND', new Vector3())!)).toBeLessThan(1e-9);
    expect(bench.worldOf({ kind: 'wire', wire: 'wir_1' })).not.toEqual(midBefore);

    expect(project.apply({ k: 'wire.remove', view: VIEW, id: 'wir_2' }).ok).toBe(true);
    expect(bench.root.getObjectByName('wir_2')).toBeUndefined();
    expect(bench.worldOf({ kind: 'wire', wire: 'wir_2' })).toBeNull();
  });

  it('carries a seated LED along with a moved breadboard', async () => {
    const { project, bench, inner } = await blink();
    const led = bench.objectOf('cmp_led1')!;
    const was = partAt(bench, 'cmp_led1');
    expect(inner.items.get('cmp_led1')).toMatchObject({ role: 'part', seated: true, legs: { A: 'c14', K: 'c15' } });
    expect(inner.items.get('cmp_bb')!.role).toBe('surface');
    expect(inner.items.get('brd_main')!.role).toBe('board');
    expect(inner.surface).toBe('cmp_bb');
    expect(inner.viewId).toBe(VIEW);
    const changes: ItemsChange[] = [];
    inner.onItems((c) => changes.push(c));

    place(project, 'cmp_bb', { x_mm: 20 });
    expect(bench.objectOf('cmp_led1')).toBe(led);
    // 20 mm along x at scale 4, the bench not turned.
    const shift = partAt(bench, 'cmp_led1').sub(was);
    expect(shift.x).toBeCloseTo(0.08, 9);
    expect(Math.abs(shift.y) + Math.abs(shift.z)).toBeLessThan(1e-9);
    for (const [pin, hole] of [['A', 'c14'], ['K', 'c15']] as const) {
      const leg = new Vector3(...bench.worldOf({ kind: 'pin', part: 'cmp_led1', pin })!);
      const mouth = new Vector3(...bench.worldOf({ kind: 'hole', surface: 'cmp_bb', hole })!);
      expect(leg.distanceTo(mouth), pin).toBeLessThan(1e-6);
    }
    expect(changes).toHaveLength(1);
    expect([...changes[0]!.moved].sort()).toEqual(['cmp_bb', 'cmp_led1', 'cmp_res1']);
  });

  it('lays a burst of changes out as the last document, even when assets arrive out of order', async () => {
    // Known assets: synchronous, inside apply.
    const sync = await blink();
    for (const x of [-100, -110, -95]) place(sync.project, 'brd_main', { x_mm: x });
    expect(cornerOf(sync.bench, 'brd_main').x).toBeCloseTo(-0.095, 9);

    // Assets that take longer the earlier they were asked for: the first layouts finish last and must be dropped.
    const real = registry();
    let delay = 80;
    const slow: AssetRegistry = {
      get: (ref, version) => {
        const d = delay;
        return new Promise((r) => setTimeout(() => r(real.get(ref, version)), d));
      },
      preload: (refs) => real.preload(refs),
      hasConverted: (ref) => real.hasConverted(ref),
    };
    const doc = await createTemplateSource().load('prj_uno-r3-blink');
    const project = createProjectStore(doc, parts);
    const bench = createBenchSpace({ project, assets: slow, scale: 4, benchTop: TOP });
    let layouts = 0;
    bench.onLayout(() => layouts++);
    delay = 40;
    place(project, 'brd_main', { x_mm: -140 });
    delay = 0;
    place(project, 'brd_main', { x_mm: -150, y_mm: 5 });
    project.apply({ k: 'view.unplace', view: VIEW, c: 'cmp_res1' });
    await bench.ready;
    await benchInternals(bench)!.settled();
    await new Promise((r) => setTimeout(r, 120));
    expect(layouts).toBe(1);
    const corner = cornerOf(bench, 'brd_main');
    expect(corner.x).toBeCloseTo(-0.15, 9);
    expect(corner.z).toBeCloseTo(0.005, 9);
    expect(bench.objectOf('cmp_res1')).toBeUndefined();
    expect(bench.root.children.filter((o) => typeof o.userData.partId === 'string')).toHaveLength(3);
  });

  it('hands add, move and remove to the transition hook with the document as the target', async () => {
    const { project, bench, inner } = await blink();
    const calls: Array<{ item: BenchItem; from: BenchPose | null; to: BenchPose | null; kind: TransitionKind; done: () => void }> = [];
    inner.setTransition((item, from, to, kind, done) => calls.push({ item, from, to, kind, done }));
    const take = (kind: TransitionKind, id: string) => {
      const i = calls.findIndex((c) => c.kind === kind && c.item.id === id);
      expect(i, `${kind} ${id}`).toBeGreaterThanOrEqual(0);
      return calls.splice(i, 1)[0]!;
    };

    // Move: from where the object is, to where the document puts it; the hook moves it, done snaps it.
    const board = bench.objectOf('brd_main')!;
    const home = board.position.clone();
    place(project, 'brd_main', { x_mm: -110 });
    const mv = take('move', 'brd_main');
    expect(mv.from!.position.distanceTo(home)).toBeLessThan(1e-12);
    expect(mv.to!.position.distanceTo(inner.items.get('brd_main')!.target.position)).toBeLessThan(1e-12);
    expect(cornerOf(bench, 'brd_main').x).toBeCloseTo(-0.11, 9);
    expect(board.position.distanceTo(home)).toBeLessThan(1e-12);
    mv.to!.position.set(9, 9, 9); // the hook's own copy
    board.position.lerpVectors(home, inner.items.get('brd_main')!.target.position, 0.5);
    mv.done();
    expect(board.position.distanceTo(inner.items.get('brd_main')!.target.position)).toBeLessThan(1e-12);

    // Remove: the object stays in root until done.
    const res = bench.objectOf('cmp_res1')!;
    project.apply({ k: 'view.unplace', view: VIEW, c: 'cmp_res1' });
    const rm = take('remove', 'cmp_res1');
    expect(rm.to).toBeNull();
    expect(rm.from!.position.distanceTo(res.position)).toBeLessThan(1e-12);
    expect(bench.objectOf('cmp_res1')).toBeUndefined();
    expect(res.parent).toBe(bench.root);
    rm.done();
    expect(res.parent).toBeNull();

    // Add: a new object in root at its target, from nowhere.
    project.undo();
    const ad = take('add', 'cmp_res1');
    expect(ad.from).toBeNull();
    expect(ad.item.object).toBe(bench.objectOf('cmp_res1'));
    expect(ad.item.object.parent).toBe(bench.root);
    expect(ad.to!.position.distanceTo(ad.item.target.position)).toBeLessThan(1e-12);
    expect(ad.item.object.position.distanceTo(ad.item.target.position)).toBeLessThan(1e-12);
    ad.done();

    // A newer move supersedes an older one: the older done is ignored.
    place(project, 'brd_main', { x_mm: -100 });
    place(project, 'brd_main', { x_mm: -90 });
    const [first, second] = [take('move', 'brd_main'), take('move', 'brd_main')];
    const still = board.position.clone();
    first.done();
    expect(board.position.distanceTo(still)).toBeLessThan(1e-12);
    second.done();
    expect(cornerOf(bench, 'brd_main').x).toBeCloseTo(-0.09, 9);
    expect(board.position.distanceTo(inner.items.get('brd_main')!.target.position)).toBeLessThan(1e-12);

    // Replacing the hook finishes what is running.
    place(project, 'brd_main', { x_mm: -80 });
    take('move', 'brd_main');
    inner.setTransition(null);
    expect(board.position.distanceTo(inner.items.get('brd_main')!.target.position)).toBeLessThan(1e-12);
    place(project, 'brd_main', { x_mm: -70 });
    expect(calls).toHaveLength(0);
    expect(board.position.distanceTo(inner.items.get('brd_main')!.target.position)).toBeLessThan(1e-12);
  });

  it('hands wires to a replacement renderer when their ends change', async () => {
    const { project, bench, inner } = await blink();
    const drawn: string[] = [];
    const erased: string[] = [];
    const ends = new Map<string, Vector3>();
    const renderer: WireRenderer = {
      draw(w: BenchWire, from: Vector3 | null) {
        drawn.push(w.id);
        if (from) ends.set(w.id, from.clone());
      },
      erase: (id) => void erased.push(id),
      pointOf: (id, out) => (ends.has(id) ? out.copy(ends.get(id)!) : null),
      dispose() {},
    };
    inner.setWireRenderer(renderer);
    expect(bench.root.getObjectByName('wir_1')).toBeUndefined();
    expect(drawn.sort()).toEqual(['wir_1', 'wir_2']);
    drawn.length = 0;
    place(project, 'cmp_led1', { legs: { A: 'c22', K: 'c23' } });
    expect(drawn).toEqual([]);
    place(project, 'brd_main', { x_mm: -125 });
    expect(drawn.sort()).toEqual(['wir_1', 'wir_2']);
    expect(ends.get('wir_1')!.distanceTo(inner.anchorBoard('brd_main', 'D13', new Vector3())!)).toBeLessThan(1e-9);
    expect(bench.worldOf({ kind: 'wire', wire: 'wir_1' })).not.toBeNull();
    project.apply({ k: 'wire.remove', view: VIEW, id: 'wir_1' });
    expect(erased).toEqual(['wir_1']);
  });

  it('writes anchors into the given vector', async () => {
    const { inner } = await blink();
    const out = new Vector3();
    expect(inner.anchorBoard('cmp_bb', 'a10', out)).toBe(out);
    expect(inner.anchorBoard('cmp_bb', 'no-such-hole', out)).toBeNull();
    expect(inner.anchorBoard('cmp_nothing', 'a10', out)).toBeNull();
  });
});
