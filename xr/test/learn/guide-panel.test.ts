import { describe, expect, it } from 'vitest';
import { fitText, wrap, units } from '../../src/learn/kit/fit';
import { tokens } from '../../src/learn/kit/tokens';
import { roleSize, lineHeight } from '../../src/learn/kit/dmm';
import { arrowSpot, outOfView } from '../../src/learn/lessons/panel/arrow';
import { layoutCode, pickerOptions, DEFAULT_STEPS } from '../../src/learn/lessons/panel/code-layout';
import { clampDistance, guideSpot, yawOf } from '../../src/learn/lessons/panel/placement';
import { reasonText } from '../../src/learn/lessons/panel/checks-tab';
import { PANEL_STRINGS, t } from '../../src/learn/lessons/panel/strings';
import { dashes, pulse, arcControl } from '../../src/learn/callouts/geometry';
import { tableProblems } from '../../src/learn/text';
import type { Chip } from '../../src/learn/types';

// A fixed-pitch measure: every character is 0.5 em wide, CJK 1 em.
const measure = (s: string, size: number) => Array.from(s).reduce((w, ch) => w + (/[　-鿿＀-￯]/.test(ch) ? 1 : 0.5) * size, 0);

describe('fitting (design 9.5)', () => {
  const base = { size: 22, minSize: 18, lineHeight: 1.35, measure };

  it('wraps at spaces within the slot', () => {
    const f = fitText('Press Run. The LED blinks.', { ...base, maxWidth: 160, maxHeight: 200 });
    expect(f.lines).toEqual(['Press Run. The', 'LED blinks.']);
    expect(f.size).toBe(22);
    expect(f.truncated).toBe(false);
  });

  it('shrinks by at most 15 % and never under 18 before cutting', () => {
    const long = 'one two three four five six seven eight nine ten eleven twelve';
    const f = fitText(long, { ...base, maxWidth: 120, maxHeight: 22 * 1.35 * 2 });
    expect(f.size).toBeGreaterThanOrEqual(18.7 - 1e-9);
    expect(f.truncated).toBe(true);
    expect(f.lines).toHaveLength(2);
    expect(f.lines[1]!.endsWith('…')).toBe(true);
    for (const l of f.lines) expect(measure(l, f.size)).toBeLessThanOrEqual(120);
  });

  it('shrinks instead of cutting when 85 % is enough', () => {
    // 20 characters: 220 wide at 22, 187 at 18.7.
    const f = fitText('abcdefghij klmnopqrs', { ...base, maxWidth: 200, maxHeight: 40, maxLines: 1 });
    expect(f.truncated).toBe(false);
    expect(f.size).toBeLessThan(22);
    expect(f.size).toBeGreaterThanOrEqual(18.7 - 1e-9);
  });

  it('keeps 18 dmm as the floor even when 85 % is smaller', () => {
    const f = fitText('x'.repeat(200), { ...base, size: 20, maxWidth: 100, maxHeight: 30 });
    expect(f.size).toBe(18);
  });

  it('caps the lines (six for a step) whatever the slot height', () => {
    const f = fitText(Array.from({ length: 40 }, (_, i) => `w${i}`).join(' '), { ...base, maxWidth: 60, maxHeight: 1000, maxLines: 6 });
    expect(f.lines.length).toBe(6);
    expect(f.truncated).toBe(true);
  });

  it('breaks Chinese between characters and long words by characters', () => {
    expect(units('让 LED 闪烁')).toEqual(['让', ' ', 'LED', ' ', '闪', '烁']);
    expect(wrap('顺着D13的线走进面包板', 66, 22, measure).every((l) => measure(l, 22) <= 66)).toBe(true);
    expect(wrap('abcdefghijkl', 55, 22, measure)).toEqual(['abcde', 'fghij', 'kl']);
  });

  it('gives a shorter first line when a styled word starts it', () => {
    const lines = wrap('aa bb cc dd', (i) => (i === 0 ? 30 : 60), 10, measure);
    expect(lines).toEqual(['aa bb', 'cc dd']);
    expect(wrap('abcdefgh ij', (i) => (i === 0 ? 20 : 60), 10, measure)[0]).toBe('');
  });

  it('sets Devanagari and Chinese 1.15x with their line heights (design 9.2)', () => {
    expect(roleSize('body', 'hi')).toBeCloseTo(25.3);
    expect(roleSize('code', 'zh')).toBe(20);
    expect(lineHeight('hi')).toBe(1.55);
    expect(lineHeight('zh')).toBe(1.45);
    expect(roleSize('title', 'de', 1.25)).toBeCloseTo(37.5);
  });

  it('lowers paper in a dim room and makes muted ink in high contrast', () => {
    expect(tokens({ room: 'dim' }).paper).toBe('#e4ddcf');
    expect(tokens({ highContrast: true }).muted).toBe(tokens().ink);
    expect(tokens({ highContrast: true }).outline).toBe(1.5);
  });
});

describe('placement (design 9.1)', () => {
  const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

  it('sits 1.10 m away, 12 degrees below and 15 degrees away from the dominant hand', () => {
    const head = [0, 1.2, 0] as const;
    const right = guideSpot(head, 0, 'right');
    expect(dist(right, head)).toBeCloseTo(1.1);
    expect(right[0]).toBeLessThan(0);
    expect(right[2]).toBeLessThan(0);
    expect(Math.asin((head[1] - right[1]) / 1.1) * (180 / Math.PI)).toBeCloseTo(12);
    expect(Math.atan2(-right[0], -right[2]) * (180 / Math.PI)).toBeCloseTo(15);
    const left = guideSpot(head, 0, 'left');
    expect(left[0]).toBeCloseTo(-right[0]);
  });

  it('follows the head yaw', () => {
    const p = guideSpot([0, 1.6, 0], Math.PI / 2, 'right');
    // Facing -X, the non-dominant (left) side is +Z.
    expect(p[0]).toBeLessThan(-0.9);
    expect(p[2]).toBeGreaterThan(0.2);
  });

  it('keeps a moved panel between 0.8 and 2.0 m', () => {
    const head = { x: 0, y: 1.2, z: 0 };
    const near = { x: 0, y: 1.2, z: -0.5 };
    expect(clampDistance(head, near)).toBe(true);
    expect(near.z).toBeCloseTo(-0.8);
    const far = { x: 3, y: 1.2, z: 0 };
    clampDistance(head, far);
    expect(far.x).toBeCloseTo(2);
    const ok = { x: 0, y: 1.2, z: -1.1 };
    expect(clampDistance(head, ok)).toBe(false);
  });

  it('reads the yaw of a head orientation', () => {
    const half = Math.PI / 4;
    expect(yawOf(0, Math.sin(half), 0, Math.cos(half))).toBeCloseTo(Math.PI / 2);
    // Pitched down 30 degrees, no yaw.
    expect(yawOf(-Math.sin(Math.PI / 12), 0, 0, Math.cos(Math.PI / 12))).toBeCloseTo(0);
  });
});

describe('off-view arrow (design 7.1)', () => {
  const spot = () => ({ side: 'bottom' as const, x: 0, y: 0, angle: 0 }) as { side: 'left' | 'right' | 'top' | 'bottom'; x: number; y: number; angle: number };

  it('tells a target outside the view', () => {
    const head = { x: 0, y: 1.2, z: 0 };
    const fwd = { x: 0, y: 0, z: -1 };
    expect(outOfView(head, fwd, { x: 0.1, y: 1, z: -0.6 })).toBe(false);
    expect(outOfView(head, fwd, { x: 1, y: 1.2, z: -0.3 })).toBe(true);
    expect(outOfView(head, fwd, { x: 0, y: 1.2, z: 1 })).toBe(true);
  });

  it('puts the arrow on the nearest border, pointing at the target', () => {
    expect(arrowSpot(1, 0.1, 0.26, 0.2, spot())).toMatchObject({ side: 'right', x: 0.26 });
    expect(arrowSpot(-1, 0, 0.26, 0.2, spot()).side).toBe('left');
    expect(arrowSpot(0.05, 1, 0.26, 0.2, spot())).toMatchObject({ side: 'top', y: 0.2 });
    const below = arrowSpot(0.1, -0.5, 0.26, 0.2, spot());
    expect(below.side).toBe('bottom');
    expect(below.angle).toBeCloseTo(Math.atan2(-0.5, 0.1));
    expect(arrowSpot(0, 0, 0.26, 0.2, spot()).side).toBe('bottom');
  });
});

describe('code tab (design 7.2)', () => {
  const chip = (c: Partial<Chip>): Chip => ({ param: 'par_on', name: 'on', label: { en: 'On for' }, kind: 'number', value: 500, options: [], inCode: true, ...c });
  const words = { on: 'On', off: 'Off' };

  it('offers a chip its own values, marking the current one', () => {
    const c = chip({ kind: 'choice', value: 'red', options: [{ value: 'red', label: { en: 'Red', de: 'Rot' } }, { value: 'blue', label: { en: 'Blue' } }] });
    expect(pickerOptions(c, 'de', words)).toEqual([
      { value: 'red', label: 'Rot', current: true },
      { value: 'blue', label: 'Blue', current: false },
    ]);
  });

  it('gives a number chip the default stepper with its unit, and keeps an odd current value', () => {
    const o = pickerOptions(chip({ value: 300, unit: 'ms' }), 'en', words);
    expect(o.map((x) => x.value)).toEqual([100, 250, 300, 500, 1000, 2000]);
    expect(o.find((x) => x.current)?.label).toBe('300 ms');
    expect(pickerOptions(chip({ value: 500 }), 'en', words).map((x) => x.value)).toEqual([...DEFAULT_STEPS]);
    expect(pickerOptions(chip({ kind: 'toggle', value: true }), 'en', words).map((x) => x.label)).toEqual(['On', 'Off']);
  });

  it('wraps long lines with an indent and keeps chips whole', () => {
    const rows = layoutCode(
      [
        { n: 1, spans: [{ text: 'delay(', kind: 'function' }, { text: '500', kind: 'chip', chip: 'par_on' }, { text: ');', kind: 'plain' }] },
        { n: 2, spans: [{ text: '// a very long comment that runs on', kind: 'comment' }] },
      ],
      16,
    );
    expect(rows[0]).toEqual({
      n: 1,
      spans: [
        { text: 'delay(', kind: 'function', col: 0, cols: 6 },
        { text: '500', kind: 'chip', chip: 'par_on', col: 6, cols: 4 },
        { text: ');', kind: 'plain', col: 10, cols: 2 },
      ],
    });
    const comment = rows.slice(1);
    expect(comment[0]!.n).toBe(2);
    expect(comment.slice(1).every((r) => r.n === 0 && r.spans[0]!.col === 2)).toBe(true);
    // Breaks fall at spaces, which the indent stands for.
    expect(comment.map((r) => r.spans.map((s) => s.text).join('').trim()).join(' ')).toBe('// a very long comment that runs on');
    for (const r of rows) for (const s of r.spans) expect(s.col + s.cols).toBeLessThanOrEqual(16);
  });
});

describe('checks and words', () => {
  it('has every guide panel string in six languages', () => {
    expect(tableProblems(PANEL_STRINGS)).toEqual([]);
  });

  it('reuses the Studio wording and fills placeholders', () => {
    expect(t('en', 'stepOf', { n: 3, total: 7 })).toBe('Step 3 of 7');
    expect(t('de', 'runChecks')).toBe('Prüfen');
    expect(t('hi', 'showMe')).toBe('मुझे दिखाएँ');
  });

  it('says a known reason in words and passes a measurement through', () => {
    expect(reasonText('needs-analog', 'en')).toBe('Needs the analog solver');
    expect(reasonText('1/2', 'fr')).toBe('1/2');
    expect(reasonText(undefined, 'en')).toBe('');
  });
});

describe('highlight geometry', () => {
  it('pulses three times over 3.6 s, then holds; reduced motion holds at once', () => {
    expect(pulse(0, false)).toBe(1);
    expect(pulse(0.6, false)).toBeCloseTo(0);
    expect(pulse(1.2, false)).toBeCloseTo(1);
    expect(pulse(3.0, false)).toBeCloseTo(0);
    expect(pulse(3.7, false)).toBe(1);
    expect(pulse(0.6, true)).toBe(1);
  });

  it('dashes an arc that rises above both anchors, with a dash at each end', () => {
    const a = [0, 0, 0] as const;
    const b = [0.2, 0, 0] as const;
    const c = arcControl(a, b);
    expect(c[1]).toBeCloseTo(0.08);
    const d = dashes(a, c, b, 0.012, 0.008);
    expect(d.length).toBeGreaterThan(5);
    expect(d[0]![0]).toBeCloseTo(1 - d[d.length - 1]![1], 5);
    for (const [t0, t1] of d) expect(t1).toBeGreaterThan(t0);
  });
});
