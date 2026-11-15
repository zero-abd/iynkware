/**
 * The Code tab's program and its parameter chips (design 7.2). `codeView(doc)` is the starter source as coloured lines
 * with the chips' slots marked; `chipOps(doc, param, value)` is the one batch that changes a chip: `param.set` plus a
 * `source.edit` over each slot the chip has in the code, so the circuit and the program change together and one undo
 * puts both back. The slots are found by rendering the guide's template with the project's current values and comparing
 * with the source: equal means the ranges are exact; a source edited elsewhere has no slots and its chips change only
 * the circuit.
 */
import { setParam, type ParamValues } from '@/lib/boardlab/template';
import type { ParamChip } from '@/content/schema';
import type { Op, Project } from '../../contracts/project';
import type { LocalizedText } from '../../contracts/common';
import type { Chip, CodeLine, CodeSpan, CodeView, TokenKind } from '../types';
import { tokenize } from './tokens';

type Parameter = Project['parameters'][number];
type Value = string | number | boolean;
type Starter = NonNullable<NonNullable<Project['guide']>['starter']>;

/** A chip's slot in the rendered source: `[from, to)` in UTF-16 units. */
export interface Slot {
  readonly name: string;
  readonly param: string;
  readonly from: number;
  readonly to: number;
}

const SLOT = /\{\{p:([^}]+)\}\}/g;
/** The stepper's values (design 7.2) inside a number's range. */
export const STEPS = [100, 250, 500, 1000, 2000] as const;

const decimals = (step: number): number => {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
};

/** The code a value puts into a slot. */
export function slotCode(p: Parameter, value: Value, splices: Starter['splices']): string {
  const spliced = splices?.[p.name]?.[String(value)];
  if (spliced !== undefined) return spliced;
  if (p.kind === 'number' && typeof value === 'number') return p.step && p.step > 0 ? value.toFixed(decimals(p.step)) : String(value);
  return String(value);
}

/** The starter's template rendered with `values` (by parameter id), and where each slot landed. */
export function renderStarter(starter: Starter, params: readonly Parameter[], values: Readonly<Record<string, Value>>): { code: string; slots: Slot[] } {
  const slots: Slot[] = [];
  let code = '';
  let last = 0;
  for (const m of starter.template.matchAll(SLOT)) {
    const name = m[1]!.trim();
    const p = params.find((x) => x.name === name);
    code += starter.template.slice(last, m.index);
    const text = p ? slotCode(p, values[p.id] ?? p.value, starter.splices) : '';
    if (p) slots.push({ name, param: p.id, from: code.length, to: code.length + text.length });
    code += text;
    last = m.index! + m[0].length;
  }
  return { code: code + starter.template.slice(last), slots };
}

const currentValues = (doc: Project): Record<string, Value> => Object.fromEntries(doc.parameters.map((p) => [p.id, p.value]));

/** The starter's slots when the source still is the template rendered with the current values; else null. */
function locate(doc: Project): { starter: Starter; source: Project['sources'][number]; slots: Slot[] | null } | null {
  const starter = doc.guide?.starter;
  if (!starter) return null;
  const source = doc.sources.find((s) => s.id === starter.source);
  if (!source) return null;
  const { code, slots } = renderStarter(starter, doc.parameters, currentValues(doc));
  return { starter, source, slots: code === source.content ? slots : null };
}

const text = (t: Parameter['label'], fallback: string): LocalizedText => (t === undefined ? { en: fallback } : typeof t === 'string' ? { en: t } : t);

/** The unit a number chip shows: the parameter's own, else milliseconds when its slot is a delay's argument. */
function unitOf(p: Parameter, source: string, slots: readonly Slot[] | null): string | undefined {
  if (p.unit && p.unit !== '1') return p.unit;
  const slot = slots?.find((s) => s.param === p.id);
  if (!slot) return undefined;
  const before = source.slice(Math.max(0, slot.from - 24), slot.from);
  return /(?:delay|delayMicroseconds|sleep_ms|sleep_us)\s*\(\s*$/.test(before) ? (/Micro|_us/.test(before) ? 'us' : 'ms') : undefined;
}

/** The stepper values of a number: the design's steps inside its range, plus the current value. */
export function stepValues(p: Parameter): number[] {
  const lo = p.min ?? -Infinity;
  const hi = p.max ?? Infinity;
  const set = new Set<number>(STEPS.filter((v) => v >= lo && v <= hi));
  if (typeof p.value === 'number') set.add(p.value);
  return [...set].sort((a, b) => a - b);
}

function chipOf(p: Parameter, source: string, slots: readonly Slot[] | null): Chip {
  const unit = p.kind === 'number' ? unitOf(p, source, slots) : undefined;
  let options: Chip['options'];
  if (p.kind === 'number') options = stepValues(p).map((value) => ({ value, label: { en: unit ? `${value} ${unit}` : String(value) } }));
  else if (p.kind === 'toggle') options = [true, false].map((value) => ({ value, label: { en: '' } })); // the panel's own on/off words
  else options = (p.options ?? []).map((o) => ({ value: o.value, label: text(o.label, String(o.value)) }));
  return {
    param: p.id,
    name: p.name,
    label: text(p.label, p.name),
    kind: p.kind,
    value: p.value,
    options,
    ...(unit ? { unit } : {}),
    inCode: !!slots?.some((s) => s.param === p.id),
  };
}

/** The source as coloured lines, with a `chip` span over each slot. */
export function codeLines(code: string, language: string, slots: readonly Slot[]): CodeLine[] {
  const kinds = tokenize(code, language);
  const chipAt: number[] = new Array<number>(code.length).fill(-1);
  slots.forEach((s, i) => chipAt.fill(i, s.from, s.to));
  const lines: CodeLine[] = [];
  let at = 0;
  code.split('\n').forEach((line, i, all) => {
    // A trailing newline leaves one empty last line that is not a line of the program.
    if (i === all.length - 1 && line === '' && i > 0) return;
    const spans: CodeSpan[] = [];
    let from = 0;
    for (let k = 1; k <= line.length; k++) {
      const a = at + k - 1;
      const b = at + k;
      if (k < line.length && chipAt[a] === chipAt[b] && (chipAt[a] >= 0 || kinds[a] === kinds[b])) continue;
      const slot = chipAt[a]! >= 0 ? slots[chipAt[a]!] : undefined;
      const kind: TokenKind = slot ? 'chip' : kinds[a]!;
      spans.push(slot ? { text: line.slice(from, k), kind, chip: slot.param } : { text: line.slice(from, k), kind });
      from = k;
    }
    if (line === '') spans.push({ text: '', kind: 'plain' });
    lines.push({ n: i + 1, spans });
    at += line.length + 1;
  });
  return lines;
}

/** The program and the chips of the project's guide, or null when it has no starter. */
export function codeView(doc: Project): CodeView | null {
  const found = locate(doc);
  if (!found) return null;
  const { source, slots } = found;
  return {
    sourceId: source.id,
    language: source.language,
    lines: codeLines(source.content, source.language, slots ?? []),
    chips: doc.parameters.map((p) => chipOf(p, source.content, slots)),
  };
}

const numberChip = (p: Parameter, value: number): ParamChip => ({
  id: p.id,
  kind: 'number',
  label: p.id,
  default: value,
  min: p.min ?? (p.step ? 0 : -1e9),
  max: p.max ?? 1e9,
  step: p.step ?? 0,
  ...(p.keepApart ? { keepApart: p.keepApart } : {}),
});

/** The values after setting `param`: coerced, clamped to its range and step, and the other numbers kept apart. */
function nextValues(doc: Project, param: Parameter, value: Value): Record<string, Value> | null {
  const now = currentValues(doc);
  if (param.kind === 'toggle') return typeof value === 'boolean' ? { ...now, [param.id]: value } : null;
  if (param.kind === 'choice') return param.options?.some((o) => o.value === value || String(o.value) === String(value))
    ? { ...now, [param.id]: param.options.find((o) => String(o.value) === String(value))!.value }
    : null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const numbers = doc.parameters.filter((p) => p.kind === 'number');
  return { ...now, ...(setParam(numbers.map((p) => numberChip(p, now[p.id] as number)), now as ParamValues, param.id, n) as Record<string, Value>) };
}

/**
 * The ops that set a chip to `value`, one batch: `param.set` for every parameter that changes (a keep-apart rule may move
 * a second one) and `source.edit` for each of their slots in the code. `[]` when nothing changes. Edits are in the
 * positions of the current source and share its revision as `baseSeq`, so the store orders them; they are emitted from
 * the end of the file backwards as well, so they hold even without that.
 */
export function chipOps(doc: Project, param: string, value: Value): Op[] {
  const p = doc.parameters.find((x) => x.id === param);
  if (!p) return [];
  const next = nextValues(doc, p, value);
  if (!next) return [];
  const changed = doc.parameters.filter((x) => next[x.id] !== x.value);
  if (changed.length === 0) return [];
  const found = locate(doc);
  const edits: Array<{ pos: number; del: number; ins: string }> = [];
  if (found?.slots) {
    for (const slot of found.slots) {
      const q = changed.find((x) => x.id === slot.param);
      if (q) edits.push({ pos: slot.from, del: slot.to - slot.from, ins: slotCode(q, next[q.id]!, found.starter.splices) });
    }
  }
  edits.sort((a, b) => b.pos - a.pos);
  // The edits go first: the store builds a source.edit's inverse with baseSeq = revision + 1 of the batch's start, which is
  // right only for the first op of a batch, so an edit behind another op would undo into the wrong place.
  return [
    ...edits.map((e): Op => ({ k: 'source.edit', id: found!.source.id, baseSeq: doc.revision, ...e })),
    ...changed.map((x): Op => ({ k: 'param.set', parameter: { ...x, value: next[x.id]! } })),
  ];
}
