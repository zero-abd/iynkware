/** Current flow: currents on Uno Blink laid on the bench, dot spacing and speed, the sim-time clock, the label cap. */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '@iwsdk/core';
import { builtinRegistry } from '@/parts/builtin';
import { createAssetRegistry, describeFrom } from '../../src/assets/registry';
import { benchInternals, createBenchSpace } from '../../src/bench/space';
import { createProjectStore, createTemplateSource } from '../../src/project/store';
import type { AnalogView } from '../../src/scale/kit/analog';
import { tableProblems } from '../../src/scale/kit/text';
import { SimClock } from '../../src/scale/flow/clock';
import { FlowDots } from '../../src/scale/flow/dots';
import { MAX_LABELS, pickLabels } from '../../src/scale/flow/labels';
import { ARROW_SPACING, boardSpeed, cappedSpacing, MAX_DOTS, MIN_FLOW_AMPS, ROOM_SPACING, spacingOf, worldSpeed } from '../../src/scale/flow/motion';
import { buildTopology, segmentAmps } from '../../src/scale/flow/paths';
import { FLOW_STRINGS } from '../../src/scale/flow/strings';

const parts = builtinRegistry();

async function blink() {
  const doc = await createTemplateSource().load('prj_uno-r3-blink');
  const project = createProjectStore(doc, parts);
  const assets = createAssetRegistry({ describe: describeFrom(parts) });
  const bench = createBenchSpace({ project, assets, scale: 4, benchTop: { position: [0, 0.74, -0.6], yawRad: 0 } });
  await bench.ready;
  const inner = benchInternals(bench)!;
  const out = new Vector3();
  const topo = buildTopology(project.doc, inner.viewId!, {
    wirePath: (id) => bench.wirePath(id),
    pinAt: (part, pin) => (inner.anchorBoard(part, pin, out) ? [out.x, out.y, out.z] : null),
  })!;
  return { project, topo };
}

/** Blink with the LED on: 4.5 mA out of D13, through RES1 and LED1, back into GND. Positive is into the part. */
const BLINK_ON: AnalogView = {
  volts: {},
  amps: {},
  pinAmps: {
    brd_main: { D13: -0.0045, GND: 0.0045 },
    cmp_res1: { P1: 0.0045, P2: -0.0045 },
    cmp_led1: { A: 0.0045, K: -0.0045 },
  },
  parts: {},
  waves: {},
  instruments: {},
};

describe('flow topology on Uno Blink', () => {
  it('runs the LED current along the D13 wire, its strip, and through the parts', async () => {
    const { topo } = await blink();
    const amps = new Float64Array(topo.segs.length);
    segmentAmps(topo, BLINK_ON, amps);
    const at = (id: string) => amps[topo.segs.findIndex((s) => s.id === id)]!;
    // wir_1 goes from the D13 pin to the hole: the current leaves the board, so it flows along the drawn path.
    expect(at('wir_1')).toBeCloseTo(0.0045, 9);
    // wir_2 goes from the GND pin to the hole: the current flows the other way.
    expect(at('wir_2')).toBeCloseTo(-0.0045, 9);
    expect(at('part:cmp_led1')).toBeCloseTo(0.0045, 9);
    expect(at('part:cmp_res1')).toBeCloseTo(0.0045, 9);
    const joins = topo.segs.filter((s) => s.kind === 'join');
    expect(joins.length).toBeGreaterThan(0);
    expect(joins.some((s) => Math.abs(amps[topo.segs.indexOf(s)]!) > 0.004)).toBe(true);
    for (const s of topo.segs) expect(s.length).toBeGreaterThan(0);
  });

  it('names the nodes and places a spot on D13', async () => {
    const { topo } = await blink();
    expect(topo.spots.some((s) => s.name === 'D13')).toBe(true);
    expect(topo.spots.length).toBe(3);
  });

  it('fills dots that move with sim time, hold when it stops, and reverse with the current', async () => {
    const { topo } = await blink();
    const amps = new Float64Array(topo.segs.length);
    segmentAmps(topo, BLINK_ON, amps);
    const dots = new FlowDots();
    dots.setTopology(topo);
    dots.setFlow(amps, () => 4);
    const view = { kind: 'bench' as const, scale: 4, reduced: false };
    dots.update(0, view);
    expect(dots.count).toBeGreaterThan(10);
    expect(dots.count).toBeLessThanOrEqual(MAX_DOTS);
    const before = Array.from((dots.mesh.instanceMatrix.array as Float32Array).slice(0, dots.count * 16));
    dots.update(0, view);
    expect(Array.from((dots.mesh.instanceMatrix.array as Float32Array).slice(0, dots.count * 16))).toEqual(before);
    dots.update(0.1, view);
    expect(Array.from((dots.mesh.instanceMatrix.array as Float32Array).slice(0, dots.count * 16))).not.toEqual(before);
    // Reduced motion: static arrowheads, 0.15 m apart in the world, never moving.
    dots.update(0, { ...view, reduced: true });
    const still = Array.from((dots.mesh.instanceMatrix.array as Float32Array).slice(0, dots.count * 16));
    dots.update(1, { ...view, reduced: true });
    expect(Array.from((dots.mesh.instanceMatrix.array as Float32Array).slice(0, dots.count * 16))).toEqual(still);
    dots.clear();
    expect(dots.count).toBe(0);
    dots.dispose();
  });

  it('draws nothing under the minimum current', async () => {
    const { topo } = await blink();
    const dots = new FlowDots();
    dots.setTopology(topo);
    dots.setFlow(new Float64Array(topo.segs.length).fill(MIN_FLOW_AMPS / 10), () => 0);
    dots.update(0, { kind: 'bench', scale: 4, reduced: false });
    expect(dots.count).toBe(0);
    dots.dispose();
  });
});

describe('spacing and speed', () => {
  it('spaces dots 4 mm on the bench board, 0.04 m at Room size, 0.15 m as arrows', () => {
    expect(spacingOf('bench', 4, false)).toBeCloseTo(0.004, 9);
    expect(spacingOf('room', 1, false)).toBeCloseTo(ROOM_SPACING, 9);
    expect(spacingOf('room', 2, false)).toBeCloseTo(ROOM_SPACING / 2, 9);
    expect(spacingOf('bench', 4, true)).toBeCloseTo(ARROW_SPACING / 4, 9);
    expect(cappedSpacing(0.004, 100)).toBeGreaterThan(0.004);
    expect(cappedSpacing(0.004, 1)).toBe(0.004);
  });

  it('runs 0.05 + 0.25 x log10(1 + I / 1 mA) m/s, capped at 0.6, scaled by the stage on the bench', () => {
    expect(worldSpeed(1e-3)).toBeCloseTo(0.05 + 0.25 * Math.log10(2), 9);
    expect(worldSpeed(-1e-3)).toBeCloseTo(worldSpeed(1e-3), 9);
    expect(worldSpeed(1000)).toBe(0.6);
    expect(worldSpeed(MIN_FLOW_AMPS / 2)).toBe(0);
    expect(boardSpeed(1e-3, 4)).toBeCloseTo(worldSpeed(1e-3) / 4, 9);
  });
});

describe('SimClock', () => {
  it('follows sim frames, stops when paused, and moves by exactly a step', () => {
    const c = new SimClock();
    c.push(0);
    expect(c.advance(1 / 72)).toBe(0);
    c.push(33e6);
    let moved = 0;
    for (let i = 0; i < 10; i++) moved += c.advance(1 / 72);
    expect(moved).toBeCloseTo(0.033, 9);
    // paused: no frames, no motion
    expect(c.advance(1 / 72)).toBe(0);
    // Step 100 ms
    c.push(133e6);
    let step = 0;
    for (let i = 0; i < 30; i++) step += c.advance(1 / 72);
    expect(step).toBeCloseTo(0.1, 9);
    expect(c.advance(1 / 72)).toBe(0);
  });

  it('snaps without motion on a restart or a long gap', () => {
    const c = new SimClock();
    c.push(5e9);
    expect(c.advance(1 / 72)).toBe(0);
    expect(c.advance(1 / 72)).toBe(0);
    c.push(1e6);
    expect(c.advance(1 / 72)).toBeGreaterThanOrEqual(0);
    expect(c.advance(1)).toBeLessThan(0.01);
  });
});

describe('labels', () => {
  const spot = (i: number) => ({ node: `n${i}`, name: `N${i}`, at: [i, 0, 0] as const });
  it('keeps at most 8, the highest |V| first, and skips ground', () => {
    const spots = Array.from({ length: 12 }, (_, i) => spot(i));
    const volts: Record<string, number> = {};
    spots.forEach((s, i) => (volts[s.node] = i % 2 ? -i : i));
    volts.n0 = 0;
    const got = pickLabels('en', volts, spots, 'n11');
    expect(got.length).toBe(MAX_LABELS);
    expect(got[0]!.node).toBe('n10');
    expect(got.some((l) => l.node === 'n11' || l.node === 'n0')).toBe(false);
    expect(pickLabels('en', volts, spots, undefined, 3).length).toBe(3);
  });

  it('writes "D13 4.98 V" in the language', () => {
    expect(pickLabels('en', { a: 4.976 }, [{ node: 'a', name: 'D13', at: [0, 0, 0] }], undefined)[0]!.text).toBe('D13 4.98 V');
    expect(pickLabels('de', { a: 4.976 }, [{ node: 'a', name: 'D13', at: [0, 0, 0] }], undefined)[0]!.text).toBe('D13 4,98 V');
  });
});

describe('strings', () => {
  it('are in six languages with the same keys', () => {
    expect(tableProblems(FLOW_STRINGS)).toEqual([]);
  });
});
