// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NEWTON_OPTIONS } from '../newton-bridge.ts';
import { solve } from '../solve.ts';
import type { DiodeParams, Element } from '../types.ts';
import { VT_300K } from './diode.ts';

const JUNCTION: DiodeParams = { kind: 'shockley', isAmps: 1e-12, n: 1.5, rsOhms: 0, rzOhms: 7, vbrVolts: 5.1 };
const OPTIONS = { ...NEWTON_OPTIONS, reltol: 1e-9 };

// a source and a 100 ohm resistor across the Zener, anode to cathode as `forward` says
function through(volts: number, forward: boolean) {
  const elements: Element[] = [
    { id: 'V1', kind: 'V', a: 1, b: 0, volts, rSeriesOhms: 0 },
    { id: 'R1', kind: 'R', a: 1, b: 2, ohms: 100 },
    { id: 'ZD1', kind: 'D', a: forward ? 2 : 0, b: forward ? 0 : 2, modelId: 'zener', vf: 0.7, rdOhms: 7, maxAmps: 0.2, junction: JUNCTION },
  ];
  const r = solve({ nodes: 3, ground: 0, elements }, { ...OPTIONS, mode: 'newton' });
  expect(r.converged).toBe(true);
  return r.branch.ZD1;
}

describe('a Zener in the Newton solver', () => {
  const nvt = JUNCTION.n * VT_300K;

  it('drops what its junction says forward, with none of the breakdown slope on top', () => {
    const { amps, volts } = through(5, true);
    expect(amps).toBeGreaterThan(0.03);
    expect(volts).toBeCloseTo(nvt * Math.log(amps / JUNCTION.isAmps + 1), 6);
  });

  it('holds its breakdown voltage plus the slope times the current in reverse', () => {
    const { amps, volts } = through(12, false);
    const reverse = Math.abs(amps);
    expect(reverse).toBeGreaterThan(0.05);
    expect(-volts).toBeCloseTo(JUNCTION.vbrVolts! + nvt * Math.log(reverse / JUNCTION.isAmps) + JUNCTION.rzOhms! * reverse, 4);
  });
});
