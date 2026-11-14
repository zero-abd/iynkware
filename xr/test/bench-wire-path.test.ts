/** `BenchSpace.wirePath` on Uno Blink: the drawn path of a wire runs end to end along the tube the bench draws. */
import { describe, expect, it } from 'vitest';
import { Vector3, type Mesh, type TubeGeometry } from '@iwsdk/core';
import { builtinRegistry } from '@/parts/builtin';
import { createAssetRegistry, describeFrom } from '../src/assets/registry';
import { benchInternals, createBenchSpace } from '../src/bench/space';
import { createProjectStore, createTemplateSource } from '../src/project/store';

const parts = builtinRegistry();
const VIEW = 'vw_bb';

async function blink() {
  const doc = await createTemplateSource().load('prj_uno-r3-blink');
  const project = createProjectStore(doc, parts);
  const assets = createAssetRegistry({ describe: describeFrom(parts) });
  const bench = createBenchSpace({ project, assets, scale: 4, benchTop: { position: [0, 0.74, -0.6], yawRad: 0 } });
  await bench.ready;
  return { project, bench, inner: benchInternals(bench)! };
}

const at = (p: readonly number[]) => new Vector3(p[0], p[1], p[2]);

/** A wire end's board-frame anchor, the way the builder reads it. */
function endOf(inner: NonNullable<ReturnType<typeof benchInternals>>, end: { kind: string; c?: string; p?: string; surface?: string; hole?: string }) {
  const out = new Vector3();
  const got = end.kind === 'pin' ? inner.anchorBoard(end.c!, end.p!, out) : inner.anchorBoard(end.surface!, end.hole!, out);
  return got ? out : null;
}

describe('BenchSpace.wirePath', () => {
  it('runs from the wire end anchors, arched, with at most 32 points', async () => {
    const { project, inner, bench } = await blink();
    const wires = project.doc.views.find((v) => v.id === VIEW)!.wires!;
    expect(wires.length).toBeGreaterThan(0);
    for (const w of wires) {
      const path = bench.wirePath(w.id)!;
      expect(path, w.id).not.toBeNull();
      expect(path.length).toBeGreaterThan(2);
      expect(path.length).toBeLessThanOrEqual(32);
      const from = endOf(inner, w.from)!;
      const to = endOf(inner, w.to)!;
      expect(at(path[0]!).distanceTo(from), `${w.id} start`).toBeLessThan(1e-9);
      expect(at(path.at(-1)!).distanceTo(to), `${w.id} end`).toBeLessThan(1e-9);
      expect(Math.max(...path.map((p) => p[1]))).toBeGreaterThan(Math.max(from.y, to.y));
      // The same curve the tube is drawn along.
      const curve = ((bench.root.getObjectByName(w.id) as Mesh).geometry as TubeGeometry).parameters.path;
      path.forEach((p, i) => expect(at(p).distanceTo(curve.getPoint(i / (path.length - 1))), `${w.id} #${i}`).toBeLessThan(1e-9));
    }
  });

  it('is null for an unknown or removed wire, and follows a moved board', async () => {
    const { project, bench, inner } = await blink();
    expect(bench.wirePath('wir_nope')).toBeNull();
    const before = bench.wirePath('wir_1')!;
    const placement = project.doc.views.find((v) => v.id === VIEW)!.placements.find((p) => p.c === 'brd_main')!;
    expect(project.apply({ k: 'view.place', view: VIEW, placement: { ...placement, x_mm: -130, y_mm: 15 } }).ok).toBe(true);
    const after = bench.wirePath('wir_1')!;
    expect(after).not.toBe(before);
    expect(at(after[0]!).distanceTo(inner.anchorBoard('brd_main', 'D13', new Vector3())!)).toBeLessThan(1e-9);

    expect(project.apply({ k: 'wire.remove', view: VIEW, id: 'wir_2' }).ok).toBe(true);
    expect(bench.wirePath('wir_2')).toBeNull();
    expect(bench.wirePath('wir_1')).not.toBeNull();
  });
});
