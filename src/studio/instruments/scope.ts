export const H_DIVS = 10;
export const V_DIVS = 8;

const ladder = (from: number, to: number): number[] => {
  const out: number[] = [];
  for (let decade = from; decade <= to; decade++) for (const m of [1, 2, 5]) out.push(Number(`${m}e${decade}`));
  return out;
};

/** Seconds per division, 1 us to 1 s in the 1, 2, 5 steps of a bench scope. */
export const TIME_PER_DIV_S: readonly number[] = [...ladder(-6, -1), 1];

/** What a division is before the user picks one. */
export const DEFAULT_TIME_PER_DIV_S = 1e-3;

/** A probe keeps this many samples of the window on screen, whatever the time base, so a slow time base shows the whole window and a fast one every step. */
const WINDOW_SAMPLES = 1000;

/** The least time between two samples of a probe read through a scope at `timePerDivS`, in nanoseconds. */
export const sampleIntervalNs = (timePerDivS: number): number => Math.max(1, Math.round((timePerDivS * H_DIVS * 1e9) / WINDOW_SAMPLES));

/** Volts per division, 1 mV to 20 V. */
export const VOLTS_PER_DIV: readonly number[] = [...ladder(-3, 0), 10, 20];

/** The smallest step that fits `volts` on `divisions` divisions with a little room. */
const fit = (volts: number, divisions: number): number => VOLTS_PER_DIV.find((v) => v >= (volts * 1.1) / divisions) ?? VOLTS_PER_DIV[VOLTS_PER_DIV.length - 1];

/** The smallest step that fits `spanVolts` on eight divisions with a little room, for a channel on Auto. */
export const autoVoltsPerDiv = (spanVolts: number): number => fit(spanVolts, V_DIVS);

/**
 * The centre and volts per division of a channel whose trace runs from `low` to `high`. On Auto (`div` absent) ground
 * stays in view and on a grid line: a trace above ground has it on the bottom line, one below it on the top line and one
 * that crosses it on the middle line, so a settled level reads as a level against 0 V and the lines are round numbers.
 * A division the user picked keeps the trace on the screen by centring on it, in whole divisions so the line does not
 * creep as the trace moves.
 */
export function channelScale(low: number, high: number, div?: number): { mid: number; div: number } {
  if (div !== undefined) return { mid: Math.round((low + high) / 2 / div) * div, div };
  if (low >= 0) return { mid: (V_DIVS / 2) * fit(high, V_DIVS), div: fit(high, V_DIVS) };
  if (high <= 0) return { mid: -(V_DIVS / 2) * fit(-low, V_DIVS), div: fit(-low, V_DIVS) };
  const step = fit(2 * Math.max(-low, high), V_DIVS);
  return { mid: 0, div: step };
}
