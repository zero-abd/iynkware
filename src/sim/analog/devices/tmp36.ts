import { PWL_COMPAT } from '../elements.ts';
import type { ElementTs } from '../types.ts';
import type { NewtonDevice } from './index.ts';

const outSiemens = 1 / PWL_COMPAT.sensorOutOhms;
const outVolts = (e: ElementTs) => e.outVolts ?? PWL_COMPAT.sensorOutVolts;

// The output holds its voltage while the supply is inside the datasheet's 2.7 V to 5.5 V; the model allows up to its 7 V absolute maximum. The supply is read at the iterate.
function supplied(e: ElementTs, x: Float64Array): boolean {
  const vs = x[e.supplyPos] - x[e.supplyNeg];
  return vs >= PWL_COMPAT.sensorMinVolts && vs <= PWL_COMPAT.sensorMaxVolts;
}

const outAmps = (e: ElementTs, x: Float64Array) => (supplied(e, x) ? (outVolts(e) - (x[e.out] - x[e.supplyNeg])) * outSiemens : 0);

export const tmp36Device: NewtonDevice<ElementTs> = {
  kind: 'TS',
  validate: () => null,
  stamp(e, x, s) {
    s.conduct(e.supplyPos, e.supplyNeg, PWL_COMPAT.sensorQuiescentSiemens);
    if (!supplied(e, x)) return;
    s.conduct(e.out, e.supplyNeg, outSiemens);
    s.current(e.out, e.supplyNeg, -outSiemens * outVolts(e));
  },
  currents: (e, x) => [(x[e.supplyPos] - x[e.supplyNeg]) * PWL_COMPAT.sensorQuiescentSiemens, outAmps(e, x)],
  measure(e, x) {
    const volts = x[e.supplyPos] - x[e.supplyNeg];
    const amps = volts * PWL_COMPAT.sensorQuiescentSiemens;
    return { amps, volts, watts: amps * volts, state: supplied(e, x) ? 'on' : 'off' };
  },
};
