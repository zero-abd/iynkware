/**
 * The inspector card as data: a pure function from a part's descriptor and the live readings to the rows the card
 * prints (docs/XR_DESIGN.md 6.4), plus the value formatting, the card's layout in dmm and the redraw throttle. No
 * three.js here, so every piece is unit tested.
 */
import type { Lang } from '../../contracts/common';
import { pickText } from '../../contracts/common';
import type { PartState } from '../../contracts/sim';
import { num, tr } from '../kit/text';
import { PROBE } from './strings';
import de from '@/i18n/messages/de/partinfo.json';
import en from '@/i18n/messages/en/partinfo.json';
import es from '@/i18n/messages/es/partinfo.json';
import fr from '@/i18n/messages/fr/partinfo.json';
import hi from '@/i18n/messages/hi/partinfo.json';
import zh from '@/i18n/messages/zh/partinfo.json';

/** The 2D app's own rating labels (`ratings.measure.*`, `ratings.role.*`), per language. */
const PARTINFO: Readonly<Record<Lang, { ratings: { measure: Readonly<Record<string, string>>; role: Readonly<Record<string, string>> } }>> = {
  en, de, es, fr, hi, zh,
};

export const DASH = '–';

/* ---------- value formatting ---------- */

const UNIT_LABEL: Readonly<Record<string, string>> = {
  V: 'V', A: 'A', ohm: 'Ω', F: 'F', H: 'H', W: 'W', Hz: 'Hz', s: 's', degC: '°C', C_per_W: '°C/W', mm: 'mm', g: 'g',
  N_m: 'N m', rad_per_s: 'rad/s', deg: '°', deg_per_s: '°/s', g0: 'g', lux: 'lx', ratio: '', percent: '%', '1': '', bit: 'bit',
  byte: 'byte', ppm: 'ppm',
};
const PREFIXED: ReadonlySet<string> = new Set(['V', 'A', 'ohm', 'F', 'H', 'W', 'Hz', 's']);
const PREFIXES: readonly (readonly [number, string])[] = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];

/** Decimals needed to show `x` at three significant figures, 0 to 3. */
function decimalsFor(x: number): number {
  const s = Number(x.toPrecision(3));
  for (let d = 0; d < 3; d++) if (Math.abs(s * 10 ** d - Math.round(s * 10 ** d)) < 1e-9) return d;
  return 3;
}

/** A number in the language's own format at three significant figures ("2,03" in German, "2.03" in English). */
export function plain(lang: Lang, x: number): string {
  const v = Number(x.toPrecision(3));
  return num(lang, v === 0 ? 0 : v, decimalsFor(v));
}

/** `2.03 A`, `14.6 mA`, `220 µA`. */
function scaled(lang: Lang, x: number, unit: string): string {
  const a = Math.abs(x);
  if (!Number.isFinite(x)) return DASH;
  if (a >= 1 || a === 0) return `${num(lang, x, 2)} ${unit}`;
  if (a >= 1e-3) return `${num(lang, x * 1e3, 1)} m${unit}`;
  return `${num(lang, x * 1e6, 0)} µ${unit}`;
}

/** Node volts as the meter shows them: `2.03 V`. */
export const formatVolts = (lang: Lang, v: number | undefined): string => (v === undefined || !Number.isFinite(v) ? DASH : `${num(lang, v, 2)} V`);
/** A pin current: `14.6 mA`, `220 µA`, `0.31 A`. */
export const formatAmps = (lang: Lang, a: number | undefined): string => (a === undefined ? DASH : scaled(lang, a, 'A'));
/** A power: `32.0 mW`. */
export const formatWatts = (lang: Lang, w: number | undefined): string => (w === undefined ? DASH : scaled(lang, w, 'W'));

/** The slot of a rating that carries a number. */
export interface QuantityLike {
  unit: string;
  value?: number;
  min?: number;
  typ?: number;
  max?: number;
}

/** A rated quantity as the 2D part page prints it: `20 mA`, `1.8 – 2.2 V`, `220 Ω`. */
export function formatQuantity(lang: Lang, q: QuantityLike): string {
  const given = [q.min, q.typ, q.max].filter((n): n is number => typeof n === 'number');
  const list = typeof q.value === 'number' ? [q.value] : q.typ !== undefined ? [q.typ] : given;
  if (list.length === 0) return DASH;
  const biggest = Math.max(...list.map((n) => Math.abs(n)));
  const [factor, prefix] = PREFIXED.has(q.unit) && biggest > 0 ? (PREFIXES.find(([f]) => biggest >= f) ?? PREFIXES[PREFIXES.length - 1]!) : ([1, ''] as const);
  const unit = `${prefix}${UNIT_LABEL[q.unit] ?? q.unit}`;
  const body = list.map((n) => plain(lang, n / factor)).join(` ${DASH} `);
  return unit ? `${body} ${unit}` : body;
}

/* ---------- the card model ---------- */

export interface PinRow {
  readonly id: string;
  /** The pin's designator and role, `A  Anode`. */
  readonly role: string;
  readonly volts: string;
  readonly amps: string;
}
export interface RatingRow {
  readonly label: string;
  readonly value: string;
}
export interface LiveRow {
  readonly label: string;
  readonly value: string;
}
export interface CardModel {
  readonly title: string;
  readonly subtitle: string;
  readonly pins: readonly PinRow[];
  /** `+12 more` when pins were left out, else null. */
  readonly pinsMore: string | null;
  readonly ratings: readonly RatingRow[];
  readonly ratingsMore: string | null;
  readonly live: readonly LiveRow[];
  /** The one-line hint under Live while nothing runs. */
  readonly idle: string | null;
}

interface PinLike {
  id: string;
  name?: Record<string, string | undefined>;
  designator?: string;
}
interface RatingLike {
  measure?: string;
  role?: string;
  used_by_model?: string;
  manufacturer?: QuantityLike;
  simulation?: QuantityLike;
  measured?: QuantityLike;
}
/** What the card needs of a part descriptor (iynk's `Descriptor` satisfies it). */
export interface DescriptorLike {
  identity?: { model?: string };
  pins?: readonly PinLike[];
  ratings?: Readonly<Record<string, RatingLike | undefined>> | undefined;
}

export interface CardInput {
  lang: Lang;
  refdes: string;
  /** The person's own label for this placed part, if any. */
  label?: string;
  descriptor: DescriptorLike | undefined;
  /** Pin id to net id from the run's netlist, or undefined before one loads. */
  nets: Readonly<Record<string, string | null>> | undefined;
  /** Volts by net id and amps by pin id, from the analog feed. */
  volts: Readonly<Record<string, number>> | undefined;
  pinAmps: Readonly<Record<string, number>> | undefined;
  /** Watts and health of this part. */
  health: { watts: number; state: 'ok' | 'hot' | 'burnt' | 'reversed' } | undefined;
  state: PartState | undefined;
  /** The run is idle, running or paused. */
  live: boolean;
}

export const MAX_PINS = 8;
export const MAX_RATINGS = 6;

const ROLE_ORDER = ['abs_max', 'abs_min', 'operating', 'recommended', 'threshold', 'characteristic', 'consumption', 'thermal', 'timing'];

/** The number a rating shows: the slot the model reads, else the first one given. */
export function ratingQuantity(r: RatingLike): QuantityLike | undefined {
  const used = r.used_by_model;
  const picked = used === 'manufacturer' || used === 'simulation' || used === 'measured' ? r[used] : undefined;
  return picked ?? r.manufacturer ?? r.simulation ?? r.measured;
}

/** The 2D app's label for a rating's measure and role (`Current, Absolute maximum`), in this language. */
export function ratingLabel(lang: Lang, measure: string | undefined, role: string | undefined): string {
  const t = PARTINFO[lang].ratings;
  const key = measure === 'other' || !measure ? 'misc' : measure;
  const m = t.measure[key] ?? PARTINFO.en.ratings.measure[key] ?? key;
  const r = role ? (t.role[role] ?? PARTINFO.en.ratings.role[role] ?? '') : '';
  return r ? `${m}, ${r}` : m;
}

function pinRows(i: CardInput): { rows: PinRow[]; more: string | null } {
  const all = i.descriptor?.pins ?? [];
  // While a run is loaded, the pins that are wired come first (a board has dozens); else the first few.
  const wired = i.nets ? all.filter((p) => i.nets?.[p.id]) : [];
  const pool = wired.length > 0 ? wired : all;
  const rows = pool.slice(0, MAX_PINS).map((p): PinRow => {
    const name = pickText(p.name as never, i.lang);
    const net = i.nets?.[p.id];
    const v = net ? i.volts?.[net] : undefined;
    const a = i.pinAmps?.[p.id];
    const mark = p.designator ?? p.id;
    return {
      id: p.id,
      role: name && name !== mark ? `${mark}  ${name}` : mark,
      volts: i.live && net ? formatVolts(i.lang, v) : DASH,
      amps: i.live ? formatAmps(i.lang, a) : DASH,
    };
  });
  const left = pool.length - rows.length;
  return { rows, more: left > 0 ? tr(PROBE, i.lang, 'more', { n: left }) : null };
}

function ratingRows(i: CardInput): { rows: RatingRow[]; more: string | null } {
  const entries = Object.entries(i.descriptor?.ratings ?? {})
    .flatMap(([key, r]) => (r ? [{ key, r, q: ratingQuantity(r) }] : []))
    .filter((e): e is { key: string; r: RatingLike; q: QuantityLike } => e.q !== undefined)
    .sort((a, b) => {
      const ra = ROLE_ORDER.indexOf(a.r.role ?? '');
      const rb = ROLE_ORDER.indexOf(b.r.role ?? '');
      return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    });
  // The 2D labels name a measure and a role only, so several ratings can read the same ("Voltage, Characteristic" for
  // each LED colour): the first of each label is shown and the rest are counted.
  const seen = new Set<string>();
  const unique = entries
    .map((e): RatingRow => ({ label: ratingLabel(i.lang, e.r.measure, e.r.role), value: formatQuantity(i.lang, e.q) }))
    .filter((r) => !seen.has(r.label) && !!seen.add(r.label));
  const rows = unique.slice(0, MAX_RATINGS);
  const left = entries.length - rows.length;
  return { rows, more: left > 0 ? tr(PROBE, i.lang, 'more', { n: left }) : null };
}

function stateRow(lang: Lang, s: PartState | undefined): LiveRow | null {
  if (!s) return null;
  switch (s.kind) {
    case 'led':
      return { label: tr(PROBE, lang, s.lit ? 'ledOn' : 'ledOff'), value: s.lit ? `${num(lang, Math.round(s.brightness * 100), 0)} %` : DASH };
    case 'buzzer':
      return { label: tr(PROBE, lang, 'tone'), value: s.on ? `${num(lang, s.hz, 0)} Hz` : tr(PROBE, lang, 'off') };
    case 'button':
      return { label: tr(PROBE, lang, s.pressed ? 'pressed' : 'released'), value: '' };
    case 'servo':
      return { label: tr(PROBE, lang, 'angle'), value: `${num(lang, s.angle, 0)}°` };
    case 'motor':
      return { label: tr(PROBE, lang, 'speed'), value: `${num(lang, s.rpm, 0)} rpm` };
    case 'stepper':
      return { label: tr(PROBE, lang, 'angle'), value: `${num(lang, s.angle, 0)}°` };
    case 'reading':
      return { label: s.label, value: `${plain(lang, s.value)} ${s.unit}`.trim() };
    default:
      return null;
  }
}

/** Everything the card prints, as strings. Pure: the same input gives the same model. */
export function buildCard(i: CardInput): CardModel {
  const pins = pinRows(i);
  const ratings = ratingRows(i);
  const live: LiveRow[] = [];
  const st = stateRow(i.lang, i.state);
  if (st) live.push(st);
  if (i.live && i.health) {
    live.push({ label: tr(PROBE, i.lang, 'power'), value: formatWatts(i.lang, Math.abs(i.health.watts)) });
    live.push({ label: tr(PROBE, i.lang, 'health'), value: tr(PROBE, i.lang, i.health.state) });
  }
  return {
    title: i.label || i.descriptor?.identity?.model || i.refdes,
    subtitle: i.refdes,
    pins: pins.rows,
    pinsMore: pins.more,
    ratings: ratings.rows,
    ratingsMore: ratings.more,
    live,
    idle: i.live ? null : tr(PROBE, i.lang, 'notRunning'),
  };
}

/** Identity of a model: a redraw happens only when this string changes. */
export const modelKey = (lang: Lang, m: CardModel): string => `${lang}|${JSON.stringify(m)}`;

/* ---------- layout in dmm (at the card's design distance) ---------- */

/** Card size and rhythm, dmm: at most 360 wide (9.1), title 30, body 22, rows 20 (9.2). */
export const CARD = { w: 360, pad: 16, head: 48, sub: 30, heading: 26, row: 32, gap: 8, close: 48, distance: 0.6, radius: 12 } as const;

export interface CardLayout {
  /** Card height, dmm. */
  readonly h: number;
  /** Top of each block from the card's top edge, dmm. */
  readonly pinsTop: number;
  readonly ratingsTop: number;
  readonly liveTop: number;
}

const block = (rows: number, more: boolean): number => (rows === 0 && !more ? 0 : CARD.gap + CARD.heading + (rows + (more ? 1 : 0)) * CARD.row);

/** Where each block sits and how tall the card is, from the row counts alone. */
export function layoutCard(m: Pick<CardModel, 'pins' | 'pinsMore' | 'ratings' | 'ratingsMore' | 'live' | 'idle'>): CardLayout {
  const top = CARD.pad + CARD.head + CARD.sub;
  const pins = block(m.pins.length, m.pinsMore !== null);
  const ratings = block(m.ratings.length, m.ratingsMore !== null);
  const live = block(m.live.length + (m.idle !== null ? 1 : 0), false);
  return { h: top + pins + ratings + live + CARD.pad, pinsTop: top, ratingsTop: top + pins, liveTop: top + pins + ratings };
}

/* ---------- redraw throttle ---------- */

/** Live values redraw at most this often (design 6.4 and 9.2). */
export const REDRAW_MS = 250;

/** True when `now` is at least `ms` after `last` (a negative `last` means never drawn). */
export function redrawDue(now: number, last: number, ms: number = REDRAW_MS): boolean {
  return last < 0 || now - last >= ms;
}
