/**
 * The multimeter's decisions, pure: what a mode asks of the worker, which nets and part the two clipped probes mean,
 * how a reading is written (four digits, an SI prefix, the language's decimal mark) and how often the worker is asked.
 * Tested in node. Nothing here touches the scene or the simulation.
 */
import type { Lang } from '../../../contracts/common';
import type { MeterProbes, Reading } from '../../../contracts/sim';
import type { ClipTarget, NetIndex } from '../probes/nets';

export type MeterMode = 'dc-volts' | 'dc-amps' | 'resistance' | 'continuity';
export const MODES: readonly MeterMode[] = ['dc-volts', 'dc-amps', 'resistance', 'continuity'];

/** The settings the worker's `meter.read` takes for a mode: an ideal meter (no loading, no burden). */
export function settingsFor(mode: MeterMode): { mode: MeterMode; loading: false; burdenOhms: 0 } {
  return { mode, loading: false, burdenOhms: 0 };
}

/** Why the display shows `--`. Each has a short sentence in `strings.ts`. */
export type Reason = 'free' | 'not-loaded' | 'no-net' | 'no-element' | 'refused' | 'no-value';

export type Plan = { readonly probes: MeterProbes } | { readonly reason: Reason };

/**
 * What to ask the worker for: the nets of the two clipped probes and, for amps, the part between them (an ammeter
 * reads the current through a part, from the red probe's net). `index` is null before the run is loaded.
 */
export function planRead(mode: MeterMode, red: ClipTarget | null, black: ClipTarget | null, index: NetIndex | null): Plan {
  if (red === null || black === null) return { reason: 'free' };
  if (index === null) return { reason: 'not-loaded' };
  const a = index.netOf(red);
  const b = index.netOf(black);
  if (a === null || b === null) return { reason: 'no-net' };
  if (mode !== 'dc-amps') return { probes: { red: a, black: b, element: null } };
  const element = index.elementBetween(a, b);
  return element === null ? { reason: 'no-element' } : { probes: { red: a, black: b, element } };
}

/** The same two probes meaning the same thing: used to know whether a new read is worth asking for early. */
export const samePlan = (a: Plan, b: Plan): boolean => {
  if ('reason' in a || 'reason' in b) return 'reason' in a && 'reason' in b && a.reason === b.reason;
  return a.probes.red === b.probes.red && a.probes.black === b.probes.black && a.probes.element === b.probes.element;
};

/* ---------- the rate the worker is asked at ---------- */

/** How often the worker is asked while the run is live (the design's 4 Hz; never above 10 Hz). */
export const READ_EVERY_MS = 250;
export const MAX_READ_HZ = 10;

export interface Gate {
  /** True when a read may start now. */
  due(nowMs: number): boolean;
  /** A read started now. */
  mark(nowMs: number): void;
  /** Asks for the next read as soon as the rate allows (a probe moved, the mode changed). */
  soon(): void;
}

/** At most one read per `everyMs` (never faster than `MAX_READ_HZ`). */
export function createGate(everyMs: number = READ_EVERY_MS): Gate {
  const every = Math.max(everyMs, 1000 / MAX_READ_HZ);
  let last = -Infinity;
  let early = false;
  return {
    due: (nowMs) => nowMs - last >= (early ? 1000 / MAX_READ_HZ : every),
    mark(nowMs) {
      last = nowMs;
      early = false;
    },
    soon() {
      early = true;
    },
  };
}

/* ---------- writing a reading ---------- */

export interface Shown {
  /** The digits, or `--`, `OL`, or a word for continuity. */
  readonly text: string;
  /** The unit with its prefix, `''` when there is none. */
  readonly unit: string;
  /** Why it is `--`, if it is. */
  readonly reason: Reason | null;
  /** Continuity: whether the circuit is closed (beeps), else null. */
  readonly closed: boolean | null;
}

const PREFIX: Readonly<Record<string, number>> = { µ: 1e-6, u: 1e-6, m: 1e-3, '': 1, k: 1e3, M: 1e6 };
const STEPS = [
  { at: 1e6, prefix: 'M' },
  { at: 1e3, prefix: 'k' },
  { at: 1, prefix: '' },
  { at: 1e-3, prefix: 'm' },
  { at: 1e-6, prefix: 'µ' },
] as const;

const COMMA: ReadonlySet<Lang> = new Set(['de', 'es', 'fr']);

/** The decimal mark of a language. */
export const decimalMark = (lang: Lang): string => (COMMA.has(lang) ? ',' : '.');

/** The value in the base unit, from a reading's value and its unit (`kΩ`, `mA`, `V`). */
export function baseValue(value: number, unit: string | undefined, base: string): number {
  if (!unit || unit === base) return value;
  const prefix = unit.endsWith(base) ? unit.slice(0, unit.length - base.length) : '';
  return value * (PREFIX[prefix] ?? 1);
}

/** Four significant digits of `value` in an SI prefix: `2.034 V`, `14.60 mA`, `4.700 kΩ`. */
export function formatNumber(value: number, base: string, lang: Lang): { text: string; unit: string } {
  const abs = Math.abs(value);
  const mark = decimalMark(lang);
  if (!Number.isFinite(abs)) return { text: '--', unit: base };
  if (abs < 1e-9) return { text: `0${mark}000`, unit: base };
  let step = STEPS.find((s) => abs >= s.at * 0.99995) ?? STEPS[STEPS.length - 1]!;
  const digits = (scaled: number): string => {
    const whole = Math.floor(Math.log10(Math.abs(scaled)) + 1e-12) + 1;
    return Math.abs(scaled).toFixed(Math.max(0, 4 - Math.max(1, whole)));
  };
  let text = digits(abs / step.at);
  // 999.96 mV rounds to 1000: it is 1.000 V.
  if (Number.parseFloat(text) >= 1000) {
    const up = STEPS[STEPS.indexOf(step) - 1];
    if (up) {
      step = up;
      text = digits(abs / step.at);
    }
  }
  const sign = value < 0 && Number.parseFloat(text) !== 0 ? '-' : '';
  return { text: sign + text.replace('.', mark), unit: step.prefix + base };
}

const BASE: Readonly<Record<MeterMode, string>> = { 'dc-volts': 'V', 'dc-amps': 'A', resistance: 'Ω', continuity: 'Ω' };

/** What the display shows for a reading (null: none yet) in a mode, or for a plan that has no probes to read. */
export function shownOf(mode: MeterMode, reading: Reading | null, lang: Lang, reason: Reason | null = null): Shown {
  const base = BASE[mode];
  if (reason !== null || reading === null) return { text: '--', unit: mode === 'continuity' ? '' : base, reason: reason ?? 'not-loaded', closed: null };
  const v = reading.value;
  if (v === null) return { text: '--', unit: mode === 'continuity' ? '' : base, reason: 'no-value', closed: null };
  if (typeof v === 'boolean') return { text: v ? 'ON' : 'OFF', unit: '', reason: null, closed: v };
  if (v === 'open') return { text: 'OL', unit: base, reason: null, closed: null };
  if (typeof v === 'string') return { text: v, unit: reading.unit ?? base, reason: null, closed: null };
  const f = formatNumber(baseValue(v, reading.unit, base), base, lang);
  return { text: f.text, unit: f.unit, reason: null, closed: null };
}

/** A reading as one line (the chip above the red tip): `2.034 V`. */
export const lineOf = (s: Shown): string => (s.unit ? `${s.text} ${s.unit}` : s.text);
