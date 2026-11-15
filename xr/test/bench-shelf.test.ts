/** The parts shelf's logic: the registry in six groups, paging, the twelve bin positions, and the strings. */
import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@/parts/builtin';
import { benchGeometry } from '../src/bench/core/geometry';
import { parity } from '../src/bench/core/text';
import { fitScale } from '../src/bench/shelf/bins';
import { BINS_PER_PAGE, GROUP_IDS, groupOf, pageCount, pageOf, shelfEntries } from '../src/bench/shelf/groups';
import { binInTable, shelfLayout, TIER_RISE } from '../src/bench/shelf/layout';
import { shelfStrings } from '../src/bench/shelf/strings';

describe('shelf groups', () => {
  const reg = builtinRegistry();
  const entries = shelfEntries(reg);

  it('maps iynk categories to the six groups, the rest to Basics', () => {
    expect(groupOf('passive')).toBe('basics');
    expect(groupOf('semiconductor')).toBe('basics');
    expect(groupOf('sensor')).toBe('sensors');
    expect(groupOf('instrument')).toBe('sensors');
    expect(groupOf('actuator')).toBe('output');
    expect(groupOf('display')).toBe('output');
    expect(groupOf('motor-driver')).toBe('motion');
    expect(groupOf('robotics')).toBe('motion');
    expect(groupOf('mechanical')).toBe('motion');
    expect(groupOf('power')).toBe('power');
    expect(groupOf('dev-board')).toBe('boards');
    expect(groupOf('fpga')).toBe('boards');
    expect(groupOf('something-new')).toBe('basics');
  });

  it('holds every ref of the registry exactly once, at its latest version', () => {
    const refs = new Set(reg.list().map((p) => p.ref));
    const shelved = GROUP_IDS.flatMap((g) => entries[g]);
    expect(shelved.length).toBe(refs.size);
    expect(new Set(shelved.map((e) => e.ref)).size).toBe(refs.size);
    for (const e of shelved) expect(e.version).toBe(reg.latest(e.ref)!.version);
    expect(entries.boards.length).toBeGreaterThan(0);
    expect(entries.basics.length).toBeGreaterThan(0);
  });

  it('the half breadboard stands first in Boards, not in Motion', () => {
    expect(entries.boards[0]!.ref).toBe('core.breadboard-half');
    expect(entries.motion.some((e) => e.ref === 'core.breadboard-half')).toBe(false);
  });

  it('pages twelve bins at a time', () => {
    expect(BINS_PER_PAGE).toBe(12);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(12)).toBe(1);
    expect(pageCount(13)).toBe(2);
    const many = Array.from({ length: 30 }, (_, i) => i);
    expect(pageOf(many, 0)).toHaveLength(12);
    expect(pageOf(many, 2)).toEqual([24, 25, 26, 27, 28, 29]);
    expect(pageOf(many, 9)).toEqual([24, 25, 26, 27, 28, 29]);
    expect(pageOf(many, -3)[0]).toBe(0);
  });
});

describe('shelf layout', () => {
  for (const posture of ['standing', 'seated'] as const) {
    for (const hand of ['right', 'left'] as const) {
      it(`twelve bins inside the shelf rect, ${posture}, ${hand}-handed, in three rising tiers`, () => {
        const g = benchGeometry(posture, hand);
        const l = shelfLayout(g);
        expect(l.bins).toHaveLength(12);
        for (let i = 0; i < 12; i++) {
          const p = binInTable(l, i);
          expect(Math.abs(p.x - g.shelf.x)).toBeLessThanOrEqual(g.shelf.w / 2);
          expect(Math.abs(p.z - g.shelf.z)).toBeLessThanOrEqual(g.shelf.d / 2);
          expect(p.x * g.d).toBeGreaterThan(0); // on side D
        }
        const tierY = [0, 4, 8].map((i) => l.bins[i]!.y);
        expect(tierY[1]! - tierY[0]!).toBeCloseTo(TIER_RISE, 6);
        expect(tierY[2]! - tierY[1]!).toBeCloseTo(TIER_RISE, 6);
        // the far tier is further from the person
        expect(l.bins[8]!.z).toBeLessThan(l.bins[0]!.z);
        // turned 20 degrees towards the work zone
        expect(Math.abs(l.yaw)).toBeCloseTo((20 * Math.PI) / 180, 6);
        expect(Math.sign(l.yaw)).toBe(-g.d);
      });
    }
  }

  it('a board scales down to its bin, a small part shows at 3x', () => {
    const bin = { w: 0.037, d: 0.05 };
    expect(fitScale({ w: 0.005, h: 0.009, d: 0.005 }, bin)).toBeCloseTo(3, 6);
    expect(fitScale({ w: 0.0686, h: 0.012, d: 0.0534 }, bin)).toBeLessThan(1);
  });
});

describe('shelf strings', () => {
  it('has every key in all six languages', () => {
    expect(parity(shelfStrings)).toEqual([]);
  });
});
