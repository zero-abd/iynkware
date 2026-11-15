/**
 * Setting things down in the room (bench/space.ts `setFree`, bench/core/rest.ts): an item let go off the mat keeps the
 * pose it was given, a breadboard set down carries its seated parts and their legs stay in the holes, a document load
 * puts everything back on the mat, and a fall takes the time a real one would.
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '@iwsdk/core';
import { builtinRegistry } from '@/parts/builtin';
import { createAssetRegistry, describeFrom } from '../src/assets/registry';
import { fallMs } from '../src/bench/core/rest';
import { benchInternals, createBenchSpace } from '../src/bench/space';
import { createProjectStore, createTemplateSource } from '../src/project/store';

const parts = builtinRegistry();

async function blinkBench() {
  const doc = await createTemplateSource().load('prj_uno-r3-blink');
  const project = createProjectStore(doc, parts);
  const assets = createAssetRegistry({ describe: describeFrom(parts) });
  const bench = createBenchSpace({ project, assets, scale: 1, benchTop: { position: [0, 0.74, -0.6], yawRad: 0 } });
  await bench.ready;
  const view = doc.views.find((v) => v.kind === 'breadboard')!;
  return { doc, project, bench, view, bi: benchInternals(bench)! };
}

const floor = (x: number, z: number) => ({ position: new Vector3(x, -0.74, z), quaternion: new Quaternion() });

describe('setting things down in the room', () => {
  it('keeps a board where it was set down, and forgets it on a load', async () => {
    const { bench, bi, doc, project, view } = await blinkBench();
    const board = (view.placements ?? []).find((p) => doc.boards.some((b) => b.id === p.c) && p.c !== view.surface)!;
    const onMat = bi.items.get(board.c)!.target.position.clone();
    bi.setFree(board.c, floor(0.8, 0.3));
    await bi.settled();
    expect(bi.freeOf(board.c)).toBeDefined();
    expect(bi.items.get(board.c)!.target.position.y).toBeCloseTo(-0.74, 6);
    expect(bench.objectOf(board.c)!.position.x).toBeCloseTo(0.8, 6);

    project.open(doc);
    await bi.settled();
    expect(bi.freeOf(board.c)).toBeUndefined();
    expect(bi.items.get(board.c)!.target.position.distanceTo(onMat)).toBeLessThan(1e-9);
  });

  it('carries the parts seated in a breadboard set down, legs still in their holes', async () => {
    const { bench, bi, view } = await blinkBench();
    bi.setFree(view.surface!, floor(-0.6, 0.2));
    await bi.settled();
    const led = (view.placements ?? []).find((p) => p.legs && Object.keys(p.legs).length > 0)!;
    for (const [pin, hole] of Object.entries(led.legs!)) {
      const leg = bench.worldOf({ kind: 'pin', part: led.c, pin })!;
      const mouth = bench.worldOf({ kind: 'hole', surface: view.surface!, hole: hole as string })!;
      expect(new Vector3(...leg).distanceTo(new Vector3(...mouth))).toBeLessThan(1e-6);
      expect(leg[1]).toBeLessThan(0.1);
    }
  });

  it('puts an item back on the mat when its set-down pose is cleared', async () => {
    const { bi, view } = await blinkBench();
    const id = view.surface!;
    const onMat = bi.items.get(id)!.target.position.clone();
    bi.setFree(id, floor(0.5, 0.5));
    await bi.settled();
    bi.setFree(id, null);
    await bi.settled();
    expect(bi.items.get(id)!.target.position.distanceTo(onMat)).toBeLessThan(1e-9);
  });

  it('falls for as long as a real drop takes', () => {
    expect(fallMs(0)).toBe(120);
    expect(fallMs(0.74)).toBeCloseTo(388, 0);
    expect(fallMs(10)).toBe(900);
  });
});
