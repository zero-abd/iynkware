import type { ElementVw, TransientStep } from '../types.ts';
import { waveValue } from '../waveform.ts';
import type { NewtonDevice } from './index.ts';
import { deliveredAmps, stampSource } from './source.ts';

// the source at the instant a step ends, as the plain source with that value
const at = (e: ElementVw, step?: TransientStep) => ({ ...e, volts: waveValue(e, step?.tSeconds ?? 0) });

export const waveSourceDevice: NewtonDevice<ElementVw> = {
  kind: 'VW',
  validate(e) {
    if (!(e.rSeriesOhms >= 0)) return `rSeriesOhms ${e.rSeriesOhms} is negative`;
    if (!(e.hz >= 0 && Number.isFinite(e.hz))) return `hz ${e.hz} is negative`;
    if (e.shape === 'pulse' && !(e.duty >= 0 && e.duty <= 1)) return `duty ${e.duty} is outside 0..1`;
    if (e.limit && !(e.limit.amps > 0)) return `limit ${e.limit.amps} A is not positive`;
    return null;
  },
  stamp: (e, x, s, lim, step) => stampSource(at(e, step), x, s, lim),
  currents: (e, x, step) => [deliveredAmps(at(e, step), x[e.a] - x[e.b])],
  measure(e, x, step) {
    const volts = x[e.a] - x[e.b];
    const amps = deliveredAmps(at(e, step), volts);
    return { amps, volts, watts: amps * volts };
  },
};
