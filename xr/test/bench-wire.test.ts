/** The pure pieces of hand wiring (bench/wire): cell to wire end, the in-place tube, the hit boxes, the strings. */
import { describe, expect, it } from 'vitest';
import type { Project } from '@/project/generated/types';
import { WIRE_COLOURS, breadboardViewOf } from '../src/bench/core/actions';
import { parity } from '../src/bench/core/text';
import { endOfCell, refOfCell, sameCell, underSeatedBody } from '../src/bench/wire/ends';
import { BOXES, boxesAlong } from '../src/bench/wire/hits';
import { WIRE_STRINGS } from '../src/bench/wire/strings';
import { RADIAL, SEGMENTS, VERTICES, writeTube } from '../src/bench/wire/tube';
import { createTemplateSource } from '../src/project/store';

let doc: Project;
const load = async () => (doc ??= await createTemplateSource().load('prj_uno-r3-blink'));

describe('a cell as a wire end', () => {
  it('maps the breadboard surface to a hole and a board to a pin', async () => {
    const d = await load();
    expect(refOfCell('cmp_bb', 'cmp_bb', 'e25')).toEqual({ kind: 'hole', surface: 'cmp_bb', hole: 'e25' });
    expect(refOfCell('cmp_bb', 'brd_main', 'D13')).toEqual({ kind: 'pin', c: 'brd_main', p: 'D13' });
    expect(endOfCell(d, 'cmp_bb', 'cmp_bb', 'e25')).toEqual({ kind: 'hole', surface: 'cmp_bb', hole: 'e25' });
    expect(endOfCell(d, 'cmp_bb', 'brd_main', 'D13')).toEqual({ kind: 'pin', c: 'brd_main', p: 'D13' });
  });
  it('declines a hole a seated leg occupies, and anything that is no pin or hole', async () => {
    const d = await load();
    const legs = breadboardViewOf(d)!.placements.find((p) => p.c === 'cmp_led1')!.legs!;
    for (const hole of Object.values(legs) as string[]) expect(endOfCell(d, 'cmp_bb', 'cmp_bb', hole)).toBeNull();
    expect(endOfCell(d, 'cmp_bb', 'cmp_bb', 'nope')).toBeNull();
    expect(endOfCell(d, 'cmp_bb', 'brd_main', 'nope')).toBeNull();
  });
  it('treats the holes between a seated part\'s legs as under its body', async () => {
    const d = await load();
    // columns 10..14 of row b are the resistor's legs; columns are 2.54 mm apart
    const at = (h: string): [number, number] | null => {
      const m = /^([a-j])(\d+)$/.exec(h);
      return m ? [Number(m[2]) * 0.00254, (m[1]!.charCodeAt(0) - 97) * 0.00254] : null;
    };
    expect(underSeatedBody(d, 'b12', at)).toBe(true);
    expect(underSeatedBody(d, 'e22', at)).toBe(false);
    expect(underSeatedBody(d, 'e10', at)).toBe(false);
  });
  it('compares cells', () => {
    expect(sameCell({ part: 'a', anchor: 'x' }, { part: 'a', anchor: 'x' })).toBe(true);
    expect(sameCell({ part: 'a', anchor: 'x' }, { part: 'a', anchor: 'y' })).toBe(false);
    expect(sameCell(null, null)).toBe(false);
  });
});

describe('the pending wire tube, rewritten in place', () => {
  const pos = new Float32Array(VERTICES * 3);
  const nor = new Float32Array(VERTICES * 3);
  it('keeps its vertex count, makes no NaN and stands its ends where it is asked', () => {
    expect(VERTICES).toBe((SEGMENTS + 1) * (RADIAL + 1));
    const pairs: Array<[number[], number[]]> = [
      [[0, 0, 0], [0.04, 0, 0.01]],
      [[0.1, 0.002, -0.03], [-0.02, 0.0085, 0.05]],
      [[0, 0, 0], [0, 0, 0]],
      [[0, 0, 0], [0, 0.002, 0.001]],
    ];
    for (const [a, b] of pairs) {
      expect(writeTube(pos, nor, a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!)).toBe(true);
      expect(pos.every(Number.isFinite) && nor.every(Number.isFinite)).toBe(true);
      const ring = (i: number) => {
        let x = 0, y = 0, z = 0;
        for (let j = 0; j < RADIAL; j++) {
          x += pos[(i * (RADIAL + 1) + j) * 3]!;
          y += pos[(i * (RADIAL + 1) + j) * 3 + 1]!;
          z += pos[(i * (RADIAL + 1) + j) * 3 + 2]!;
        }
        return [x / RADIAL, y / RADIAL, z / RADIAL];
      };
      const first = ring(0);
      const last = ring(SEGMENTS);
      for (let k = 0; k < 3; k++) {
        expect(first[k]).toBeCloseTo(a[k]!, 5);
        expect(last[k]).toBeCloseTo(b[k]!, 5);
      }
      // it arches: the middle is above the higher end
      expect(ring(SEGMENTS / 2)[1]!).toBeGreaterThan(Math.max(a[1]!, b[1]!));
      // unit normals
      for (let i = 0; i < VERTICES; i += 7) expect(Math.hypot(nor[i * 3]!, nor[i * 3 + 1]!, nor[i * 3 + 2]!)).toBeCloseTo(1, 4);
    }
  });
  it('refuses a non finite end and leaves the arrays as they were', () => {
    const before = pos.slice();
    expect(writeTube(pos, nor, NaN, 0, 0, 1, 0, 0)).toBe(false);
    expect(Array.from(pos)).toEqual(Array.from(before));
  });
});

describe('the wire hit boxes', () => {
  const path = Array.from({ length: 21 }, (_, i): [number, number, number] => [i * 0.005, Math.sin((i / 20) * Math.PI) * 0.01, 0]);
  it('cover the middle of the path and leave a fifth free at each end', () => {
    const boxes = boxesAlong(path);
    expect(boxes.length).toBe(BOXES);
    const xs = boxes.flatMap((b) => [b.centre[0] - (b.dir[0] * b.length) / 2, b.centre[0] + (b.dir[0] * b.length) / 2]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0.02 - 1e-9);
    expect(Math.max(...xs)).toBeLessThanOrEqual(0.08 + 1e-9);
    for (const b of boxes) expect(Math.hypot(...b.dir)).toBeCloseTo(1, 6);
  });
  it('make none for a path too short to have a middle', () => {
    expect(boxesAlong([[0, 0, 0]])).toEqual([]);
    expect(boxesAlong([[0, 0, 0], [1, 0, 0]])).toEqual([]);
  });
});

describe('strings', () => {
  it('has every key in every language, with matching placeholders', () => {
    expect(parity(WIRE_STRINGS)).toEqual([]);
  });
  it('names each of the ten project colours', () => {
    for (const c of WIRE_COLOURS) expect(WIRE_STRINGS.en[`wire.colour.${c}` as keyof (typeof WIRE_STRINGS)['en']]).toBeTruthy();
  });
});
