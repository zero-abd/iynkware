/** Cells, sticky choice and target priority (bench/core/cells.ts, priority.ts) on iynk's Uno Blink template. */
import { beforeAll, describe, expect, it } from 'vitest';
import { builtinRegistry } from '@/parts/builtin';
import { resolvePart } from '@/studio/parts-view';
import type { Project } from '../src/contracts/project';
import { createTemplateSource } from '../src/project/store';
import { partOrigin } from '../src/bench/core/actions';
import { cellAnchorsFromDoc, createCellIndex, createStickyCell, PITCH_M, type CellIndex } from '../src/bench/core/cells';
import { boardRectOf, inEdgeBand, pickTarget, TARGET_BIT } from '../src/bench/core/priority';

const registry = builtinRegistry();
/** The breadboard's top face in the board frame (any height works; the band is measured from it). */
const TOP = 0.0085;
const S = 3;
let doc: Project;
let holes: CellIndex;

beforeAll(async () => {
  doc = await createTemplateSource().load('prj_uno-r3-blink');
  holes = createCellIndex(cellAnchorsFromDoc(doc, 'cmp_bb', { topY: TOP, registry }));
});

const at = (name: string) => {
  const i = holes.indexOf(name);
  return { x: holes.xs[i]!, z: holes.zs[i]! };
};
const idOf = (i: number) => (i === -1 ? null : holes.ids[i]);

/** Where a placed part's legs are in the board frame: its drawn origin plus its pins (the template's parts are not turned). */
function legTips(part: string): Record<string, { x: number; z: number }> {
  const item = doc.components.find((c) => c.id === part)!;
  const origin = partOrigin(doc, part, { registry })!;
  const tips: Record<string, { x: number; z: number }> = {};
  for (const pin of resolvePart(doc, item.definition.ref, registry).pins) tips[pin.id] = { x: (origin.x_mm + pin.xMm) / 1000, z: (origin.y_mm + pin.yMm) / 1000 };
  return tips;
}

describe('cells', () => {
  it("indexes the template's breadboard holes and lands LED1's and RES1's legs in their holes", () => {
    expect(holes.count).toBe(400);
    const led = legTips('cmp_led1');
    expect(idOf(holes.query(led.A!.x, TOP + 0.002, led.A!.z, S))).toBe('c14');
    expect(idOf(holes.query(led.K!.x, TOP + 0.002, led.K!.z, S))).toBe('c15');
    const res = legTips('cmp_res1');
    expect(idOf(holes.query(res.P1!.x, TOP, res.P1!.z, S))).toBe('b10');
    expect(idOf(holes.query(res.P2!.x, TOP, res.P2!.z, S))).toBe('b14');
  });

  it('targets only from the mouth up to 0.015 m of work above it', () => {
    const { x, z } = at('d7');
    expect(idOf(holes.query(x, TOP + 0.01 / S, z, S))).toBe('d7');
    expect(idOf(holes.query(x, TOP + 0.015 / S, z, S))).toBe('d7');
    expect(holes.query(x, TOP + 0.02 / S, z, S)).toBe(-1);
    expect(holes.lastDistance).toBe(Infinity);
  });

  it('reaches 0.75 pitch, so the hole block has no dead space and the centre channel does', () => {
    const a1 = at('a1');
    const e30 = at('e30');
    for (let x = a1.x; x <= e30.x; x += PITCH_M / 7) {
      for (let z = a1.z; z <= e30.z; z += PITCH_M / 7) expect(holes.query(x, TOP, z, S)).not.toBe(-1);
    }
    const channel = (at('e10').z + at('f10').z) / 2;
    expect(holes.query(at('e10').x, TOP, channel, S)).toBe(-1);
    expect(holes.query(a1.x, TOP, a1.z + 0.76 * PITCH_M, S) === holes.indexOf('b1')).toBe(true);
  });

  it('agrees with a brute-force nearest anchor everywhere', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let n = 0; n < 2000; n++) {
      const x = holes.minX - 0.005 + rnd() * (holes.maxX - holes.minX + 0.01);
      const z = holes.minZ - 0.005 + rnd() * (holes.maxZ - holes.minZ + 0.01);
      // ties go to the lower index, as in the index
      let best = -1;
      let bestD = 0.75 * PITCH_M;
      for (let i = 0; i < holes.count; i++) {
        const d = Math.hypot(holes.xs[i]! - x, holes.zs[i]! - z);
        if (best === -1 ? d <= bestD + 1e-12 : d < bestD - 1e-12) [best, bestD] = [i, d];
      }
      expect(holes.query(x, TOP, z, S)).toBe(best);
    }
  });

  it("indexes the Uno's pins and finds D13", () => {
    const uno = createCellIndex(cellAnchorsFromDoc(doc, 'brd_main', { topY: 0.012, registry }));
    expect(uno.count).toBeGreaterThan(30);
    const i = uno.indexOf('D13');
    expect(uno.query(uno.xs[i]! + 0.0005, 0.012, uno.zs[i]!, S)).toBe(i);
    expect(uno.ids[uno.query(-0.09 + 0.02896, 0.012, 0.00254, S)]).toBe('D13');
  });

  it('meets a far ray with the mouth plane and queries there at height 0', () => {
    const { x, z } = at('h25');
    // from 0.3 m up and back, pointing at h25
    const o = { x: x + 0.05, y: TOP + 0.3, z: z + 0.2 };
    expect(idOf(holes.queryRay(o.x, o.y, o.z, x - o.x, TOP - o.y, z - o.z))).toBe('h25');
    expect(holes.hitX).toBeCloseTo(x, 9);
    expect(holes.queryRay(o.x, o.y, o.z, 1, 0, 0)).toBe(-1);
    expect(holes.queryRay(o.x, o.y, o.z, 0, 1, 0)).toBe(-1);
  });
});

describe('sticky choice', () => {
  it('picks one hole exactly between two and keeps it under jitter until the other is nearer by 0.15 pitch', () => {
    const c14 = at('c14');
    const c15 = at('c15');
    const mid = (c14.x + c15.x) / 2;
    const sticky = createStickyCell(holes);
    const first = sticky.near(mid, TOP + 0.001, c14.z, S);
    expect(['c14', 'c15']).toContain(idOf(first));
    // hand jitter of 0.07 pitch either way for a second at 90 Hz
    for (let f = 0; f < 90; f++) {
      const j = 0.07 * PITCH_M * Math.sin(f * 1.7);
      expect(sticky.near(mid + j, TOP + 0.001, c14.z + j / 2, S)).toBe(first);
    }
    const otherId = first === holes.indexOf('c14') ? 'c15' : 'c14';
    const towards = Math.sign(at(otherId).x - mid);
    // 0.07 pitch past the middle is 0.14 nearer: not enough; 0.08 past is 0.16 nearer: it changes
    expect(sticky.near(mid + towards * 0.07 * PITCH_M, TOP, c14.z, S)).toBe(first);
    expect(idOf(sticky.near(mid + towards * 0.08 * PITCH_M, TOP, c14.z, S))).toBe(otherId);
    expect(c15.x).toBeGreaterThan(c14.x);
  });

  it('drops the choice at once when the pointer leaves the height band', () => {
    const sticky = createStickyCell(holes);
    const { x, z } = at('g3');
    expect(idOf(sticky.near(x, TOP, z, S))).toBe('g3');
    expect(sticky.near(x, TOP + 0.02 / S, z, S)).toBe(-1);
    expect(sticky.current).toBe(-1);
  });

  it('moves a ray to a new cell only when it is 8 dmm nearer on two frames in a row', () => {
    const b5 = at('b5');
    const c5 = at('c5');
    const toward = (f: number) => b5.z + f * (c5.z - b5.z);
    // 8 dmm at 0.3 m and 6x is 0.4 mm of life, 0.16 pitch
    const sticky = createStickyCell(holes);
    const ray = (f: number) => idOf(sticky.ray(b5.x, TOP + 0.4, toward(f), 0, -1, 0, 6, 0.3));
    expect(ray(0)).toBe('b5');
    expect(ray(0.7)).toBe('b5');
    expect(ray(0.3)).toBe('b5');
    expect(ray(0.7)).toBe('b5');
    expect(ray(0.7)).toBe('c5');
    // jitter across the middle is never nearer for two frames running
    for (let f = 0; f < 20; f++) expect(ray(0.5 + (f % 2 ? 0.17 : -0.17))).toBe('c5');
  });

  it('at 3x and 0.6 m, where 8 dmm is wider than a cell, lets a ray go only when it leaves the cell', () => {
    const b5 = at('b5');
    const c5 = at('c5');
    const sticky = createStickyCell(holes);
    const ray = (f: number) => idOf(sticky.ray(b5.x, TOP + 0.4, b5.z + f * (c5.z - b5.z), 0, -1, 0, S, 0.6));
    expect(ray(0)).toBe('b5');
    expect(ray(0.74)).toBe('b5');
    expect(ray(0.74)).toBe('b5');
    expect(ray(0.76)).toBe('c5');
  });
});

describe('target priority', () => {
  it('ranks cell, control, wire end, body, edge band, panel', () => {
    expect(pickTarget(TARGET_BIT.cell | TARGET_BIT.body | TARGET_BIT.panel)).toBe('cell');
    expect(pickTarget(TARGET_BIT.control | TARGET_BIT['wire-end'] | TARGET_BIT.body)).toBe('control');
    expect(pickTarget(TARGET_BIT['wire-end'] | TARGET_BIT.body)).toBe('wire-end');
    expect(pickTarget(TARGET_BIT.body | TARGET_BIT.edge)).toBe('body');
    expect(pickTarget(TARGET_BIT.edge | TARGET_BIT.panel)).toBe('edge');
    expect(pickTarget(TARGET_BIT.panel)).toBe('panel');
    expect(pickTarget(0)).toBeNull();
  });

  it('finds the edge band of the breadboard outside its hole grid, 0.02 m of work wide', () => {
    const rect = boardRectOf(doc, 'cmp_bb', registry)!;
    expect(rect).toMatchObject({ x_mm: 0, y_mm: 0, w_mm: 82.5, h_mm: 54.5 });
    const midZ = 0.027;
    expect(inEdgeBand(rect, 0.001, midZ, S, holes)).toBe(true);
    expect(inEdgeBand(rect, -0.001, midZ, S, holes)).toBe(false);
    // 6.7 mm of life in from the edge at 3x is still the band, 7 mm is not
    expect(inEdgeBand(rect, 0.041, 0.0545 - 0.0066, S)).toBe(true);
    expect(inEdgeBand(rect, 0.041, 0.0545 - 0.007, S)).toBe(false);
    // a1 is near the edge but it is a cell
    const a1 = at('a1');
    expect(inEdgeBand(rect, 0.0044, a1.z, S)).toBe(true);
    expect(inEdgeBand(rect, 0.0044, a1.z, S, holes)).toBe(false);
  });

  it('turns the band with a board', () => {
    const rect = { x_mm: 0, y_mm: 0, w_mm: 60, h_mm: 40, rotation_deg: 90 };
    // turned 90 degrees about its corner the board covers x 0..40, y -60..0
    expect(inEdgeBand(rect, 0.001, -0.03, S)).toBe(true);
    expect(inEdgeBand(rect, 0.001, 0.03, S)).toBe(false);
    expect(inEdgeBand(rect, 0.02, -0.03, S)).toBe(false);
  });
});
