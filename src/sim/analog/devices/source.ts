import { PWL_COMPAT } from '../elements.ts';
import type { Limiter, Stamper } from '../newton.ts';
import type { ElementV, SourceLimit } from '../types.ts';
import type { NewtonDevice } from './index.ts';

/** A voltage behind a series resistance that holds its current to `limit` by letting its voltage sag. */
export interface Thevenin { id: string; a: number; b: number; volts: number; rSeriesOhms: number; limit?: SourceLimit }

// a limited source may move its terminal voltage this far, or its own voltage when that is more, in one Newton iteration
const REACH_VOLTS = 1;

const siemens = (e: Thevenin) => 1 / Math.max(e.rSeriesOhms, PWL_COMPAT.minOhms);

// The current is the Thevenin current for a light load and the limit for a heavy one, with a smooth knee between, so a
// load near the limit does not make the iteration flip between the two. A source carries the limit to a millionth once
// its terminal sits more than seven times limit * rSeries below its voltage.
function delivered(e: Thevenin, vd: number): { amps: number; siemens: number } {
  const g = siemens(e);
  if (!e.limit) return { amps: (e.volts - vd) * g, siemens: g };
  const t = Math.tanh((g * (e.volts - vd)) / e.limit.amps);
  return { amps: e.limit.amps * t, siemens: g * (1 - t * t) };
}

export const deliveredAmps = (e: Thevenin, vd: number): number => delivered(e, vd).amps;

/** Stamps the source linearised at the terminal voltage of the iterate `x`, which a limited source approaches in steps. */
export function stampSource(e: Thevenin, x: Float64Array, s: Stamper, lim: Limiter): void {
  const now = x[e.a] - x[e.b];
  const was = s.junctionVolts.get(e.id) ?? now;
  const vd = e.limit ? lim.within(now, was, Math.max(REACH_VOLTS, Math.abs(e.volts))) : now;
  if (e.limit) s.junctionVolts.set(e.id, vd);
  const { amps, siemens: slope } = delivered(e, vd);
  s.conduct(e.a, e.b, slope);
  s.current(e.a, e.b, -(amps + slope * vd));
}

export const voltageSourceDevice: NewtonDevice<ElementV> = {
  kind: 'V',
  validate: (e) => (e.limit && !(e.limit.amps > 0) ? `limit ${e.limit.amps} A is not positive` : null),
  stamp: (e, x, s, lim) => stampSource(e, x, s, lim),
  currents: (e, x) => [deliveredAmps(e, x[e.a] - x[e.b])],
  measure(e, x) {
    const volts = x[e.a] - x[e.b];
    const amps = deliveredAmps(e, volts);
    return { amps, volts, watts: amps * volts };
  },
};
