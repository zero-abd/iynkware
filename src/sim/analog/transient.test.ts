// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PWL_OPTIONS } from './elements.ts';
import fixture from './fixtures/ngspice/transient.json';
import { TransientRun } from './transient.ts';
import type { Element } from './types.ts';

const OPTIONS = { ...PWL_OPTIONS, mode: 'newton' as const, reltol: 1e-6, maxIter: 100 };
const V = (id: string, a: number, volts: number): Element => ({ id, kind: 'V', a, b: 0, volts, rSeriesOhms: 0 });
const R = (id: string, a: number, b: number, ohms: number): Element => ({ id, kind: 'R', a, b, ohms });

function run(nodes: number, elements: Element[], h: number) {
  return new TransientRun({ nodes, ground: 0, elements }, OPTIONS, h);
}

describe('closed-form answers', () => {
  it('charges an RC to 5(1 - e^(-t/RC)) within 0.1 percent of the supply', () => {
    const sim = run(3, [V('V1', 1, 5), R('R1', 1, 2, 1000), { id: 'C1', kind: 'C', a: 2, b: 0, farads: 1e-6, esrOhms: 0, v0: 0, polarized: false }], 1e-6);
    let worst = 0;
    sim.advanceTo(5e-3, (r, t) => { worst = Math.max(worst, Math.abs(r.v[2] - 5 * (1 - Math.exp(-t / 1e-3)))); });
    expect(worst).toBeLessThan(5e-3);
  });

  it('rises an RL current to V/R (1 - e^(-tR/L))', () => {
    const sim = run(3, [V('V1', 1, 5), R('R1', 1, 2, 100), { id: 'L1', kind: 'L', a: 2, b: 0, henries: 10e-3, dcrOhms: 0, i0: 0 }], 1e-6);
    let worst = 0;
    sim.advanceTo(300e-6, (r, t) => { worst = Math.max(worst, Math.abs(r.branch.L1.amps - 0.05 * (1 - Math.exp(-t * 100 / 10e-3)))); });
    expect(worst).toBeLessThan(0.05 * 1e-2);
  });

  it('rings an underdamped RLC at its damped frequency', () => {
    const sim = run(4, [V('V1', 1, 5), R('R1', 1, 2, 10), { id: 'L1', kind: 'L', a: 2, b: 3, henries: 1e-3, dcrOhms: 0, i0: 0 }, { id: 'C1', kind: 'C', a: 3, b: 0, farads: 1e-6, esrOhms: 0, v0: 0, polarized: false }], 1e-6);
    const alpha = 5000, wd = Math.sqrt(1 / (1e-3 * 1e-6) - alpha * alpha);
    let worst = 0;
    sim.advanceTo(500e-6, (r, t) => { worst = Math.max(worst, Math.abs(r.v[3] - 5 * (1 - Math.exp(-alpha * t) * (Math.cos(wd * t) + (alpha / wd) * Math.sin(wd * t))))); });
    expect(worst).toBeLessThan(5 * 1e-2);
  });
});

describe('op-amp', () => {
  const oa = (inP: number, inN: number, out: number): Element => ({ id: 'U1', kind: 'OA', inP, inN, out, vcc: 4, vee: 5, openLoopGain: 1e5, gbwHz: 1e6, slewVPerUs: 0.5, rOutOhms: 75, headroomVolts: 1.5 });
  const rails = [V('VP', 4, 12), V('VN', 5, -12)];

  it('inverts with gain -R2/R1', () => {
    const r = run(6, [...rails, V('VIN', 1, 0.5), R('R1', 1, 2, 1000), R('R2', 2, 3, 10000), oa(0, 2, 3)], 1e-6).result;
    expect(r.converged).toBe(true);
    expect(r.v[3]).toBeCloseTo(-5, 2);
  });

  it('amplifies without inverting with gain 1 + R2/R1', () => {
    const r = run(6, [...rails, V('VIN', 1, 0.5), R('R1', 2, 0, 1000), R('R2', 2, 3, 10000), oa(1, 2, 3)], 1e-6).result;
    expect(r.v[3]).toBeCloseTo(5.5, 2);
  });

  it('clips inside the rails, headroom short of them', () => {
    const r = run(6, [...rails, V('VIN', 1, 3), R('R1', 1, 2, 1000), R('R2', 2, 3, 10000), oa(0, 2, 3)], 1e-6).result;
    // the clamp sits at -12 + 1.5 V; the 11 k feedback load drops a little of it across the 75 ohm output resistance
    expect(r.v[3]).toBeCloseTo((-10.5 * 11000 + 3 * 75) / 11075, 3);
    expect(r.state.U1).toBe('sat');
  });
});

describe('op-amp on a single supply', () => {
  const lm358 = (inP: number, inN: number, out: number): Element => ({ id: 'U1', kind: 'OA', inP, inN, out, vcc: 4, vee: 0, openLoopGain: 1e5, gbwHz: 1e6, slewVPerUs: 0.3, rOutOhms: 75, headroomVolts: 1.5, headroomLowVolts: 0.02 });
  const gain11 = (source: Element, h: number) => run(5, [V('VCC', 4, 5), source, R('R1', 2, 0, 1000), R('R2', 2, 3, 10000), lm358(1, 2, 3)], h);
  const sine = (hz: number, amplitudeV: number, offsetV: number): Element => ({ id: 'VG', kind: 'VW', a: 1, b: 0, shape: 'sine', amplitudeV, offsetV, hz, duty: 0.5, phaseDeg: 0, rSeriesOhms: 50 });

  it('amplifies a 1 kHz sine by 11 and not by the lag of a saturated stage', () => {
    for (const h of [1e-6, 10e-6]) {
      const sim = gain11(sine(1000, 0.1, 0.2), h);
      let low = Infinity, high = -Infinity;
      sim.advanceTo(3e-3, (r, t) => { if (t > 1e-3) { low = Math.min(low, r.v[3]); high = Math.max(high, r.v[3]); } });
      // 0.2 V +- 0.1 V in: 1.1 V to 3.3 V out, an 11 x swing
      expect(high - low).toBeGreaterThan(2.1);
      expect(high - low).toBeLessThan(2.3);
      expect((high + low) / 2).toBeCloseTo(2.2, 1);
    }
  });

  it('follows a 10 Hz sine the same way', () => {
    const sim = gain11(sine(10, 0.1, 0.2), 10e-6);
    let low = Infinity, high = -Infinity;
    sim.advanceTo(0.2, (r, t) => { if (t > 0.1) { low = Math.min(low, r.v[3]); high = Math.max(high, r.v[3]); } });
    expect(high - low).toBeGreaterThan(2.1);
    expect(high - low).toBeLessThan(2.3);
  });

  it('reaches the negative rail within 20 mV and the positive one 1.5 V short', () => {
    const below = gain11({ id: 'VG', kind: 'V', a: 1, b: 0, volts: -0.3, rSeriesOhms: 0 }, 1e-6).result;
    const above = gain11({ id: 'VG', kind: 'V', a: 1, b: 0, volts: 1, rSeriesOhms: 0 }, 1e-6).result;
    expect(below.v[3]).toBeGreaterThan(0.015);
    expect(below.v[3]).toBeLessThan(0.05);
    expect(above.v[3]).toBeGreaterThan(3.45);
    expect(above.v[3]).toBeLessThan(3.52);
  });

  it('gives 1.1 V for 0.1 V in, where the one shared headroom gave 1.5 V', () => {
    expect(gain11({ id: 'VG', kind: 'V', a: 1, b: 0, volts: 0.1, rSeriesOhms: 0 }, 1e-6).result.v[3]).toBeCloseTo(1.1, 2);
  });
});

describe('555 astable', () => {
  it('runs at the period ln2 (R1 + 2 R2 + rdis) C', () => {
    const r1 = 1000, r2 = 10000, c = 100e-9, rdis = 10;
    const tmr: Element = { id: 'U1', kind: 'TMR', gnd: 0, trig: 3, out: 4, reset: 1, ctrl: 5, thr: 3, dis: 2, vcc: 1, rOutOhms: 20, highDropVolts: 1.7, disOnOhms: rdis, quiescentAmps: 0.003 };
    const sim = run(6, [V('VCC', 1, 5), R('R1', 1, 2, r1), R('R2', 2, 3, r2), { id: 'C1', kind: 'C', a: 3, b: 0, farads: c, esrOhms: 0, polarized: false }, tmr], 1e-6);
    const rises: number[] = [];
    let was = sim.result.v[4] > 2.5;
    sim.advanceTo(12e-3, (res, t) => {
      const high = res.v[4] > 2.5;
      if (high && !was) rises.push(t);
      was = high;
    });
    expect(rises.length).toBeGreaterThan(5);
    const period = (rises.at(-1)! - rises[1]) / (rises.length - 2);
    const want = Math.LN2 * (r1 + 2 * r2 + rdis) * c;
    expect(Math.abs(period - want) / want).toBeLessThan(0.01);
  });
});

describe('against ngspice', () => {
  it.each(fixture.cases)('$id stays within 1 percent of the trace', (c) => {
    const elements = c.elements as unknown as Element[];
    const sim = new TransientRun({ nodes: c.nodes.length, ground: 0, elements }, OPTIONS, c.stepSeconds);
    const names = Object.keys(c.traces);
    const peak = Math.max(...names.flatMap((n) => (c.traces as Record<string, number[]>)[n].map(Math.abs)));
    const every = Math.round(c.gridSeconds / c.stepSeconds);
    let worst = 0;
    let k = 0;
    sim.advanceTo(((c.traces[names[0] as keyof typeof c.traces] as number[]).length - 1) * c.gridSeconds, (r) => {
      k++;
      if (k % every) return;
      names.forEach((n) => { worst = Math.max(worst, Math.abs(r.v[c.nodes.indexOf(n)] - (c.traces as Record<string, number[]>)[n][k / every])); });
    });
    expect(worst / peak).toBeLessThan(0.01);
  });
});

describe('a settled circuit', () => {
  const rc = (source: Element): Element[] => [source, R('R1', 1, 2, 1000), { id: 'C1', kind: 'C', a: 2, b: 0, farads: 1e-7, esrOhms: 0, v0: 0, polarized: false }];
  const supply = V('V1', 1, 5);

  it('stops being solved once the capacitor holds 5 V, and the answer it keeps is the settled one', () => {
    const sim = run(3, rc(supply), 1e-5);
    sim.advanceTo(20e-3);
    const settled = sim.result;
    expect(settled.v[2]).toBeCloseTo(5, 4);
    sim.advanceTo(40e-3);
    expect(sim.result).toBe(settled);
    expect(sim.t).toBeCloseTo(40e-3, 9);
  });

  it('is solved again after a change, from what the capacitor holds', () => {
    const sim = run(3, rc(supply), 1e-5);
    sim.advanceTo(20e-3);
    const settled = sim.result;
    sim.elements = rc(V('V1', 1, 2));
    sim.disturb();
    sim.advanceTo(21e-3);
    expect(sim.result).not.toBe(settled);
    expect(sim.result.v[2]).toBeLessThan(5);
    expect(sim.result.v[2]).toBeGreaterThan(2);
  });

  it('keeps stepping while a source is on a clock', () => {
    const wave: Element = { id: 'VW1', kind: 'VW', a: 1, b: 0, shape: 'sine', amplitudeV: 1, offsetV: 0, hz: 1000, duty: 0.5, phaseDeg: 0, rSeriesOhms: 0 };
    const sim = run(3, rc(wave), 1e-5);
    sim.advanceTo(20e-3);
    const before = sim.result;
    sim.advanceTo(20.1e-3);
    expect(sim.result).not.toBe(before);
  });

  it('carries its quiet count through a saved state', () => {
    const sim = run(3, rc(supply), 1e-5);
    sim.advanceTo(20e-3);
    const resumed = new TransientRun({ nodes: 3, ground: 0, elements: sim.elements }, OPTIONS, 1e-5, sim.state());
    resumed.advanceTo(21e-3);
    expect(resumed.result).toBe(sim.result);
  });
});
