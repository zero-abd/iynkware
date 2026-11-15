/**
 * The serial panel's text, pure: output arrives in pieces ("Hel", "lo\nWor", "ld\n"), becomes lines (wrapped to the
 * panel's columns, the newest last, the oldest dropped past a cap), and the keypad edits one draft line. Tested in node.
 */

/** Lines kept (after wrapping). The panel shows 14 of them. */
export const KEEP_LINES = 300;
export const VISIBLE_LINES = 14;
/** Characters per line the panel's mono text fits. */
export const COLUMNS = 38;

export interface LineBuffer {
  /** Adds output. `\r\n` and `\n` end a line; a lone `\r` is dropped. A piece without a line end stays open. */
  push(text: string): void;
  clear(): void;
  /** Every kept line, the last one possibly still open (no line end yet), wrapped to the columns. */
  lines(): readonly string[];
  /** Counts every change, so a view redraws only when it differs. */
  readonly version: number;
  /** Lines dropped from the top since the last clear. */
  readonly dropped: number;
}

/** Breaks one logical line into rows of at most `columns` characters (an empty line is one empty row). */
export function wrapLine(line: string, columns: number): string[] {
  if (line.length <= columns) return [line];
  const rows: string[] = [];
  for (let i = 0; i < line.length; i += columns) rows.push(line.slice(i, i + columns));
  return rows;
}

export function createLineBuffer(columns: number = COLUMNS, keep: number = KEEP_LINES): LineBuffer {
  /** Closed logical lines, then `open`: the text since the last line end. */
  let closed: string[] = [];
  let open = '';
  let version = 0;
  let dropped = 0;
  let cache: string[] | null = null;
  const trim = () => {
    // Keep generous raw history; the wrapped cap is applied when reading.
    if (closed.length > keep * 2) {
      dropped += closed.length - keep;
      closed = closed.slice(-keep);
    }
  };
  return {
    push(text) {
      if (text === '') return;
      const parts = (open + text.replace(/\r\n/g, '\n').replace(/\r/g, '')).split('\n');
      open = parts.pop() ?? '';
      for (const part of parts) closed.push(part);
      trim();
      version++;
      cache = null;
    },
    clear() {
      closed = [];
      open = '';
      dropped = 0;
      version++;
      cache = null;
    },
    lines() {
      if (cache) return cache;
      const rows: string[] = [];
      for (const line of closed) rows.push(...wrapLine(line, columns));
      if (open !== '') rows.push(...wrapLine(open, columns));
      cache = rows.length > keep ? rows.slice(-keep) : rows;
      return cache;
    },
    get version() {
      return version;
    },
    get dropped() {
      return dropped;
    },
  };
}

/**
 * The rows to show: `rows` of them, ending `back` rows above the newest (0 follows the newest). `back` is clamped so a
 * full page always shows when there is one.
 */
export function visible(lines: readonly string[], rows: number, back: number): { rows: readonly string[]; back: number } {
  const maxBack = Math.max(0, lines.length - rows);
  const b = Math.max(0, Math.min(maxBack, back));
  const end = lines.length - b;
  return { rows: lines.slice(Math.max(0, end - rows), end), back: b };
}

/** The keypad's keys: digits, space, minus, point, backspace, and Send (which ends the line). */
export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | ' ' | '-' | '.' | 'back' | 'send';
export const KEYS: readonly Key[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', ' ', '-', '.', 'back', 'send'];
export const MAX_DRAFT = 32;

/** One key on the draft: the new draft, and the text to send when it was Send (the draft and a newline). */
export function applyKey(draft: string, key: Key): { draft: string; send: string | null } {
  if (key === 'send') return { draft: '', send: `${draft}\n` };
  if (key === 'back') return { draft: draft.slice(0, -1), send: null };
  return { draft: draft.length >= MAX_DRAFT ? draft : draft + key, send: null };
}
