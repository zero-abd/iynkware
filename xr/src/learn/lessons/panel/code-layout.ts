/**
 * Pure layout of the Code tab (design 7.2), unit tested: the program's lines as visual rows of a mono font, long lines
 * wrapped with a two-column indent (no sideways scrolling in the headset), parameter chips kept whole, and the values a
 * chip's picker offers.
 */
import type { Lang } from '../../../contracts/common';
import { pick } from '../../text';
import type { Chip, CodeLine, TokenKind } from '../../types';

export interface RowSpan {
  readonly text: string;
  readonly kind: TokenKind;
  readonly chip?: string;
  /** First column of the span; a chip takes one more column for its pill. */
  readonly col: number;
  readonly cols: number;
}

export interface VisualRow {
  /** The source line number on its first row, 0 on a continuation. */
  readonly n: number;
  readonly spans: readonly RowSpan[];
}

const INDENT = 2;

export function layoutCode(lines: readonly CodeLine[], cols: number, chipText: (param: string, text: string) => string = (_p, t) => t): VisualRow[] {
  const rows: VisualRow[] = [];
  const width = Math.max(INDENT + 4, cols);
  for (const line of lines) {
    let spans: RowSpan[] = [];
    let col = 0;
    let first = true;
    const flush = () => {
      rows.push({ n: first ? line.n : 0, spans });
      spans = [];
      col = INDENT;
      first = false;
    };
    for (const s of line.spans) {
      if (s.kind === 'chip' && s.chip) {
        const text = chipText(s.chip, s.text);
        const need = Array.from(text).length + 1;
        if (col + need > width && col > INDENT) flush();
        spans.push({ text, kind: 'chip', chip: s.chip, col, cols: need });
        col += need;
        continue;
      }
      let rest = Array.from(s.text);
      while (rest.length > 0) {
        const room = width - col;
        if (room <= 0) {
          flush();
          continue;
        }
        // Leading spaces of a continuation are dropped; the indent stands for them.
        if (!first && col === INDENT && spans.length === 0) {
          while (rest.length > 0 && rest[0] === ' ') rest = rest.slice(1);
          if (rest.length === 0) break;
        }
        // Break after the last space that fits, else mid-word.
        let cut = Math.min(room, rest.length);
        if (rest.length > room) {
          const space = rest.slice(0, room + 1).lastIndexOf(' ');
          if (space > 0) cut = Math.min(room, space + 1);
        }
        const piece = rest.slice(0, cut);
        spans.push({ text: piece.join(''), kind: s.kind, col, cols: piece.length });
        col += piece.length;
        rest = rest.slice(piece.length);
        if (rest.length > 0) flush();
      }
    }
    rows.push({ n: first ? line.n : 0, spans });
  }
  return rows;
}

export interface PickerOption {
  readonly value: string | number | boolean;
  readonly label: string;
  readonly current: boolean;
}

/** The stepper of design 7.2, used when a number chip carries no values of its own. */
export const DEFAULT_STEPS = [100, 250, 500, 1000, 2000] as const;

/** A value as the chip shows it: the option's own label, or the number with its unit. */
export function valueLabel(chip: Chip, value: string | number | boolean, lang: Lang, words: { on: string; off: string }): string {
  const own = chip.options.find((o) => o.value === value);
  if (own) {
    const p = pick(own.label, lang).text;
    if (p) return p;
  }
  if (typeof value === 'boolean') return value ? words.on : words.off;
  return chip.unit ? `${value} ${chip.unit}` : String(value);
}

/** What the picker offers: the chip's choices or stepper values; a toggle's on and off; the default stepper otherwise. */
export function pickerOptions(chip: Chip, lang: Lang, words: { on: string; off: string }): PickerOption[] {
  let values: Array<string | number | boolean> = chip.options.map((o) => o.value);
  if (values.length === 0 && chip.kind === 'toggle') values = [true, false];
  if (values.length === 0 && chip.kind === 'number') {
    values = [...DEFAULT_STEPS];
    if (typeof chip.value === 'number' && !values.includes(chip.value)) values = [...values, chip.value].sort((a, b) => Number(a) - Number(b));
  }
  return values.map((value) => ({ value, label: valueLabel(chip, value, lang, words), current: value === chip.value }));
}
