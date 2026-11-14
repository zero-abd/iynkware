// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { autoStepNs, clockStepNs, MAX_STEP_NS, MIN_STEP_NS, waveStepNs } from './step.ts';
import type { Element } from './types.ts';

const R = (a: number, b: number, ohms: number): Element => ({ id: `R${a}${b}`, kind: 'R', a, b, ohms });
const C = (a: number, b: number, farads: number): Element => ({ id: `C${a}${b}`, kind: 'C', a, b, farads, esrOhms: 0, polarized: false });
const L = (a: number, b: number, henries: number): Element => ({ id: `L${a}${b}`, kind: 'L', a, b, henries, dcrOhms: 0 });
const V = (a: number, rSeriesOhms = 0): Element => ({ id: `V${a}`, kind: 'V', a, b: 0, volts: 5, rSeriesOhms });
const D = (a: number, b: number): Element => ({ id: `D${a}${b}`, kind: 'D', a, b, modelId: 'model:led.pwl@1', vf: 2, rdOhms: 0.5, maxAmps: 0.02 });
const VW = (hz: number): Element => ({ id: 'VG', kind: 'VW', a: 1, b: 0, shape: 'sine', amplitudeV: 1, offsetV: 0, hz, duty: 0.5, phaseDeg: 0, rSeriesOhms: 50 });

describe('autoStepNs', () => {
  it('takes a fiftieth of the time constant, down to the 1, 2, 5 ladder', () => {
    // 1 k and 1 uF is 1 ms, a fiftieth is 20 us
    expect(autoStepNs([V(1), R(1, 2, 1000), C(2, 0, 1e-6)])).toBe(20_000);
  });

  it('never goes under the floor or over the ceiling', () => {
    expect(autoStepNs([V(1), R(1, 2, 100), C(2, 0, 1e-9)])).toBe(MIN_STEP_NS);
    expect(autoStepNs([V(1), R(1, 2, 10_000), C(2, 0, 100e-6)])).toBe(MAX_STEP_NS);
  });

  it('sizes an inductor by L over R', () => {
    // 10 mH over 100 ohms is 100 us, a fiftieth is 2 us, which the floor lifts
    expect(autoStepNs([V(1), R(1, 2, 100), L(2, 0, 10e-3)])).toBe(MIN_STEP_NS);
    expect(autoStepNs([V(1), R(1, 2, 10), L(2, 0, 1)])).toBe(MAX_STEP_NS);
  });

  it('follows the fastest of several, and a waveform source at a hundred points a period', () => {
    expect(autoStepNs([V(1), R(1, 2, 10_000), C(2, 0, 100e-6), V(3), R(3, 4, 1000), C(4, 0, 1e-6)])).toBe(20_000);
    expect(autoStepNs([V(1), R(1, 2, 10_000), C(2, 0, 100e-6), VW(500)])).toBe(20_000);
    expect(autoStepNs([V(1), R(1, 2, 10_000), C(2, 0, 100e-6), VW(50)])).toBe(MAX_STEP_NS / 5);
  });

  it('ignores a wire-sized resistance, and falls back to a quiet step when nothing sizes it', () => {
    expect(autoStepNs([V(1), R(1, 2, 0.01), C(2, 0, 1e-6)])).toBe(MIN_STEP_NS);
    expect(autoStepNs([V(1), R(1, 2, 1000)])).toBe(100_000);
    // a supply put on at run time is not in the circuit: the smallest resistor on the capacitor stands in
    expect(autoStepNs([R(1, 2, 1000), C(2, 0, 1e-6)])).toBe(20_000);
    expect(autoStepNs([C(2, 0, 1e-6)])).toBe(100_000);
  });

  it("adds up the way through a diode, a resistor and the source's own resistance", () => {
    // an LED then 10 k from a 5 V pin that has 25 ohms: about 10 k and 100 uF is 1 s, a fiftieth is 20 ms, so the ceiling
    expect(autoStepNs([V(1, 25), R(1, 2, 10_000), D(2, 3), C(3, 0, 100e-6)])).toBe(MAX_STEP_NS);
    // the same with 1 k and 1 uF is 1 ms plus a little, a fiftieth of it is 20 us
    expect(autoStepNs([V(1, 25), R(1, 2, 1000), D(2, 3), C(3, 0, 1e-6)])).toBe(20_000);
  });
});

describe('waveStepNs', () => {
  it('is the step a lone generator asks for, a hundred points a period down to the finest step', () => {
    for (const hz of [0.1, 50, 500, 1000, 20_000, 1e6]) expect(waveStepNs(hz)).toBe(clockStepNs([VW(hz)]));
    expect(waveStepNs(500)).toBe(20_000);
    expect(waveStepNs(1e6)).toBe(MIN_STEP_NS);
  });
});
