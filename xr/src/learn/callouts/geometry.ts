/**
 * Pure geometry of the step highlights, unit tested: the wire step's arc between two anchors (a quadratic curve that
 * rises with the span) cut into dashes, and the pulse of design 7.1 (1.2 s, three times, then steady).
 */

export type P3 = readonly [number, number, number];

/** The arc's control point: midway, raised by 30 % of the span plus 2 cm. */
export function arcControl(a: P3, b: P3): P3 {
  const span = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + span * 0.3 + 0.02, (a[2] + b[2]) / 2];
}

export function bezier(a: P3, c: P3, b: P3, t: number): [number, number, number] {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], u * u * a[2] + 2 * u * t * c[2] + t * t * b[2]];
}

/** Arc length of the curve, from `n` chords. */
export function arcLength(a: P3, c: P3, b: P3, n = 32): number {
  let len = 0;
  let prev = a as readonly number[];
  for (let i = 1; i <= n; i++) {
    const p = bezier(a, c, b, i / n);
    len += Math.hypot(p[0] - prev[0]!, p[1] - prev[1]!, p[2] - prev[2]!);
    prev = p;
  }
  return len;
}

/** Dashes as [t0, t1] curve parameters (spaced by length, approximately): `dash` long with `gap` between, metres. */
export function dashes(a: P3, c: P3, b: P3, dash: number, gap: number): Array<[number, number]> {
  const len = arcLength(a, c, b);
  if (len <= 0) return [];
  const out: Array<[number, number]> = [];
  const period = dash + gap;
  const count = Math.max(1, Math.floor((len + gap) / period));
  // Centre the pattern so both ends start with a dash.
  const used = count * period - gap;
  const start = (len - used) / 2;
  for (let i = 0; i < count; i++) {
    const s0 = start + i * period;
    out.push([Math.max(0, s0 / len), Math.min(1, (s0 + dash) / len)]);
  }
  return out;
}

export const PULSE_PERIOD_S = 1.2;
export const PULSE_COUNT = 3;

/**
 * Emphasis 0..1 of a highlight `t` seconds after it was (re)shown: three 1.2 s pulses that start and end at full, then
 * steady at full. Under reduced motion it is steady from the start.
 */
export function pulse(t: number, reducedMotion: boolean): number {
  if (reducedMotion || t < 0 || t >= PULSE_PERIOD_S * PULSE_COUNT) return 1;
  return 0.5 + 0.5 * Math.cos((2 * Math.PI * t) / PULSE_PERIOD_S);
}
