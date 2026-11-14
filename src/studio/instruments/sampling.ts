import { waveStepNs } from "../../sim/analog/step.ts";

const NS_PER_S = 1e9;
/** A wave drawn from fewer points than this a period is drawn from few points: its shape and any frequency read from it are not to be trusted. */
export const COARSE_POINTS = 10;
const SPACING_SAMPLES = 64;

/** The sample rate of a run with a generator at `hz`: the step the project runs on, cut to a hundred points a period as the solver does. */
export const generatorRateHz = (hz: number, projectStepNs: number): number => NS_PER_S / Math.min(projectStepNs, waveStepNs(hz));

/** The highest frequency drawn from enough points at `rateHz`. */
export const coarseAboveHz = (rateHz: number): number => rateHz / COARSE_POINTS;

export const isCoarse = (hz: number, rateHz: number): boolean => hz > coarseAboveHz(rateHz);

export const pointsPerPeriod = (hz: number, rateHz: number): number => rateHz / hz;

/** The rate samples taken at the times `tNs` (nanoseconds) come at: the median spacing of the newest ones, or null with fewer than two. */
export function sampleRateHz(tNs: ArrayLike<number>): number | null {
  const from = Math.max(1, tNs.length - SPACING_SAMPLES);
  const gaps: number[] = [];
  for (let i = from; i < tNs.length; i++) {
    const gap = tNs[i] - tNs[i - 1];
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return NS_PER_S / gaps[Math.floor(gaps.length / 2)];
}
