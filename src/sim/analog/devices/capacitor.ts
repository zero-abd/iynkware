import type { ElementC, TransientStep } from '../types.ts';
import type { NewtonDevice } from './index.ts';

// The ideal capacitor keeps its own voltage `v` and current `i` between steps. Its companion model is a conductance
// `g` with a history current `hist` (i = g * vt - hist), and the series resistance folds into both so the
// capacitor needs no node of its own:
//   trapezoidal  gc = 2C/h, hist = gc * v + i      backward Euler  gc = C/h, hist = gc * v
export interface Companion { g: number; hist: number }

export function capacitorCompanion(e: ElementC, step: TransientStep): Companion {
  const prev = step.prev[e.id];
  const v = prev?.kind === 'C' ? prev.v : (e.v0 ?? 0);
  const i = prev?.kind === 'C' ? prev.i : 0;
  const trap = step.method === 'trapezoidal';
  const gc = (trap ? 2 : 1) * e.farads / step.hSeconds;
  const k = 1 + gc * e.esrOhms;
  return { g: gc / k, hist: (gc * v + (trap ? i : 0)) / k };
}

function amps(e: ElementC, x: Float64Array, step?: TransientStep): number {
  if (!step) return 0;
  const { g, hist } = capacitorCompanion(e, step);
  return g * (x[e.a] - x[e.b]) - hist;
}

export const capacitorDevice: NewtonDevice<ElementC> = {
  kind: 'C',
  validate(e) {
    if (!(e.farads > 0 && Number.isFinite(e.farads))) return `farads ${e.farads} is not positive`;
    if (!(e.esrOhms >= 0)) return `esrOhms ${e.esrOhms} is negative`;
    return null;
  },
  stamp(e, x, s, _lim, step) {
    if (!step) return;
    const { g, hist } = capacitorCompanion(e, step);
    s.conduct(e.a, e.b, g);
    s.current(e.a, e.b, -hist);
  },
  memory(e, x, step) {
    const vt = x[e.a] - x[e.b];
    const i = amps(e, x, step);
    return { kind: 'C', v: step ? vt - e.esrOhms * i : vt, i };
  },
  currents: (e, x, step) => [amps(e, x, step)],
  measure(e, x, step) {
    const i = amps(e, x, step);
    const volts = x[e.a] - x[e.b];
    return { amps: i, volts, watts: i * i * e.esrOhms };
  },
};
