/** The pure parts of the wire end beads (bench/wire/beads): which ends, when they show, where they sit, what a release does. */
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/contracts/common';
import { BEADS_ALWAYS_MAX, beadEnds, beadSite, beadsShown, cellOfEnd, decideRelease } from '../src/bench/wire/beads';
import { WIRE_STRINGS } from '../src/bench/wire/strings';
import { parity } from '../src/bench/core/text';

const pin = { kind: 'pin', c: 'brd_main', p: 'D13' } as const;
const hole = { kind: 'hole', surface: 'cmp_bb', hole: 'e10' } as const;

describe('which end a bead is', () => {
  it('gives each end a bead, the other end being the one that stays', () => {
    const [a, b] = beadEnds({ from: pin, to: hole });
    expect(a).toEqual({ side: 'from', ref: pin, kept: hole });
    expect(b).toEqual({ side: 'to', ref: hole, kept: pin });
  });
  it('gives none to a wire with a junction end (its other end cannot be moved)', () => {
    expect(beadEnds({ from: pin, to: { kind: 'junction', at: { x_mm: 0, y_mm: 0 } } as never })).toEqual([]);
  });
  it('names the cell of an end', () => {
    expect(cellOfEnd(pin)).toEqual({ part: 'brd_main', anchor: 'D13' });
    expect(cellOfEnd(hole)).toEqual({ part: 'cmp_bb', anchor: 'e10' });
  });
});

describe('when beads show', () => {
  it('always shows them up to 40 wires', () => {
    expect(beadsShown(1, 'w', new Set())).toBe(true);
    expect(beadsShown(BEADS_ALWAYS_MAX, 'w', new Set())).toBe(true);
  });
  it('above 40 wires only the focused wire shows them', () => {
    expect(beadsShown(BEADS_ALWAYS_MAX + 1, 'w', new Set())).toBe(false);
    expect(beadsShown(BEADS_ALWAYS_MAX + 1, 'w', new Set(['other']))).toBe(false);
    expect(beadsShown(BEADS_ALWAYS_MAX + 1, 'w', new Set(['w']))).toBe(true);
  });
});

describe('where a bead sits', () => {
  const path: Vec3[] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i): Vec3 => [i * 0.001, Math.sin((i / 8) * Math.PI) * 0.01, 0]);
  it('is the first point of the path at least minRise above its anchor, from either end', () => {
    for (const side of ['from', 'to'] as const) {
      const s = beadSite(path, side, 0.004)!;
      expect(s.at[1]).toBeCloseTo(0.004, 6);
      expect(Math.hypot(...s.dir)).toBeCloseTo(1, 6);
    }
    expect(beadSite(path, 'from', 0.004)!.at[0]).toBeLessThan(0.004);
    expect(beadSite(path, 'to', 0.004)!.at[0]).toBeGreaterThan(0.004);
  });
  it('is lifted straight up when the wire never rises that high, so it stays above the cell band', () => {
    const s = beadSite(path, 'from', 0.05)!;
    expect(s.at[1]).toBeCloseTo(0.05, 6);
    expect(s.dir).toEqual([0, 1, 0]);
  });
  it('has no site on a path of fewer than two points', () => {
    expect(beadSite([[0, 0, 0]], 'from', 0.004)).toBeNull();
  });
});

describe('what releasing a lifted end does', () => {
  const own = { part: 'cmp_bb', anchor: 'e10' };
  it('moves the end onto another ringed cell', () => {
    expect(decideRelease({ ringed: { part: 'cmp_bb', anchor: 'e15' }, own, tap: false })).toBe('move');
    expect(decideRelease({ ringed: { part: 'brd_main', anchor: 'e10' }, own, tap: false })).toBe('move');
  });
  it('pulls the wire out over no cell', () => {
    expect(decideRelease({ ringed: null, own, tap: false })).toBe('remove');
  });
  it('changes nothing on its own cell, or after a tap', () => {
    expect(decideRelease({ ringed: { ...own }, own, tap: false })).toBe('keep');
    expect(decideRelease({ ringed: null, own, tap: true })).toBe('keep');
    expect(decideRelease({ ringed: { part: 'cmp_bb', anchor: 'e15' }, own, tap: true })).toBe('keep');
  });
});

describe('the strings', () => {
  it('have the same keys and placeholders in six languages', () => {
    expect(parity(WIRE_STRINGS)).toEqual([]);
    for (const lang of ['en', 'de', 'es', 'fr', 'hi', 'zh'] as const) {
      expect(WIRE_STRINGS[lang]['wire.moved']).toContain('{a}');
      expect(WIRE_STRINGS[lang]['wire.pulled']).toContain('{a}');
    }
  });
});
