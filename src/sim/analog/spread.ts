export interface Summary {
  count: number;
  min: number;
  median: number;
  max: number;
  mean: number;
}

export interface Bin {
  lo: number;
  hi: number;
  /** The builds whose value falls in the bin, by index, lowest value first. */
  builds: number[];
}

export interface Range {
  min?: number;
  max?: number;
}

/** The finite values with their build index, lowest first. A build with no reading is left out. */
const ranked = (values: readonly (number | null)[]): { index: number; value: number }[] =>
  values
    .flatMap((value, index) => (value !== null && Number.isFinite(value) ? [{ index, value }] : []))
    .sort((a, b) => a.value - b.value || a.index - b.index);

export function summarize(values: readonly (number | null)[]): Summary | null {
  const sorted = ranked(values).map((r) => r.value);
  if (sorted.length === 0) return null;
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { count: sorted.length, min: sorted[0], median, max: sorted[sorted.length - 1], mean: sorted.reduce((a, b) => a + b, 0) / sorted.length };
}

/** Equal width bins from the lowest value to the highest; the highest value sits in the last bin. */
export function histogram(values: readonly (number | null)[], binCount: number): Bin[] {
  const items = ranked(values);
  if (items.length === 0) return [];
  const lo = items[0].value;
  const hi = items[items.length - 1].value;
  if (lo === hi) return [{ lo, hi, builds: items.map((i) => i.index) }];
  const width = (hi - lo) / binCount;
  const bins: Bin[] = Array.from({ length: binCount }, (_, i) => ({ lo: lo + i * width, hi: lo + (i + 1) * width, builds: [] }));
  for (const { index, value } of items) bins[Math.min(binCount - 1, Math.floor((value - lo) / width))].builds.push(index);
  return bins;
}

/** How many builds read inside the range. A build with no reading fails it. */
export function passCount(values: readonly (number | null)[], range: Range): number {
  return values.filter((v) => v !== null && Number.isFinite(v) && (range.min === undefined || v >= range.min) && (range.max === undefined || v <= range.max)).length;
}

const SWING_FLOOR_VOLTS = 0.2;

/**
 * The frequency of a trace that swings between two levels, from the spacing of its edges through the middle level: the
 * polarity with more edges is used, so the settling before the first one does not count. Null for a trace that does not
 * swing, or has fewer than two edges of a kind.
 */
export function frequencyHz(at: ArrayLike<number>, volts: ArrayLike<number>): number | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < volts.length; i++) {
    lo = Math.min(lo, volts[i]);
    hi = Math.max(hi, volts[i]);
  }
  if (!(hi - lo >= SWING_FLOOR_VOLTS)) return null;
  const mid = (lo + hi) / 2;
  const band = (hi - lo) / 10;
  const rising: number[] = [];
  const falling: number[] = [];
  let high = volts[0] > mid;
  for (let i = 1; i < volts.length; i++) {
    const crossed = high ? volts[i] < mid - band : volts[i] > mid + band;
    if (!crossed) continue;
    high = !high;
    // Back to the last sample on the old side of the middle level, then to where the line to the next one passes it.
    let j = i - 1;
    while (j > 0 && (high ? volts[j] > mid : volts[j] < mid)) j--;
    const t = at[j] + ((mid - volts[j]) / (volts[j + 1] - volts[j])) * (at[j + 1] - at[j]);
    (high ? rising : falling).push(Number.isFinite(t) ? t : at[i]);
  }
  const edges = rising.length >= falling.length ? rising : falling;
  if (edges.length < 2) return null;
  return (edges.length - 1) / (edges[edges.length - 1] - edges[0]);
}
