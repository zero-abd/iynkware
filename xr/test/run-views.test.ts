import { describe, expect, test } from 'vitest';
import { LED_GLOW } from '../src/look/palette';
import type { Anchor } from '../src/contracts/assets';
import { stringProblems } from '../src/run/kit/strings';
import { toneHz } from '../src/run/views/buzzer';
import { REDRAW_MS, paintRows, pixelSet, screenRect } from '../src/run/views/display';
import { HOT_AMOUNT, approach, freezes, tintTarget } from '../src/run/views/health';
import { lampColour, litColours, mixLamps } from '../src/run/views/led';
import { motorTarget, rpmToRadPerS, shortWay, spinStep, stepperStep, visualOmega, VISUAL_MAX_RAD_PER_S } from '../src/run/views/motor';
import { digitsFor, formatNumber, readingLine } from '../src/run/views/reading';
import { SERVO_SLEW_DEG_PER_S, channelRadians, clamp, servoStep } from '../src/run/views/servo';
import { labelText, viewStrings } from '../src/run/views/strings';

describe('servo', () => {
  test('moves at the slew, not in one frame', () => {
    const next = servoStep(90, 180, 1 / 72);
    expect(next).toBeGreaterThan(90);
    expect(next - 90).toBeCloseTo(SERVO_SLEW_DEG_PER_S / 72, 6);
  });

  test('takes about a third of a second for a full sweep and never overshoots', () => {
    let a = 0;
    let t = 0;
    while (a !== 180 && t < 5) {
      a = servoStep(a, 180, 1 / 72);
      t += 1 / 72;
      expect(a).toBeLessThanOrEqual(180);
    }
    expect(a).toBe(180);
    expect(t).toBeGreaterThan(0.25);
    expect(t).toBeLessThan(0.6);
  });

  test('slows into the target and lands on it', () => {
    const far = servoStep(0, 100, 0.01) - 0;
    const near = servoStep(99, 100, 0.01) - 99;
    expect(near).toBeLessThan(far);
    expect(servoStep(179.99, 180, 0.01)).toBe(180);
    expect(servoStep(180, 180, 0.1)).toBe(180);
    expect(servoStep(10, 0, 0.5)).toBe(0);
  });

  test('turns the other way and holds on a zero step', () => {
    expect(servoStep(120, 60, 1 / 72)).toBeLessThan(120);
    expect(servoStep(120, 60, 0)).toBe(120);
  });

  test('a channel turns away from rest by its scale', () => {
    const ch = { value: { unit: 'deg' as const, min: 0, max: 180, rest: 90 }, scale: Math.PI / 180 };
    expect(channelRadians(ch, 90)).toBe(0);
    expect(channelRadians(ch, 180)).toBeCloseTo(Math.PI / 2, 8);
    expect(channelRadians(ch, 0)).toBeCloseTo(-Math.PI / 2, 8);
    expect(channelRadians({ ...ch, scale: -Math.PI / 180 }, 180)).toBeCloseTo(-Math.PI / 2, 8);
    expect(clamp(200, 0, 180)).toBe(180);
    expect(clamp(-3, 0, 180)).toBe(0);
  });
});

describe('motor', () => {
  test('rpm to radians a second', () => {
    expect(rpmToRadPerS(60)).toBeCloseTo(2 * Math.PI, 10);
    expect(rpmToRadPerS(0)).toBe(0);
    expect(rpmToRadPerS(-120)).toBeCloseTo(-4 * Math.PI, 10);
  });

  test('a stalled or unpowered motor targets rest', () => {
    expect(motorTarget({ rpm: 3000, stalled: false, powered: true })).toBeCloseTo(rpmToRadPerS(3000), 8);
    expect(motorTarget({ rpm: 0, stalled: true, powered: true })).toBe(0);
    expect(motorTarget({ rpm: 3000, stalled: true, powered: true })).toBe(0);
    expect(motorTarget({ rpm: 3000, stalled: false, powered: false })).toBe(0);
  });

  test('spins up and winds down gradually, never past the target', () => {
    let w = 0;
    const target = rpmToRadPerS(1200);
    const first = spinStep(w, target, 1 / 72);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(target * 0.1);
    for (let i = 0; i < 72 * 3; i++) w = spinStep(w, target, 1 / 72);
    expect(w).toBeGreaterThan(target * 0.99);
    expect(w).toBeLessThanOrEqual(target);
    for (let i = 0; i < 72; i++) w = spinStep(w, 0, 1 / 72);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(target * 0.2);
  });

  test('winds down slower than it spins up', () => {
    const up = spinStep(0, 100, 0.05);
    const down = 100 - spinStep(100, 0, 0.05);
    expect(down).toBeLessThan(up);
  });

  test('reversing passes through zero', () => {
    const w = spinStep(100, -100, 0.1);
    expect(w).toBeLessThan(100);
    expect(w).toBeGreaterThan(-100);
  });

  test('the drawn speed is odd, grows, and stays under the ceiling', () => {
    expect(visualOmega(0)).toBe(0);
    expect(visualOmega(1)).toBeCloseTo(1, 2);
    expect(visualOmega(-30)).toBeCloseTo(-visualOmega(30), 10);
    expect(visualOmega(400)).toBeGreaterThan(visualOmega(200));
    expect(Math.abs(visualOmega(1e6))).toBeLessThanOrEqual(VISUAL_MAX_RAD_PER_S);
  });

  test('a stepper takes the short way round', () => {
    expect(shortWay(350, 10)).toBe(20);
    expect(shortWay(10, 350)).toBe(-20);
    expect(shortWay(0, 180)).toBe(180);
    expect(shortWay(90, 90)).toBe(0);
    const next = stepperStep(350, 10, 1 / 72);
    expect(next).toBeGreaterThan(350);
    expect(stepperStep(10, 10.01, 0.01)).toBe(10.01);
  });
});

describe('display rows', () => {
  test('decodes four pixels a hex digit, left pixel the high bit', () => {
    const rows = ['9f', 'a0'];
    // 0x9 = 1001, 0xf = 1111
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((x) => pixelSet(rows, x, 0))).toEqual([true, false, false, true, true, true, true, true]);
    // 0xa = 1010, 0x0 = 0000
    expect([0, 1, 2, 3, 4].map((x) => pixelSet(rows, x, 1))).toEqual([true, false, true, false, false]);
    expect(pixelSet(['F'], 3, 0)).toBe(true);
    expect(pixelSet(['A'], 0, 0)).toBe(true);
  });

  test('anything outside the rows is dark', () => {
    expect(pixelSet(['f'], 4, 0)).toBe(false);
    expect(pixelSet(['f'], 0, 3)).toBe(false);
    expect(pixelSet(['zz'], 0, 0)).toBe(false);
  });

  test('paints lit pixels light, the rest dark, off and inverted respected', () => {
    const out = new Uint8Array(4 * 1 * 4);
    paintRows(out, 4, 1, { on: true, inverted: false, rows: ['a'] });
    const lit = (i: number) => out[i * 4]! > 128;
    expect([0, 1, 2, 3].map(lit)).toEqual([true, false, true, false]);
    expect(out[3]).toBe(255);
    paintRows(out, 4, 1, { on: true, inverted: true, rows: ['a'] });
    expect([0, 1, 2, 3].map(lit)).toEqual([false, true, false, true]);
    paintRows(out, 4, 1, { on: false, inverted: false, rows: ['f'] });
    expect([0, 1, 2, 3].map(lit)).toEqual([false, false, false, false]);
    paintRows(out, 4, 1, { on: false, inverted: true, rows: ['f'] });
    expect([0, 1, 2, 3].map(lit)).toEqual([false, false, false, false]);
  });

  test('redraws at most ten times a second', () => {
    expect(REDRAW_MS).toBeGreaterThanOrEqual(100);
  });

  const bounds = { min: [-0.02, 0, -0.01] as [number, number, number], max: [0.02, 0.004, 0.01] as [number, number, number] };

  test('uses the screen anchor rect when the asset has one', () => {
    const anchor = {
      id: 'screen:DISPLAY',
      kind: 'screen',
      part: 'DISPLAY',
      position: [0, 0.004, 0],
      normal: [0, 1, 0],
      rect: { origin: [-0.01, 0.004, -0.005], u: [0.02, 0, 0], v: [0, 0, 0.01], pixels: [128, 64] },
    } as Anchor;
    expect(screenRect([anchor], bounds)).toEqual({ origin: [-0.01, 0.004, -0.005], u: [0.02, 0, 0], v: [0, 0, 0.01], pixels: [128, 64] });
  });

  test('without an anchor, lays the panel on the top face, fitted and centred', () => {
    const r = screenRect([], bounds);
    expect(r.origin[1]).toBe(0.004);
    // the body is 40 x 20 mm: a 2:1 panel fills it
    expect(r.u[0]).toBeCloseTo(0.04, 8);
    expect(r.v[2]).toBeCloseTo(0.02, 8);
    expect(r.origin[0]).toBeCloseTo(-0.02, 8);
    // a body deeper than the panel's aspect leaves a margin front and back
    const tall = screenRect([], { min: [-0.01, 0, -0.02], max: [0.01, 0.004, 0.02] });
    expect(tall.u[0]).toBeCloseTo(0.02, 8);
    expect(tall.v[2]).toBeCloseTo(0.01, 8);
    expect(tall.origin[2]).toBeCloseTo(-0.005, 8);
  });
});

describe('led lamps', () => {
  test('knows a lamp by its pin name', () => {
    expect(lampColour('R')).toBe(LED_GLOW.red);
    expect(lampColour('g')).toBe(LED_GLOW.green);
    expect(lampColour('Blue')).toBe(LED_GLOW.blue);
    expect(lampColour('COM')).toBeUndefined();
    expect(litColours(['R', 'COM', 'B'])).toEqual([LED_GLOW.red, LED_GLOW.blue]);
    expect(litColours(undefined)).toEqual([]);
  });

  test('one lamp is its own colour at full brightness', () => {
    const [r, g, b] = mixLamps([LED_GLOW.green!], LED_GLOW.red!);
    expect(Math.max(r, g, b)).toBeCloseTo(1, 8);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  test('red and green read yellow, all three read near white', () => {
    const [yr, yg, yb] = mixLamps([LED_GLOW.red!, LED_GLOW.green!], LED_GLOW.red!);
    expect(yr).toBeGreaterThan(0.8);
    expect(yg).toBeGreaterThan(0.8);
    expect(yb).toBeLessThan(0.65);
    const [wr, wg, wb] = mixLamps([LED_GLOW.red!, LED_GLOW.green!, LED_GLOW.blue!], LED_GLOW.red!);
    expect(Math.min(wr, wg, wb)).toBeGreaterThan(0.9);
  });

  test('no lit lamp the table knows falls back to the part colour', () => {
    const fallback = mixLamps([], LED_GLOW.blue!);
    expect(fallback[2]).toBeCloseTo(1, 2);
    expect(fallback[0]).toBeLessThan(0.5);
  });
});

describe('reading format', () => {
  test('numbers follow the language', () => {
    expect(formatNumber(2.03, 'en')).toBe('2.03');
    expect(formatNumber(2.03, 'de')).toBe('2,03');
    expect(formatNumber(2.03, 'fr')).toBe('2,03');
    expect(formatNumber(1234.5, 'en')).toBe('1,235');
    expect(formatNumber(-0, 'en')).toBe('0');
    expect(formatNumber(23.4, 'zh')).toBe('23.4');
  });

  test('fewer decimals as the number grows', () => {
    expect(digitsFor(2.03)).toBe(2);
    expect(digitsFor(234.5)).toBe(1);
    expect(digitsFor(2345)).toBe(0);
  });

  test('a line carries label, value and unit', () => {
    expect(readingLine({ value: 2.03, unit: 'V', label: '' }, 'en')).toBe('2.03 V');
    expect(readingLine({ value: 23.4, unit: 'cm', label: 'dist' }, 'en')).toBe('dist 23.4 cm');
    expect(readingLine({ value: 23.4, unit: 'cm', label: 'dist' }, 'de')).toBe('Abstand 23,4 cm');
    expect(readingLine({ value: 135, unit: '°', label: '' }, 'en')).toBe('135°');
    expect(readingLine({ value: 5, unit: '', label: 'out' }, 'en')).toBe('out 5');
    expect(readingLine({ value: Number.NaN, unit: 'V', label: '' }, 'en')).toBe('– V');
  });

  test('an unknown label passes through trimmed', () => {
    expect(labelText(' pin 3 ', 'en')).toBe('pin 3');
    expect(labelText('', 'zh')).toBe('');
  });
});

describe('health', () => {
  test('hot warms, burnt chars and freezes, the rest leaves the part alone', () => {
    expect(tintTarget('ok')).toEqual({ warm: 0, char: 0 });
    expect(tintTarget('hot')).toEqual({ warm: HOT_AMOUNT, char: 0 });
    expect(tintTarget('burnt')).toEqual({ warm: 0, char: 1 });
    expect(tintTarget('reversed')).toEqual({ warm: 0, char: 0 });
    expect(freezes('burnt')).toBe(true);
    expect(freezes('hot')).toBe(false);
    expect(freezes('ok')).toBe(false);
  });

  test('the tint eases in both ways and never overshoots', () => {
    let v = 0;
    const seen: number[] = [];
    for (let i = 0; i < 100; i++) {
      v = approach(v, 1, 1 / 72);
      seen.push(v);
    }
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[0]).toBeLessThan(0.1);
    expect(v).toBe(1);
    expect(seen.every((x) => x <= 1)).toBe(true);
    expect(approach(1, 0, 10)).toBe(0);
    expect(approach(0.5, 0.5, 1)).toBe(0.5);
  });
});

describe('buzzer pitch', () => {
  test('sounds only while on with a pitch', () => {
    expect(toneHz({ on: true, hz: 440 })).toBe(440);
    expect(toneHz({ on: false, hz: 440 })).toBe(0);
    expect(toneHz({ on: true, hz: 0 })).toBe(0);
    expect(toneHz({ on: true, hz: Number.NaN })).toBe(0);
    expect(toneHz({ on: true, hz: -5 })).toBe(0);
  });
});

describe('strings', () => {
  test('every language has every text, with the same placeholders', () => {
    expect(stringProblems(viewStrings.table)).toEqual([]);
  });

  test('says the part is not simulated yet in each language', () => {
    for (const lang of ['en', 'de', 'es', 'fr', 'hi', 'zh'] as const) expect(viewStrings.t(lang, 'notSimulated').length).toBeGreaterThan(3);
  });
});
