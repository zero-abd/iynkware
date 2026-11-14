/** The bench's shared core: six-language tables, the bench geometry and the haptic table. */
import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/contracts/common';
import { benchGeometry } from '../src/bench/core/geometry';
import { HAPTICS } from '../src/bench/core/feedback';
import { format, parity, table, tr } from '../src/bench/core/text';

describe('bench text', () => {
  const t = table({
    en: { 'x.hi': 'Hello {name}', 'x.bye': 'Bye' },
    de: { 'x.hi': 'Hallo {name}', 'x.bye': 'Tschüss' },
    es: { 'x.hi': 'Hola {name}', 'x.bye': 'Adiós' },
    fr: { 'x.hi': 'Bonjour {name}', 'x.bye': 'Au revoir' },
    hi: { 'x.hi': 'नमस्ते {name}', 'x.bye': 'अलविदा' },
    zh: { 'x.hi': '你好 {name}', 'x.bye': '再见' },
  });

  it('fills placeholders and keeps unknown ones visible', () => {
    expect(format('{a} to {b}', { a: 'D13', b: 'row 10' })).toBe('D13 to row 10');
    expect(format('{a} to {b}', { a: 'D13' })).toBe('D13 to {b}');
  });

  it('picks the language', () => {
    expect(tr(t, 'de', 'x.hi', { name: 'Ada' })).toBe('Hallo Ada');
    expect(tr(t, 'zh', 'x.bye')).toBe('再见');
  });

  it('finds no problem in a complete table and names each problem in a broken one', () => {
    expect(parity(t)).toEqual([]);
    const broken = { ...t, fr: { 'x.hi': 'Bonjour', 'x.bye': '' } } as never;
    expect(parity(broken)).toEqual(['fr.x.hi: placeholders differ from en', 'fr.x.bye: empty']);
  });
});

describe('bench geometry', () => {
  for (const posture of ['standing', 'seated'] as const) {
    for (const hand of ['right', 'left'] as const) {
      it(`keeps every zone on the top, ${posture}, ${hand}-handed`, () => {
        const g = benchGeometry(posture, hand);
        for (const r of [g.rail, g.work, g.shelf, g.tools, g.back]) {
          expect(Math.abs(r.x) + r.w / 2).toBeLessThanOrEqual(g.top.w / 2 + 1e-9);
          expect(Math.abs(r.z) + r.d / 2).toBeLessThanOrEqual(g.top.d / 2 + 1e-9);
          expect(r.w).toBeGreaterThan(0);
          expect(r.d).toBeGreaterThan(0);
        }
        // the shelf is on the dominant side, the tools on the other; the work zone does not overlap the shelf
        expect(Math.sign(g.shelf.x)).toBe(hand === 'right' ? 1 : -1);
        expect(Math.sign(g.tools.x)).toBe(-Math.sign(g.shelf.x));
        expect(Math.abs(g.shelf.x) - g.shelf.w / 2).toBeGreaterThanOrEqual(g.work.w / 2 - 1e-9);
        // the rail is the front 4 cm, the work zone right behind it
        expect(g.rail.z + g.rail.d / 2).toBeCloseTo(g.top.d / 2, 9);
        expect(g.work.z + g.work.d / 2).toBeCloseTo(g.rail.z - g.rail.d / 2, 9);
      });
    }
  }

  it('sizes the top by posture (design 2.1)', () => {
    expect(benchGeometry('standing').top).toEqual({ w: 1.0, d: 0.55 });
    expect(benchGeometry('seated').top).toEqual({ w: 0.9, d: 0.5 });
  });
});

describe('bench haptics', () => {
  it('follows the design table: seat is two pulses, hover is barely felt', () => {
    expect(HAPTICS.seat).toEqual([
      { at: 0, intensity: 0.6, ms: 30 },
      { at: 50, intensity: 0.3, ms: 15 },
    ]);
    expect(Math.max(...HAPTICS['hover-grabbable'].map((p) => p.intensity))).toBeLessThan(0.1);
    expect(LANGS.length).toBe(6);
  });
});
