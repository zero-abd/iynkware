/** Smallest current that is drawn as flow; below it a wire counts as carrying none. */
export const MIN_FLOW_AMPS = 1e-7;

const NICE = [1, 2, 5] as const;

/** The size of a voltage scale for the largest voltage seen: 1, 2 or 5 times a power of ten at or above it, never under a tenth of a volt. */
export function niceMax(peakVolts: number): number {
  const peak = Math.max(peakVolts, 0.1);
  const power = 10 ** Math.floor(Math.log10(peak));
  return (NICE.find((n) => n * power >= peak) ?? 10) * power;
}

export interface VoltRange {
  /** The scale is symmetric: zero is grey, `+max` the warm end and `-max` the cool end. */
  max: number;
  /** The span the circuit really uses, always including zero. */
  low: number;
  high: number;
}

export function rangeOf(volts: Readonly<Record<string, number>>): VoltRange {
  let low = 0;
  let high = 0;
  for (const v of Object.values(volts)) {
    if (!Number.isFinite(v)) continue;
    low = Math.min(low, v);
    high = Math.max(high, v);
  }
  return { max: niceMax(Math.max(high, -low)), low, high };
}

export const RAMP_STEPS = 8;

/** The step of the colour ramp for a voltage, from `-RAMP_STEPS` to `RAMP_STEPS`. */
export function rampStep(volts: number, max: number): number {
  return Math.round(Math.max(-1, Math.min(1, volts / max)) * RAMP_STEPS);
}

export interface RampTokens {
  /** CSS colours, or `var()` of tokens when the ramp is used in CSS. */
  warm: string;
  cool: string;
  zero: string;
}

/** A colour at `step` of the ramp: the zero grey mixed towards the warm or cool end. */
export function rampColour(step: number, tokens: RampTokens): string {
  if (step === 0) return tokens.zero;
  const end = step > 0 ? tokens.warm : tokens.cool;
  return `color-mix(in srgb, ${end} ${Math.round((Math.abs(step) / RAMP_STEPS) * 100)}%, ${tokens.zero})`;
}

const SPEED_FLOOR_PX = 8;
const SPEED_SPAN_PX = 22;
const SPEED_CAP_PX = 140;
const SPEED_UNIT_AMPS = 1e-4;

/** How fast the dots of a current travel on screen, in px per second: it grows with the logarithm of the current, so microamps and amps both read. */
export function speedPx(amps: number): number {
  const a = Math.abs(amps);
  if (a < MIN_FLOW_AMPS) return 0;
  return Math.min(SPEED_CAP_PX, SPEED_FLOOR_PX + SPEED_SPAN_PX * Math.log10(1 + a / SPEED_UNIT_AMPS));
}
