/**
 * The scope's numbers, pure: the trace buffer (what the worker's waveform frames add up to), the time and volt
 * divisions, and the projection of a time window onto pixel columns. Tested in node; `screen.ts` only paints it.
 *
 * The worker sends each probe's waveform as samples on a grid (`fromNs`, `stepNs`, `v[]`) since the previous frame,
 * or from its oldest sample on a `full` frame. A sample holds until the next one, so the trace is a staircase of held
 * values and a column of the screen shows the lowest and highest value held within it.
 */
import type { Lang } from '../../../contracts/common';
import { decimalMark } from '../meter/logic';

export const DIVS_X = 10;
export const DIVS_Y = 8;
/** The zero line sits this many divisions above the bottom of the screen, so a 0 to 5 V signal shows whole at 1 V per division. */
export const ZERO_DIV = 1;

/** Time per division, milliseconds. */
export const TIME_STEPS: readonly number[] = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
/** Volts per division. */
export const VOLT_STEPS: readonly number[] = [0.1, 0.2, 0.5, 1, 2, 5];
export const DEFAULT_TIME_STEP = 6; // 100 ms: a 1 s Blink period fills the screen
export const DEFAULT_VOLT_STEP = 3; // 1 V

/** Moves an index into a list of steps by `delta`, stopping at the ends. */
export const stepBy = (steps: readonly number[], index: number, delta: number): number => Math.max(0, Math.min(steps.length - 1, index + delta));

/** `100 ms`, `1 s`, `500 µs`. */
export function timeText(ms: number, lang: Lang): string {
  const mark = decimalMark(lang);
  if (ms >= 1000) return `${String(ms / 1000).replace('.', mark)} s`;
  if (ms < 1) return `${String(Math.round(ms * 1000))} µs`;
  return `${String(ms).replace('.', mark)} ms`;
}

/** `1 V`, `500 mV`. */
export function voltsText(v: number, lang: Lang): string {
  const mark = decimalMark(lang);
  return v < 1 ? `${String(Math.round(v * 1000))} mV` : `${String(v).replace('.', mark)} V`;
}

/** The row (0 at the top of the plot) of a voltage, as a fraction of the plot height. */
export const rowOf = (volts: number, voltsPerDiv: number): number => 1 - (volts / voltsPerDiv + ZERO_DIV) / DIVS_Y;

/** The trace of one probe: its samples in time order in a ring, the newest dropping the oldest. */
export interface TraceBuffer {
  readonly length: number;
  /** Time of the newest sample, ns, or 0 when empty. */
  readonly lastNs: number;
  /** A frame's waveform. `full` replaces what is kept; a grid that starts before the newest sample is a new run and does too. */
  push(fromNs: number, stepNs: number, v: ArrayLike<number>, full: boolean): void;
  clear(): void;
  /** Sample `i` (0 the oldest). */
  timeAt(i: number): number;
  valueAt(i: number): number;
  /** Index of the first sample at or after `ns`, `length` when none. */
  firstAtOrAfter(ns: number): number;
}

export function createTraceBuffer(capacity = 16384): TraceBuffer {
  const t = new Float64Array(capacity);
  const v = new Float64Array(capacity);
  let head = 0;
  let count = 0;
  const at = (i: number) => (head + i) % capacity;
  const api: TraceBuffer = {
    get length() {
      return count;
    },
    get lastNs() {
      return count === 0 ? 0 : t[at(count - 1)]!;
    },
    push(fromNs, stepNs, values, full) {
      if (full || (count > 0 && fromNs < api.lastNs)) api.clear();
      for (let k = 0; k < values.length; k++) {
        const slot = count < capacity ? at(count) : head;
        t[slot] = fromNs + k * stepNs;
        v[slot] = values[k]!;
        if (count < capacity) count++;
        else head = (head + 1) % capacity;
      }
    },
    clear() {
      head = 0;
      count = 0;
    },
    timeAt: (i) => t[at(i)]!,
    valueAt: (i) => v[at(i)]!,
    firstAtOrAfter(ns) {
      let lo = 0;
      let hi = count;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (t[at(mid)]! < ns) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
  };
  return api;
}

/** What one pixel column of the plot holds: the value at its start, its lowest and highest, and the value at its end. */
export interface Columns {
  readonly first: Float32Array;
  readonly last: Float32Array;
  readonly lo: Float32Array;
  readonly hi: Float32Array;
  /** 1 where the column has a value (the trace has begun by then). */
  readonly has: Uint8Array;
}

export const columnsOf = (n: number): Columns => ({
  first: new Float32Array(n),
  last: new Float32Array(n),
  lo: new Float32Array(n),
  hi: new Float32Array(n),
  has: new Uint8Array(n),
});

/**
 * Fills `out` for the window `[endNs - spanNs, endNs]` over `out.has.length` columns. A sample holds until the next, so
 * a column before the first sample is empty and a column with no new sample holds the one before it. No allocation.
 */
export function project(trace: TraceBuffer, endNs: number, spanNs: number, out: Columns): void {
  const n = out.has.length;
  const start = endNs - spanNs;
  let i = trace.firstAtOrAfter(start);
  // The value held at the window's start: the sample before it.
  let held = i > 0 ? trace.valueAt(i - 1) : Number.NaN;
  for (let c = 0; c < n; c++) {
    const from = start + (spanNs * c) / n;
    const to = start + (spanNs * (c + 1)) / n;
    let lo = held;
    let hi = held;
    const first = held;
    while (i < trace.length && trace.timeAt(i) < to) {
      // A sample at or after the column's start changes what it holds from that moment.
      const x = trace.valueAt(i);
      if (trace.timeAt(i) >= from) {
        if (Number.isNaN(lo) || x < lo) lo = x;
        if (Number.isNaN(hi) || x > hi) hi = x;
      }
      held = x;
      i++;
    }
    const has = !(Number.isNaN(lo) || Number.isNaN(hi));
    out.has[c] = has ? 1 : 0;
    out.first[c] = has ? (Number.isNaN(first) ? lo : first) : 0;
    out.last[c] = has ? held : 0;
    out.lo[c] = has ? lo : 0;
    out.hi[c] = has ? hi : 0;
  }
}

/** What the scope does with the frames: follows the run's time, or holds one sweep (Single). */
export interface Sweep {
  /** The end of the window, ns: the run's time now, or where it was frozen. */
  endNs(nowNs: number): number;
  readonly frozen: boolean;
  /** Freezes the window where it is now, or lets it follow again. Returns whether it is frozen. */
  toggle(nowNs: number): boolean;
  reset(): void;
}

export function createSweep(): Sweep {
  let held: number | null = null;
  return {
    get frozen() {
      return held !== null;
    },
    endNs: (nowNs) => held ?? nowNs,
    toggle(nowNs) {
      held = held === null ? nowNs : null;
      return held !== null;
    },
    reset() {
      held = null;
    },
  };
}
