import type { ElementId } from "../types.ts";
import { type Control, across } from "./control.ts";

/** Below this the Hall sensors are off and both channels read low. */
const ENCODER_MIN_V = 3;
/** Two edges a channel per pulse: the step must be shorter than the time between edges at full speed. */
const ENCODER_STEP_NS = 100_000;

export interface EncoderWiring {
  motor: ElementId;
  vcc: number;
  gnd: number;
  /** The push-pull outputs, sources from ground to the pin. */
  a: ElementId;
  b: ElementId;
  /** Pulses a channel gives per turn of the shaft the motor's rpm is of (the output shaft). */
  pulsesPerRev: number;
}

/**
 * Two square waves a quarter period apart, from the shaft angle. A leads B when the motor turns forward (rpm above 0)
 * and B leads A when it turns back, so a sketch can count edges and tell the direction.
 */
export function encoderControl(w: EncoderWiring): Control {
  let cycles = 0;
  return {
    maxStepNs: ENCODER_STEP_NS,
    step(io, dtS) {
      cycles += ((io.rpm(w.motor) ?? 0) / 60) * w.pulsesPerRev * dtS;
      const supply = across(io, w.vcc, w.gnd);
      const high = supply >= ENCODER_MIN_V ? supply : 0;
      const phase = cycles - Math.floor(cycles);
      const quarter = phase - 0.25 - Math.floor(phase - 0.25);
      io.set(w.a, { volts: phase < 0.5 ? high : 0 });
      io.set(w.b, { volts: quarter < 0.5 ? high : 0 });
    },
  };
}
