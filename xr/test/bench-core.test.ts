/** The bench's shared core: six-language tables, the bench geometry and the haptic table. */
import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/contracts/common';
import { benchGeometry, onTable, type Rect } from '../src/bench/core/geometry';
import { RING_SLOTS, ringEye, ringSpot } from '../src/bench/core/ring';
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
      it(`keeps every zone on the round table, ${posture}, ${hand}-handed`, () => {
        const g = benchGeometry(posture, hand);
        const corners = (r: Rect & { yawRad?: number }) => {
          const c = Math.cos(r.yawRad ?? 0), s = Math.sin(r.yawRad ?? 0);
          return [-1, 1].flatMap((u) => [-1, 1].map((v) => {
            const lx = (u * r.w) / 2, lz = (v * r.d) / 2;
            return { x: r.x + lx * c + lz * s, z: r.z - lx * s + lz * c };
          }));
        };
        for (const r of [g.mat, g.rail, g.work, g.shelf, g.tools, g.back]) {
          for (const p of corners(r)) expect(onTable(g.table, p.x, p.z)).toBe(true);
          expect(r.w).toBeGreaterThan(0);
          expect(r.d).toBeGreaterThan(0);
        }
        // the rail, work zone and back strip are on the mat
        for (const r of [g.rail, g.work, g.back]) {
          expect(Math.abs(r.x) + r.w / 2).toBeLessThanOrEqual(g.mat.w / 2 + 1e-9);
          expect(r.z + r.d / 2).toBeLessThanOrEqual(g.mat.z + g.mat.d / 2 + 1e-9);
          expect(r.z - r.d / 2).toBeGreaterThanOrEqual(g.mat.z - g.mat.d / 2 - 1e-9);
        }
        // the shelf is on the dominant wing, the tools on the other, both clear of the mat and turned to the person
        expect(Math.sign(g.shelf.x)).toBe(hand === 'right' ? 1 : -1);
        expect(Math.sign(g.tools.x)).toBe(-Math.sign(g.shelf.x));
        for (const w of [g.shelf, g.tools]) {
          for (const p of corners(w)) expect(Math.abs(p.x)).toBeGreaterThan(g.mat.w / 2);
          expect(Math.sign(w.yawRad)).toBe(-Math.sign(w.x));
        }
        // the wings are within a short reach of the nearer shoulder (0.18 m out, 0.22 m under the eyes): design 2.2
        const eyeZ = g.top.d / 2 + 0.15;
        for (const w of [g.shelf, g.tools]) {
          const reach = Math.hypot(Math.abs(w.x) - 0.18, w.z - eyeZ, 0.47 - 0.22);
          expect(reach).toBeLessThan(0.65);
        }
        // the mat is the old front edge: the eyes are 0.15 m behind it
        expect(g.mat.z + g.mat.d / 2).toBeCloseTo(g.top.d / 2, 9);
        // the rail is the front 4 cm, the work zone right behind it
        expect(g.rail.z + g.rail.d / 2).toBeCloseTo(g.top.d / 2, 9);
        expect(g.work.z + g.work.d / 2).toBeCloseTo(g.rail.z - g.rail.d / 2, 9);
      });
    }
  }

  it('wraps the table round the person: its inner edge is the front edge ahead and comes back beside them', () => {
    const g = benchGeometry('standing');
    const front = g.top.d / 2;
    expect(g.table.cz - g.table.inner).toBeCloseTo(front, 9);
    expect(onTable(g.table, 0, front - 0.01)).toBe(true);
    expect(onTable(g.table, 0, front + 0.01)).toBe(false);
    // the person's own spot, and behind them, are never table
    expect(onTable(g.table, 0, front + 0.15)).toBe(false);
    expect(onTable(g.table, 0, g.table.cz)).toBe(false);
    // the wing ends come back to beside the person, never behind the shoulders
    const endZ = g.table.cz - Math.cos(g.table.halfSpanRad) * g.table.inner;
    expect(endZ).toBeLessThan(front + 0.15 + 0.2);
  });

  it('keeps the panel ring apart, beyond the table and facing the eyes', () => {
    for (const posture of ['standing', 'seated'] as const) {
      for (const hand of ['right', 'left'] as const) {
        const g = benchGeometry(posture, hand);
        const eye = ringEye(posture);
        for (const slot of Object.keys(RING_SLOTS) as Array<keyof typeof RING_SLOTS>) {
          const s = ringSpot(slot, posture, hand);
          const [x, y, z] = s.position;
          expect(Math.hypot(x - eye[0], y - eye[1], z - eye[2])).toBeCloseTo(RING_SLOTS[slot].distanceM, 9);
          // beyond the table, above its top, below the eyes
          expect(onTable(g.table, x, z)).toBe(false);
          expect(y).toBeGreaterThan(0);
          expect(y).toBeLessThan(eye[1]);
          // its front (+z turned by yaw) points back at the eyes
          const fx = Math.sin(s.yawRad), fz = Math.cos(s.yawRad);
          const tx = eye[0] - x, tz = eye[2] - z;
          expect((fx * tx + fz * tz) / Math.hypot(tx, tz)).toBeCloseTo(1, 9);
        }
        // the code window is on the dominant side, the guide on the other
        expect(Math.sign(ringSpot('code', posture, hand).position[0])).toBe(hand === 'right' ? 1 : -1);
        expect(Math.sign(ringSpot('guide', posture, hand).position[0])).toBe(hand === 'right' ? -1 : 1);
      }
    }
  });

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
