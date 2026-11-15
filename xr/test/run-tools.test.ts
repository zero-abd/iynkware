/** Run tools (xr/src/run/tools): probe snapping, anchor to net lookup, the meter's reading text and rate, its words. */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import type { Project } from '@/project/generated/types';
import { validateValue } from '@/project/validate';
import type { SimNetlist } from '../src/contracts/sim';
import { createSimBridge, inlinePort } from '../src/sim/bridge';
import { stringProblems } from '../src/run/kit/strings';
import { netIndex, sameTarget, type ClipTarget } from '../src/run/tools/probes/nets';
import { dropOutcome, nearestAnchor, PIN_BIAS, SNAP_M } from '../src/run/tools/probes/snap';
import {
  baseValue,
  createGate,
  decimalMark,
  formatNumber,
  lineOf,
  MAX_READ_HZ,
  planRead,
  READ_EVERY_MS,
  samePlan,
  settingsFor,
  shownOf,
} from '../src/run/tools/meter/logic';
import { meterStrings } from '../src/run/tools/meter/strings';

describe('snapping', () => {
  const xyz = [0, 0, 0, 0.0076, 0, 0, 0.0076, 0, 0.0076];
  const flat = [0, 0, 0];

  it('finds the nearest anchor within 1 cm and nothing beyond', () => {
    expect(nearestAnchor(xyz, flat, 3, 0.001, 0.002, 0)).toBe(0);
    expect(nearestAnchor(xyz, flat, 3, 0.0072, 0, 0.0005)).toBe(1);
    expect(nearestAnchor(xyz, flat, 3, 0.05, 0, 0)).toBe(-1);
    expect(nearestAnchor(xyz, flat, 3, 0, SNAP_M * 1.01, 0)).toBe(-1);
    expect(nearestAnchor(xyz, flat, 0, 0, 0, 0)).toBe(-1);
  });

  it('prefers a pin to a hole at about the same place, but not a far pin', () => {
    // Index 0 is a hole at x = 0, index 1 a pin 1 mm away: halfway between them the pin wins, a little nearer the hole it loses.
    const pts = [0, 0, 0, 0.001, 0, 0];
    expect(nearestAnchor(pts, [0, 1], 2, 0.0005, 0, 0)).toBe(1);
    expect(nearestAnchor(pts, [0, 1], 2, 0.0004, 0, 0)).toBe(0);
    expect(nearestAnchor(pts, [1, 0], 2, 0.0005, 0, 0)).toBe(0);
    expect(PIN_BIAS).toBeLessThan(1);
    // A pin far from the tip loses to a nearer hole.
    expect(nearestAnchor([0.009, 0, 0, 0.002, 0, 0], [1, 0], 2, 0, 0, 0)).toBe(1);
  });

  it('settles a release: clip when snapped, park over the bench, rack when let go off it', () => {
    const top = { w: 0.9, d: 0.5 };
    expect(dropOutcome(true, top, 0, 0.1, 0)).toBe('clip');
    expect(dropOutcome(false, top, 0.1, 0.1, 0.1)).toBe('park');
    expect(dropOutcome(false, top, 1.3, 0.2, 0.1)).toBe('rack');
    expect(dropOutcome(false, top, 0, 0.1, 0.9)).toBe('rack');
    expect(dropOutcome(false, top, 0, 2, 0)).toBe('rack');
  });
});

describe('anchors to nets', () => {
  let doc: Project;
  let nl: SimNetlist;
  beforeAll(async () => {
    const report = validateValue(await loadTemplate('prj_uno-r3-blink'));
    if (!report.ok || !report.doc) throw new Error('the Blink template did not load');
    doc = report.doc;
    const bridge = createSimBridge({ port: inlinePort({ wallMs: () => 0, schedule: () => undefined }) });
    await bridge.load(doc);
    nl = bridge.netlist!;
    await bridge.dispose();
  });
  const pin = (part: string, id: string): ClipTarget => ({ kind: 'pin', part, id });
  const hole = (id: string): ClipTarget => ({ kind: 'hole', part: 'cmp_bb', id });

  it('reads a pin from the netlist and a hole through its strip', () => {
    const ix = netIndex(doc, nl);
    const d13 = nl.parts.find((p) => p.id === 'brd_main')!.pins.D13!;
    const anode = nl.parts.find((p) => p.id === 'cmp_led1')!.pins.A!;
    const ground = nl.ground;
    expect(ix.netOf(pin('brd_main', 'D13'))).toBe(d13);
    expect(ix.netOf(pin('cmp_led1', 'K'))).toBe(ground);
    // a10 holds the orange wire from D13; b10 holds the resistor's first leg, so the whole strip is D13.
    expect(ix.netOf(hole('a10'))).toBe(d13);
    expect(ix.netOf(hole('e10'))).toBe(d13);
    // the other half of the column is a different strip: nothing in it.
    expect(ix.netOf(hole('f10'))).toBeNull();
    // c14 holds the LED's anode and the resistor's far leg; a15 the ground wire and the LED's cathode.
    expect(ix.netOf(hole('c14'))).toBe(anode);
    expect(ix.netOf(hole('a15'))).toBe(ground);
    expect(ix.netOf(hole('e22'))).toBeNull();
    expect(ix.netOf(pin('brd_main', 'D2'))).toBeNull();
  });

  it('finds the part between two nets, never a board', () => {
    const ix = netIndex(doc, nl);
    const d13 = ix.netOf(pin('brd_main', 'D13'))!;
    const anode = ix.netOf(pin('cmp_led1', 'A'))!;
    expect(ix.elementBetween(d13, anode)).toBe('cmp_res1');
    expect(ix.elementBetween(anode, nl.ground)).toBe('cmp_led1');
    expect(ix.elementBetween(d13, nl.ground)).toBeNull();
    expect(ix.elementBetween(d13, d13)).toBeNull();
  });

  it('plans a read: the nets for a mode, or why there is none', () => {
    const ix = netIndex(doc, nl);
    const a = pin('cmp_res1', 'P1');
    const b = pin('cmp_res1', 'P2');
    const volts = planRead('dc-volts', a, b, ix);
    expect(volts).toEqual({ probes: { red: ix.netOf(a), black: ix.netOf(b), element: null } });
    const amps = planRead('dc-amps', a, b, ix);
    expect('probes' in amps && amps.probes.element).toBe('cmp_res1');
    expect(planRead('dc-amps', pin('brd_main', 'D13'), pin('brd_main', 'GND'), ix)).toEqual({ reason: 'no-element' });
    expect(planRead('dc-volts', a, null, ix)).toEqual({ reason: 'free' });
    expect(planRead('dc-volts', null, null, ix)).toEqual({ reason: 'free' });
    expect(planRead('dc-volts', a, b, null)).toEqual({ reason: 'not-loaded' });
    expect(planRead('resistance', a, hole('e22'), ix)).toEqual({ reason: 'no-net' });
    expect(samePlan(volts, planRead('dc-volts', a, b, ix))).toBe(true);
    expect(samePlan(volts, amps)).toBe(false);
    expect(sameTarget(a, { ...a })).toBe(true);
    expect(sameTarget(a, b)).toBe(false);
  });

  it('gives the worker what it reads: an ideal meter on those nets', async () => {
    const bridge = createSimBridge({ port: inlinePort({ wallMs: () => 0, schedule: () => undefined }) });
    await bridge.load(doc);
    await bridge.step(50);
    const ix = netIndex(doc, bridge.netlist!);
    const amps = planRead('dc-amps', pin('cmp_res1', 'P1'), pin('cmp_res1', 'P2'), ix);
    if (!('probes' in amps)) throw new Error('no plan');
    const read = await bridge.meter('t', settingsFor('dc-amps'), amps.probes);
    expect(typeof read.value).toBe('number');
    const ohms = planRead('resistance', pin('cmp_res1', 'P1'), pin('cmp_res1', 'P2'), ix);
    if (!('probes' in ohms)) throw new Error('no plan');
    const r = await bridge.meter('t', settingsFor('resistance'), ohms.probes);
    expect(shownOf('resistance', r, 'en')).toMatchObject({ text: '220.0', unit: 'Ω' });
    await bridge.dispose();
  });
});

describe('writing a reading', () => {
  it('uses four digits and an SI prefix', () => {
    expect(formatNumber(2.0343, 'V', 'en')).toEqual({ text: '2.034', unit: 'V' });
    expect(formatNumber(0.0146, 'A', 'en')).toEqual({ text: '14.60', unit: 'mA' });
    expect(formatNumber(4700, 'Ω', 'en')).toEqual({ text: '4.700', unit: 'kΩ' });
    expect(formatNumber(220, 'Ω', 'en')).toEqual({ text: '220.0', unit: 'Ω' });
    expect(formatNumber(2.2e6, 'Ω', 'en')).toEqual({ text: '2.200', unit: 'MΩ' });
    expect(formatNumber(0.00005, 'A', 'en')).toEqual({ text: '50.00', unit: 'µA' });
    expect(formatNumber(0.8, 'V', 'en')).toEqual({ text: '800.0', unit: 'mV' });
  });

  it('carries a rounded-up value into the next prefix, and drops the sign of zero', () => {
    expect(formatNumber(0.99999, 'V', 'en')).toEqual({ text: '1.000', unit: 'V' });
    expect(formatNumber(999.99, 'Ω', 'en')).toEqual({ text: '1.000', unit: 'kΩ' });
    expect(formatNumber(0, 'V', 'en')).toEqual({ text: '0.000', unit: 'V' });
    expect(formatNumber(-1e-12, 'V', 'en')).toEqual({ text: '0.000', unit: 'V' });
    expect(formatNumber(-2.006, 'V', 'en')).toEqual({ text: '-2.006', unit: 'V' });
  });

  it('uses the language decimal mark', () => {
    expect(decimalMark('de')).toBe(',');
    expect(decimalMark('hi')).toBe('.');
    expect(formatNumber(2.034, 'V', 'de').text).toBe('2,034');
    expect(formatNumber(2.034, 'V', 'fr').text).toBe('2,034');
    expect(formatNumber(2.034, 'V', 'zh').text).toBe('2.034');
  });

  it('reads the base value back out of a prefixed reading', () => {
    expect(baseValue(4.7, 'kΩ', 'Ω')).toBeCloseTo(4700);
    expect(baseValue(12, 'mA', 'A')).toBeCloseTo(0.012);
    expect(baseValue(3, 'V', 'V')).toBe(3);
    expect(baseValue(3, undefined, 'V')).toBe(3);
  });

  const reading = (value: number | string | boolean | null, unit?: string) =>
    ({ value, unit, at: 0, provenance: 'computed', tier: 'T1', modelIds: [] }) as never;

  it('shows a reading, an open circuit, a closed one and the reasons for `--`', () => {
    expect(shownOf('dc-volts', reading(2.006, 'V'), 'en')).toMatchObject({ text: '2.006', unit: 'V', reason: null });
    expect(lineOf(shownOf('dc-amps', reading(0.01222), 'en'))).toBe('12.22 mA');
    expect(shownOf('resistance', reading(4.7, 'kΩ'), 'en')).toMatchObject({ text: '4.700', unit: 'kΩ' });
    expect(shownOf('resistance', reading('open'), 'en')).toMatchObject({ text: 'OL', unit: 'Ω' });
    expect(shownOf('continuity', reading(true), 'en')).toMatchObject({ closed: true });
    expect(shownOf('continuity', reading(false), 'en')).toMatchObject({ closed: false });
    expect(shownOf('dc-volts', null, 'en', 'free')).toMatchObject({ text: '--', reason: 'free' });
    expect(shownOf('dc-volts', reading(null), 'en')).toMatchObject({ text: '--', reason: 'no-value' });
    expect(shownOf('continuity', null, 'en', 'no-net').unit).toBe('');
  });

  it('asks the worker for an ideal meter in the mode', () => {
    expect(settingsFor('dc-amps')).toEqual({ mode: 'dc-amps', loading: false, burdenOhms: 0 });
  });
});

describe('the read rate', () => {
  it('never asks more than 10 times a second, and 4 times a second by default', () => {
    expect(MAX_READ_HZ).toBe(10);
    const frames = Array.from({ length: 360 }, (_, i) => i * 16);
    const run = (every: number, soonAt: number[] = []) => {
      const g = createGate(every);
      const at: number[] = [];
      for (const t of frames) {
        if (soonAt.includes(t)) g.soon();
        if (g.due(t)) {
          g.mark(t);
          at.push(t);
        }
      }
      return at;
    };
    const normal = run(READ_EVERY_MS);
    expect(normal.length).toBeLessThanOrEqual(Math.ceil(5.76 / (READ_EVERY_MS / 1000)));
    for (let i = 1; i < normal.length; i++) expect(normal[i]! - normal[i - 1]!).toBeGreaterThanOrEqual(READ_EVERY_MS);
    // Asking for a faster rate is capped at 10 Hz.
    const fast = run(10);
    for (let i = 1; i < fast.length; i++) expect(fast[i]! - fast[i - 1]!).toBeGreaterThanOrEqual(100);
    // A change asks for the next read as soon as 10 Hz allows, then it is back to the normal rate.
    const eager = run(READ_EVERY_MS, [16 * 20]);
    const gap = eager.find((t) => t > 16 * 20)! - eager.filter((t) => t <= 16 * 20).at(-1)!;
    expect(gap).toBeGreaterThanOrEqual(100);
    expect(gap).toBeLessThan(READ_EVERY_MS);
  });
});

describe('the words', () => {
  it('are in six languages with the same placeholders', () => {
    expect(stringProblems(meterStrings.table)).toEqual([]);
  });
});
