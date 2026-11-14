import type { ElementPwm, TransientStep } from '../types.ts';
import type { NewtonDevice } from './index.ts';
import { deliveredAmps, stampSource } from './source.ts';

// edges closer than this many turns of the period are one edge, so a step that ends on an edge does not leave a sliver behind it
const TURN_EPS = 1e-9;

/**
 * What the pin drives its output to. An `edge` pin is a square wave on the clock of the run: in a transient step it holds the
 * level of the middle of the step, and the solver never lets a step straddle an edge. In every other solve, and for
 * an `averaged` pin, it is the time average, duty times the high level.
 */
export function pwmVolts(e: ElementPwm, step?: TransientStep): number {
  if (e.mode !== 'edge' || !step) return e.duty * e.vHighVolts;
  const turns = e.hz * (step.tSeconds - step.hSeconds / 2);
  return turns - Math.floor(turns) < e.duty ? e.vHighVolts : 0;
}

/** The first time after `seconds` at which an edge-mode pin changes level; Infinity when it never does. */
export function nextPwmEdge(e: ElementPwm, seconds: number): number {
  if (e.mode !== 'edge' || !(e.hz > 0) || !(e.duty > 0 && e.duty < 1)) return Infinity;
  const turns = e.hz * seconds;
  const whole = Math.floor(turns + TURN_EPS);
  return (whole + e.duty > turns + TURN_EPS ? whole + e.duty : whole + 1) / e.hz;
}

const source = (e: ElementPwm, ground: number, step?: TransientStep) => ({ id: e.id, a: e.a, b: ground, volts: pwmVolts(e, step), rSeriesOhms: e.rOutOhms });

export const pwmDevice: NewtonDevice<ElementPwm> = {
  kind: 'PWM',
  validate(e) {
    if (!(e.duty >= 0 && e.duty <= 1)) return `duty ${e.duty} is outside 0..1`;
    if (!(e.hz > 0 && Number.isFinite(e.hz))) return `hz ${e.hz} is not positive`;
    if (!(e.rOutOhms >= 0)) return `rOutOhms ${e.rOutOhms} is negative`;
    return null;
  },
  stamp: (e, x, s, lim, step) => stampSource(source(e, s.ground, step), x, s, lim),
  currents: (e, x, step) => [deliveredAmps(source(e, 0, step), x[e.a])],
  measure(e, x, step) {
    const amps = deliveredAmps(source(e, 0, step), x[e.a]);
    return { amps, volts: x[e.a], watts: amps * x[e.a] };
  },
};
