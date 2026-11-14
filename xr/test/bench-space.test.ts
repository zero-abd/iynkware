/**
 * The bench space on the Uno Blink template: boards placed by their footprint, the LED seated by its legs in the holes
 * the document names, frames between document millimetres, the board group and the world.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '@iwsdk/core';
import { builtinRegistry } from '@/parts/builtin';
import { createAssetRegistry, describeFrom } from '../src/assets/registry';
import { createBenchSpace } from '../src/bench/space';
import { createProjectStore, createTemplateSource } from '../src/project/store';

const parts = builtinRegistry();

async function blinkBench() {
  const doc = await createTemplateSource().load('prj_uno-r3-blink');
  const project = createProjectStore(doc, parts);
  const assets = createAssetRegistry({ describe: describeFrom(parts) });
  const bench = createBenchSpace({ project, assets, scale: 4, benchTop: { position: [0, 0.74, -0.6], yawRad: 0 } });
  await bench.ready;
  const view = doc.views.find((v) => v.kind === 'breadboard')!;
  return { doc, project, assets, bench, view };
}

describe('bench space on Uno Blink', () => {
  it('places every part of the breadboard view', async () => {
    const { bench, view } = await blinkBench();
    for (const p of view.placements ?? []) expect(bench.objectOf(p.c), p.c).toBeDefined();
    expect(bench.root.scale.x).toBe(4);
  });

  it('puts each LED leg tip on the mouth of the hole its placement names', async () => {
    const { bench, view } = await blinkBench();
    const led = (view.placements ?? []).find((p) => p.legs && Object.keys(p.legs).length > 0)!;
    expect(led).toBeDefined();
    for (const [pin, hole] of Object.entries(led.legs!)) {
      const leg = bench.worldOf({ kind: 'pin', part: led.c, pin });
      const mouth = bench.worldOf({ kind: 'hole', surface: view.surface!, hole: hole as string });
      expect(leg, pin).not.toBeNull();
      expect(mouth, hole as string).not.toBeNull();
      expect(new Vector3(...leg!).distanceTo(new Vector3(...mouth!)), `${pin} in ${hole}`).toBeLessThan(1e-6);
    }
  });

  it('places a board so its footprint corner is at the document x_mm, y_mm', async () => {
    const { bench, view, assets, doc } = await blinkBench();
    const board = (view.placements ?? []).find((p) => doc.boards.some((b) => b.id === p.c))!;
    const def = doc.boards.find((b) => b.id === board.c)!.definition;
    const asset = await assets.get(def.ref, def.version);
    const obj = bench.objectOf(board.c)!;
    // the footprint corner, in the board frame, is the document's corner in metres
    const corner = new Vector3(asset.footprint.x, 0, asset.footprint.z).applyMatrix4(obj.matrix);
    const want = bench.docToBoard(board.x_mm, board.y_mm);
    expect(corner.x).toBeCloseTo(want[0], 6);
    expect(corner.z).toBeCloseTo(want[2], 6);
  });

  it('round-trips document millimetres through the board frame', async () => {
    const { bench } = await blinkBench();
    expect(bench.boardToDoc(bench.docToBoard(12.5, 40, 3))).toEqual({ xMm: 12.5, yMm: 40, heightMm: 3 });
  });

  it('keeps the bench centred on the bench top and follows setScale', async () => {
    const { bench } = await blinkBench();
    const before = bench.worldOf({ kind: 'part', part: bench.partOf(bench.root.children[0]!)! })!;
    bench.setScale(2);
    const after = bench.worldOf({ kind: 'part', part: bench.partOf(bench.root.children[0]!)! })!;
    expect(bench.root.scale.x).toBe(2);
    // halving the scale halves the distance from the bench top centre
    const top = new Vector3(0, 0.74, -0.6);
    const dBefore = new Vector3(before[0], 0.74, before[2]).distanceTo(top);
    const dAfter = new Vector3(after[0], 0.74, after[2]).distanceTo(top);
    expect(dAfter).toBeCloseTo(dBefore / 2, 6);
  });
});
