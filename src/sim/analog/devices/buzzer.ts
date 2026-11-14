import { PWL_COMPAT } from '../elements.ts';
import type { ElementBz } from '../types.ts';
import type { NewtonDevice } from './index.ts';

// How wide the knee at `vf` is rounded, so the iteration has a slope to follow on either side of it
const KNEE_VOLTS = 0.02;

// ln(1 + e^x) without overflow
const softplus = (x: number) => Math.max(x, 0) + Math.log1p(Math.exp(-Math.abs(x)));

const siemens = (e: ElementBz) => 1 / Math.max(e.rdOhms, PWL_COMPAT.minOhms);

// An active buzzer conducts one way, from `vf` up, through the resistance of its driver; a passive piezo passes no direct current.
// The current is (v - vf) / rd with the corner at vf rounded over KNEE_VOLTS.
function conducts(e: ElementBz, vd: number): { amps: number; siemens: number } {
  if (!e.active) return { amps: 0, siemens: 0 };
  const x = (vd - e.vf) / KNEE_VOLTS;
  return { amps: siemens(e) * KNEE_VOLTS * softplus(x), siemens: siemens(e) / (1 + Math.exp(-x)) };
}

export const buzzerDevice: NewtonDevice<ElementBz> = {
  kind: 'BZ',
  validate: (e) => (e.active && !(e.rdOhms > 0) ? `rdOhms ${e.rdOhms} is not positive` : null),
  stamp(e, x, s) {
    if (!e.active) return;
    const vd = x[e.a] - x[e.b];
    const { amps, siemens: slope } = conducts(e, vd);
    s.conduct(e.a, e.b, slope);
    s.current(e.a, e.b, amps - slope * vd);
  },
  currents: (e, x) => [conducts(e, x[e.a] - x[e.b]).amps],
  measure(e, x) {
    const volts = x[e.a] - x[e.b];
    const { amps } = conducts(e, volts);
    return { amps, volts, watts: amps * volts, state: e.active && volts > e.vf ? 'on' : 'off' };
  },
};
