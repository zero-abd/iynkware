/** Pure maths for the flow: dot spacing, speed, the dot cap. */
import { MIN_FLOW_AMPS, RAMP_STEPS } from '@/studio/overlays/flow/scale';

export { MIN_FLOW_AMPS, RAMP_STEPS };

export const MAX_DOTS = 1500;
/** Dot spacing in the board frame on the bench, metres (the stage scales it in the world). */
export const BENCH_SPACING = 0.004;
/** Dot spacing in the world at Room size, metres. */
export const ROOM_SPACING = 0.04;
/** Static arrowheads under reduced motion, metres in the world. */
export const ARROW_SPACING = 0.15;
export const SPEED_CAP = 0.6;

/** World speed of a current's dots, m/s per simulated second: 0.05 + 0.25 x log10(1 + I / 1 mA), capped. */
export function worldSpeed(amps: number): number {
  const a = Math.abs(amps);
  if (a < MIN_FLOW_AMPS) return 0;
  return Math.min(SPEED_CAP, 0.05 + 0.25 * Math.log10(1 + a / 1e-3));
}

/** Board-frame speed: the world speed scaled down by the stage's scale. */
export function boardSpeed(amps: number, stageScale: number): number {
  return worldSpeed(amps) / Math.max(1e-6, stageScale);
}

/** Dot spacing in the board frame, metres. */
export function spacingOf(kind: 'bench' | 'room', stageScale: number, reduced: boolean): number {
  const s = Math.max(1e-6, stageScale);
  if (reduced) return ARROW_SPACING / s;
  return kind === 'room' ? ROOM_SPACING / s : BENCH_SPACING;
}

/** The spacing to use so `totalLength` of flow holds at most `cap` dots. */
export function cappedSpacing(spacing: number, totalLength: number, cap = MAX_DOTS): number {
  return Math.max(spacing, totalLength / (cap * 0.9));
}

/** Dots on a path of `length` at `spacing`. */
export const dotsOn = (length: number, spacing: number): number => (length <= 0 ? 0 : Math.floor(length / spacing) + 1);

/** The distance of the first dot along a path, from its travelled distance, in [0, spacing). */
export function firstDot(travelled: number, spacing: number): number {
  const r = travelled % spacing;
  return r < 0 ? r + spacing : r;
}
