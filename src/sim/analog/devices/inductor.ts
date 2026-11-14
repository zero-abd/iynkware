import type { ElementL, TransientStep } from '../types.ts';
import type { NewtonDevice } from './index.ts';
import type { Companion } from './capacitor.ts';

// A DC operating point treats the inductor as its winding resistance; this floor keeps a coil with no resistance solvable.
const DC_MIN_OHMS = 1e-3;

// The ideal inductor keeps its voltage `v` and current `i`; with the winding resistance folded in the branch is a
// conductance and a history current, i = g * vt + hist:
//   trapezoidal  k = h/2L, hist = (k * v + i) / (1 + k r)      backward Euler  k = h/L, hist = i / (1 + k r)
function companion(e: ElementL, step: TransientStep): Companion {
  const prev = step.prev[e.id];
  const v = prev?.kind === 'L' ? prev.v : 0;
  const i = prev?.kind === 'L' ? prev.i : (e.i0 ?? 0);
  const trap = step.method === 'trapezoidal';
  const k = (trap ? 0.5 : 1) * step.hSeconds / e.henries;
  const d = 1 + k * e.dcrOhms;
  return { g: k / d, hist: ((trap ? k * v : 0) + i) / d };
}

function amps(e: ElementL, x: Float64Array, step?: TransientStep): number {
  const vt = x[e.a] - x[e.b];
  if (!step) return vt / Math.max(e.dcrOhms, DC_MIN_OHMS);
  const { g, hist } = companion(e, step);
  return g * vt + hist;
}

export const inductorDevice: NewtonDevice<ElementL> = {
  kind: 'L',
  validate(e) {
    if (!(e.henries > 0 && Number.isFinite(e.henries))) return `henries ${e.henries} is not positive`;
    if (!(e.dcrOhms >= 0)) return `dcrOhms ${e.dcrOhms} is negative`;
    return null;
  },
  stamp(e, x, s, _lim, step) {
    if (!step) {
      s.conduct(e.a, e.b, 1 / Math.max(e.dcrOhms, DC_MIN_OHMS));
      return;
    }
    const { g, hist } = companion(e, step);
    s.conduct(e.a, e.b, g);
    s.current(e.a, e.b, hist);
  },
  memory(e, x, step) {
    const i = amps(e, x, step);
    return { kind: 'L', v: step ? x[e.a] - x[e.b] - e.dcrOhms * i : 0, i };
  },
  currents: (e, x, step) => [amps(e, x, step)],
  measure(e, x, step) {
    const i = amps(e, x, step);
    return { amps: i, volts: x[e.a] - x[e.b], watts: i * i * e.dcrOhms };
  },
};
