/** Shared HC-SR04 timing, in microseconds and centimetres, so the interpreter and the AVR engine answer a TRIG pulse alike. */
export const RANGER_DEFAULT_CM = 25;

const MIN_TRIG_US = 10;
/** The module sends 8 cycles at 40 kHz before ECHO rises. */
const BURST_US = 200;
const MIN_CM = 2;
const MAX_CM = 400;
const SOUND_CM_PER_US = 0.0343;
/** With nothing in range ECHO stays high this long. */
const TIMEOUT_US = 38_000;

export interface RangerEcho {
  /** From the end of the TRIG pulse to the rising edge of ECHO. */
  delayUs: number;
  /** How long ECHO stays high. */
  widthUs: number;
}

/** The ECHO pulse a TRIG pulse of `trigUs` earns, or null when it was too short to start a ping. */
export function rangerEcho(trigUs: number, distanceCm: number): RangerEcho | null {
  if (trigUs < MIN_TRIG_US) return null;
  const inRange = distanceCm >= MIN_CM && distanceCm <= MAX_CM;
  return { delayUs: BURST_US, widthUs: inRange ? (distanceCm * 2) / SOUND_CM_PER_US : TIMEOUT_US };
}
