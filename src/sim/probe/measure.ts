export interface Trace {
  t: ArrayLike<number>;
  v: ArrayLike<number>;
  /** The value holds until the next sample; otherwise the line runs straight between samples. */
  zoh: boolean;
}

export interface Measurements {
  vminVolts: number;
  vmaxVolts: number;
  vppVolts: number;
  vmeanVolts: number;
  vrmsVolts: number;
  /** Null until the trace crosses its middle level upward twice. */
  freqHz: number | null;
  periodNs: number | null;
  /** The share of the period spent above the middle level, 0 to 100. */
  dutyPercent: number | null;
}

const NS_PER_S = 1e9;

/** The times the trace crosses `level`, as `[time, rising]`. A held trace crosses at the sample that jumps; a straight one at the interpolated time. */
function crossings(c: Trace, level: number): [number, boolean][] {
  const out: [number, boolean][] = [];
  for (let i = 1; i < c.t.length; i++) {
    const before = c.v[i - 1];
    const after = c.v[i];
    if (before < level === after < level) continue;
    const rising = after >= level;
    const at = c.zoh ? c.t[i] : c.t[i - 1] + ((level - before) / (after - before)) * (c.t[i] - c.t[i - 1]);
    out.push([at, rising]);
  }
  return out;
}

/** Integral of v (or v squared) over `[from, to]` for the held or straight-line trace. */
function integral(c: Trace, from: number, to: number, power: 1 | 2): number {
  let sum = 0;
  for (let i = 0; i < c.t.length; i++) {
    const a = Math.max(from, c.t[i]);
    const b = Math.min(to, i + 1 < c.t.length ? c.t[i + 1] : to);
    if (b <= a) continue;
    const slope = c.zoh || i + 1 >= c.t.length ? 0 : (c.v[i + 1] - c.v[i]) / (c.t[i + 1] - c.t[i]);
    const va = c.v[i] + slope * (a - c.t[i]);
    const vb = c.v[i] + slope * (b - c.t[i]);
    sum += (power === 1 ? (va + vb) / 2 : (va * va + va * vb + vb * vb) / 3) * (b - a);
  }
  return sum;
}

/**
 * Numbers a scope shows under the picture. Mean and RMS run over whole periods when the trace has two rising crossings,
 * so a partial cycle at the edge does not bias them; otherwise over the whole window. Null for fewer than two samples.
 */
export function measure(c: Trace): Measurements | null {
  if (c.t.length < 2) return null;
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < c.v.length; i++) {
    low = Math.min(low, c.v[i]);
    high = Math.max(high, c.v[i]);
  }
  const middle = (low + high) / 2;
  const edges = high > low ? crossings(c, middle) : [];
  const rises = edges.filter(([, rising]) => rising).map(([t]) => t);
  const found = rises.length >= 2;
  const from = found ? rises[0] : c.t[0];
  const to = found ? rises[rises.length - 1] : c.t[c.t.length - 1];
  const span = to - from;

  let periodNs: number | null = null;
  let dutyPercent: number | null = null;
  if (found) {
    periodNs = span / (rises.length - 1);
    let high = 0;
    let counted = 0;
    for (const rise of rises.slice(0, -1)) {
      const fall = edges.find(([t, rising]) => !rising && t > rise);
      if (!fall) continue;
      const next = rises[rises.indexOf(rise) + 1];
      high += (fall[0] - rise) / (next - rise);
      counted++;
    }
    dutyPercent = counted > 0 ? (high / counted) * 100 : null;
  }
  return {
    vminVolts: low,
    vmaxVolts: high,
    vppVolts: high - low,
    vmeanVolts: span > 0 ? integral(c, from, to, 1) / span : c.v[0],
    vrmsVolts: span > 0 ? Math.sqrt(integral(c, from, to, 2) / span) : Math.abs(c.v[0]),
    freqHz: periodNs === null ? null : NS_PER_S / periodNs,
    periodNs,
    dutyPercent,
  };
}

/** The trace's value at `tNs`: the held sample, or the point on the line between the samples around it. Null outside the trace's samples. */
export function valueAt(c: Trace, tNs: number): number | null {
  const n = c.t.length;
  if (n === 0 || tNs < c.t[0]) return null;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c.t[mid] <= tNs) lo = mid + 1;
    else hi = mid;
  }
  const i = lo - 1;
  if (c.zoh || i === n - 1) return c.v[i];
  return c.v[i] + ((c.v[i + 1] - c.v[i]) * (tNs - c.t[i])) / (c.t[i + 1] - c.t[i]);
}
