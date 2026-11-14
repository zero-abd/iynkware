import type { Limiter, Stamper } from '../newton.ts';
import type { Measured } from '../elements.ts';
import type { DeviceState, Element, ElementMemory, TransientStep } from '../types.ts';
import { bjtDevice } from './bjt.ts';
import { buzzerDevice } from './buzzer.ts';
import { capacitorDevice } from './capacitor.ts';
import { diodeDevice } from './diode.ts';
import { inductorDevice } from './inductor.ts';
import { mosDevice } from './mosfet.ts';
import { opampDevice } from './opamp.ts';
import { pwmDevice } from './pwm.ts';
import { voltageSourceDevice } from './source.ts';
import { timerDevice } from './timer555.ts';
import { tmp36Device } from './tmp36.ts';
import { waveSourceDevice } from './wavesource.ts';

export interface NewtonDevice<E extends Element> {
  readonly kind: E['kind'];
  // why the element's parameters are unusable, or null
  validate(e: E): string | null;
  // x holds a voltage per node number, the ground entry being 0; `step` is set in a transient solve and absent in an operating point
  stamp(e: E, x: Float64Array, s: Stamper, lim: Limiter, step?: TransientStep): void;
  // what a dynamic element carries into the next step, read at the solution x; the other devices have none. An operating point reads it with no step.
  memory?(e: E, x: Float64Array, step?: TransientStep): ElementMemory;
  currents(e: E, x: Float64Array, step?: TransientStep): number[];
  // the element's branch reading at x, with its operating region where it has one
  measure(e: E, x: Float64Array, step?: TransientStep): Measured & { state?: DeviceState };
}

export const NEWTON_DEVICES = new Map<string, NewtonDevice<Element>>([
  [diodeDevice.kind, diodeDevice],
  [bjtDevice.kind, bjtDevice],
  [mosDevice.kind, mosDevice],
  [capacitorDevice.kind, capacitorDevice],
  [inductorDevice.kind, inductorDevice],
  [voltageSourceDevice.kind, voltageSourceDevice],
  [waveSourceDevice.kind, waveSourceDevice],
  [opampDevice.kind, opampDevice],
  [timerDevice.kind, timerDevice],
  [pwmDevice.kind, pwmDevice],
  [buzzerDevice.kind, buzzerDevice],
  [tmp36Device.kind, tmp36Device],
]);
