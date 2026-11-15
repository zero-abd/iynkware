/** The inspector's rows: Blink LED and resistor, value formatting per language, table parity, the redraw throttle. */
import { describe, expect, it } from 'vitest';
import { LANGS } from '../../src/contracts/common';
import { tableProblems } from '../../src/scale/kit/text';
import { angularScale } from '../../src/scale/probe/card';
import {
  buildCard,
  CARD,
  DASH,
  formatAmps,
  formatQuantity,
  formatVolts,
  formatWatts,
  layoutCard,
  ratingLabel,
  redrawDue,
  type CardInput,
  type DescriptorLike,
} from '../../src/scale/probe/rows';
import { PROBE } from '../../src/scale/probe/strings';
import led from '../../../src/parts/data/led-5mm.component.json';
import resistor from '../../../src/parts/data/resistor.component.json';

const base: CardInput = {
  lang: 'en',
  refdes: 'D1',
  descriptor: led as unknown as DescriptorLike,
  nets: undefined,
  volts: undefined,
  pinAmps: undefined,
  health: undefined,
  state: undefined,
  live: false,
};

describe('strings', () => {
  it('have every key in all six languages', () => {
    expect(tableProblems(PROBE)).toEqual([]);
  });
});

describe('the Blink LED card', () => {
  it('lists both pins and its ratings while idle, with dashes for live values', () => {
    const m = buildCard(base);
    expect(m.title).toBe('5 mm through-hole LED');
    expect(m.subtitle).toBe('D1');
    expect(m.pins.map((p) => p.role)).toEqual(['A  Anode', 'K  Cathode']);
    expect(m.pins.every((p) => p.volts === DASH && p.amps === DASH)).toBe(true);
    expect(m.ratings[0]).toEqual({ label: 'Current, Absolute maximum', value: '20 mA' });
    expect(m.idle).toBe('Run it to see live values');
  });

  it('shows node volts, pin current, watts and health while it runs', () => {
    const m = buildCard({
      ...base,
      live: true,
      nets: { A: 'n1', K: 'gnd' },
      volts: { n1: 2.03, gnd: 0 },
      pinAmps: { A: 0.0146, K: -0.0146 },
      health: { watts: 0.0296, state: 'ok' },
      state: { part: 'cmp_led1', kind: 'led', lit: true, brightness: 0.73, provenance: 'approximation', tier: 'T0' },
    });
    expect(m.pins[0]).toMatchObject({ volts: '2.03 V', amps: '14.6 mA' });
    expect(m.pins[1]).toMatchObject({ volts: '0.00 V', amps: '-14.6 mA' });
    expect(m.live).toEqual([
      { label: 'Light', value: '73 %' },
      { label: 'Power', value: '29.6 mW' },
      { label: 'State', value: 'Fine' },
    ]);
    expect(m.idle).toBeNull();
  });
});

describe('the resistor card', () => {
  it('shows its two pins and its tolerance', () => {
    const m = buildCard({ ...base, refdes: 'R1', descriptor: resistor as unknown as DescriptorLike });
    expect(m.pins.map((p) => p.id)).toEqual(['P1', 'P2']);
    expect(m.ratings).toEqual([{ label: 'Ratio, Characteristic', value: '5 %' }]);
  });

  it('caps long pin lists and says how many are left', () => {
    const many: DescriptorLike = { pins: Array.from({ length: 20 }, (_, i) => ({ id: `P${i}` })) };
    const m = buildCard({ ...base, descriptor: many });
    expect(m.pins).toHaveLength(8);
    expect(m.pinsMore).toBe('+12 more');
    const wired = buildCard({ ...base, descriptor: many, nets: { P3: 'n1', P9: 'n2' }, live: true });
    expect(wired.pins.map((p) => p.id)).toEqual(['P3', 'P9']);
    expect(wired.pinsMore).toBeNull();
  });
});

describe('formatting per language', () => {
  it('writes numbers as the language does and keeps unit symbols', () => {
    expect(formatVolts('en', 2.034)).toBe('2.03 V');
    expect(formatVolts('de', 2.034)).toBe('2,03 V');
    expect(formatVolts('fr', 2.034).replace(/\s/g, ' ')).toBe('2,03 V');
    expect(formatVolts('es', 2.034)).toBe('2,03 V');
    expect(formatVolts('hi', 2.034)).toBe('2.03 V');
    expect(formatVolts('zh', 2.034)).toBe('2.03 V');
    expect(formatVolts('en', undefined)).toBe(DASH);
    expect(formatAmps('de', 0.0146)).toBe('14,6 mA');
    expect(formatAmps('en', 0.00022)).toBe('220 µA');
    expect(formatAmps('en', 1.5)).toBe('1.50 A');
    expect(formatWatts('en', 0.0296)).toBe('29.6 mW');
  });

  it('prints ratings with prefixes and ranges', () => {
    expect(formatQuantity('en', { unit: 'A', value: 0.02 })).toBe('20 mA');
    expect(formatQuantity('de', { unit: 'V', min: 1.8, typ: 2, max: 2.2 })).toBe('2 V');
    expect(formatQuantity('de', { unit: 'V', min: 1.8, max: 2.2 })).toBe(`1,8 ${DASH} 2,2 V`);
    expect(formatQuantity('en', { unit: 'ohm', value: 4700 })).toBe('4.7 kΩ');
    expect(formatQuantity('en', { unit: 'percent', value: 5 })).toBe('5 %');
  });

  it('labels ratings with the 2D app labels in every language', () => {
    const seen = new Set(LANGS.map((l) => ratingLabel(l, 'current', 'abs_max')));
    expect(seen.size).toBe(6);
    expect(ratingLabel('en', 'other', 'operating')).toBe('Other, Operating');
  });

  it('builds a model in all six languages without gaps', () => {
    for (const lang of LANGS) {
      const m = buildCard({ ...base, lang, live: true, nets: { A: 'n1', K: 'g' }, volts: { n1: 2, g: 0 }, health: { watts: 0.03, state: 'hot' } });
      expect(m.live.at(-1)!.value).toBe(PROBE[lang].hot);
      expect(m.ratings.every((r) => r.label !== '' && r.value !== '')).toBe(true);
    }
  });
});

describe('card layout and throttle', () => {
  it('grows with its rows and stays inside 360 dmm', () => {
    const idle = layoutCard(buildCard(base));
    const run = layoutCard(buildCard({ ...base, live: true, health: { watts: 0.01, state: 'ok' } }));
    expect(CARD.w).toBeLessThanOrEqual(360);
    expect(run.h).toBeGreaterThan(idle.h - CARD.row);
    expect(idle.ratingsTop).toBeGreaterThan(idle.pinsTop);
    expect(idle.liveTop).toBeGreaterThan(idle.ratingsTop);
  });

  it('redraws at most four times a second', () => {
    expect(redrawDue(0, -1)).toBe(true);
    expect(redrawDue(100, 0)).toBe(false);
    expect(redrawDue(249, 0)).toBe(false);
    expect(redrawDue(250, 0)).toBe(true);
  });

  it('keeps its angular size from 0.4 to 2.0 m', () => {
    expect(angularScale(0.6)).toBeCloseTo(1);
    expect(angularScale(1.2)).toBeCloseTo(2);
    expect(angularScale(0.1)).toBeCloseTo(0.4 / 0.6);
    expect(angularScale(5)).toBeCloseTo(2 / 0.6);
  });
});
