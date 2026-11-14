import { PWL_COMPAT } from '../elements.ts';
import type { ElementTmr } from '../types.ts';
import type { NewtonDevice } from './index.ts';

// the 555's three equal 5k resistors: vcc to the control pin is one, the control pin to ground is two
const DIVIDER_UPPER_OHMS = 5000;
const DIVIDER_LOWER_OHMS = 10000;
// reset holds the output low below this
const RESET_VOLTS = 0.7;
const NOMINAL_VCC = 5;
const MIN_SUPPLY_VOLTS = 1;

const siemens = (e: ElementTmr) => 1 / Math.max(e.rOutOhms, PWL_COMPAT.minOhms);
// A chip with no supply leaves its output and discharge pins released
const powered = (e: ElementTmr, x: Float64Array) => x[e.vcc] - x[e.gnd] >= MIN_SUPPLY_VOLTS;
const latchOf = (e: ElementTmr) => e.latch ?? 0;

// what the chip draws from vcc beyond its divider
function extraSupplyAmps(e: ElementTmr, vsup: number): number {
  return Math.max(0, e.quiescentAmps * Math.min(1, Math.max(0, vsup) / NOMINAL_VCC) - vsup / (DIVIDER_UPPER_OHMS + DIVIDER_LOWER_OHMS));
}

// Trigger below half the control voltage sets the latch and wins over the threshold comparator, which resets it above the control voltage.
// Reset low, or a chip with no supply, forces the output low.
export function nextLatch(e: ElementTmr, x: Float64Array): 0 | 1 {
  const vg = x[e.gnd];
  const vctrl = x[e.ctrl] - vg;
  if (x[e.vcc] - vg < MIN_SUPPLY_VOLTS || x[e.reset] - vg < RESET_VOLTS) return 0;
  if (x[e.trig] - vg < vctrl / 2) return 1;
  if (x[e.thr] - vg > vctrl) return 0;
  return latchOf(e);
}

// the amps the output stage delivers to the load, and the amps the chip takes from vcc in total
function currents(e: ElementTmr, x: Float64Array): { out: number; supply: number } {
  const g = siemens(e);
  const high = latchOf(e) === 1;
  const out = powered(e, x) ? ((high ? x[e.vcc] - e.highDropVolts : x[e.gnd]) - x[e.out]) * g : 0;
  const vsup = x[e.vcc] - x[e.gnd];
  return { out, supply: vsup / (DIVIDER_UPPER_OHMS + DIVIDER_LOWER_OHMS) + extraSupplyAmps(e, vsup) + (high ? out : 0) };
}

export const timerDevice: NewtonDevice<ElementTmr> = {
  kind: 'TMR',
  validate(e) {
    if (!(e.rOutOhms >= 0)) return `rOutOhms ${e.rOutOhms} is negative`;
    if (!(e.highDropVolts >= 0)) return `highDropVolts ${e.highDropVolts} is negative`;
    if (!(e.disOnOhms > 0)) return `disOnOhms ${e.disOnOhms} is not positive`;
    if (!(e.quiescentAmps >= 0)) return `quiescentAmps ${e.quiescentAmps} is negative`;
    return null;
  },
  stamp(e, x, s) {
    s.conduct(e.vcc, e.ctrl, 1 / DIVIDER_UPPER_OHMS);
    s.conduct(e.ctrl, e.gnd, 1 / DIVIDER_LOWER_OHMS);
    s.current(e.vcc, e.gnd, extraSupplyAmps(e, x[e.vcc] - x[e.gnd]));
    if (!powered(e, x)) return;
    const g = siemens(e);
    if (latchOf(e) === 1) {
      s.conduct(e.vcc, e.out, g);
      s.current(e.out, e.vcc, g * e.highDropVolts);
    } else {
      s.conduct(e.out, e.gnd, g);
      s.conduct(e.dis, e.gnd, 1 / Math.max(e.disOnOhms, PWL_COMPAT.minOhms));
    }
  },
  memory: (e, x) => ({ kind: 'TMR', q: nextLatch(e, x) }),
  currents: (e, x) => {
    const { out, supply } = currents(e, x);
    return [out, supply];
  },
  measure(e, x) {
    const { out, supply } = currents(e, x);
    const vsup = x[e.vcc] - x[e.gnd];
    return { amps: out, volts: x[e.out] - x[e.gnd], watts: vsup * supply - x[e.out] * out, state: latchOf(e) === 1 ? 'on' : 'off' };
  },
};
