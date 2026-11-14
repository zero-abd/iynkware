/**
 * Text fitting of design 9.5, pure so it is unit tested: wrap where the slot allows lines; else shrink by up to 15 %
 * (never under the 18 dmm minimum); else cut the last line with an ellipsis. Buttons pass `maxLines: 1`.
 * Chinese breaks between characters, everything else at spaces (a word wider than the slot breaks by characters).
 *
 * Usage: const f = fitText(text, { size: 22, minSize: 18, maxWidth: 400, maxHeight: 180, lineHeight: 1.35, measure });
 */

export interface FitOptions {
  /** The role's size, in the same unit as `maxWidth` and `maxHeight` (dmm or px). */
  readonly size: number;
  /** Never smaller than this (18 dmm in the slot's unit). */
  readonly minSize: number;
  readonly maxWidth: number;
  /** Height of the slot; with `lineHeight` it decides how many lines fit. */
  readonly maxHeight: number;
  /** Line height as a multiple of the size. */
  readonly lineHeight: number;
  /** A hard cap on lines (six for a step's text, one for a button). */
  readonly maxLines?: number;
  /** Width of `text` at `size`. */
  readonly measure: (text: string, size: number) => number;
}

export interface Fitted {
  readonly lines: readonly string[];
  readonly size: number;
  /** The text was cut (show it whole on hover). */
  readonly truncated: boolean;
  /** Height the lines take: lines x size x lineHeight. */
  readonly height: number;
}

/** How far a slot may shrink its text (design 9.5). */
export const SHRINK = 0.85;
const ELLIPSIS = '…';
const CJK = /[⺀-〿぀-鿿豈-﫿＀-￯]/;
const UNITS = /[⺀-〿぀-鿿豈-﫿＀-￯]|[^\s⺀-〿぀-鿿豈-﫿＀-￯]+|[ \t]+/g;

/** Break units: words, runs of spaces, single CJK characters. */
export function units(text: string): string[] {
  return text.match(UNITS) ?? [];
}

/**
 * Greedy wrap at `size`; every returned line fits its width unless a single character does not. `maxWidth` may be a
 * function of the line's index, for a first line that starts after a word in another style.
 */
export function wrap(text: string, maxWidthOrFn: number | ((line: number) => number), size: number, measure: FitOptions['measure']): string[] {
  const out: string[] = [];
  const widthOf = typeof maxWidthOrFn === 'number' ? () => maxWidthOrFn : maxWidthOrFn;
  for (const para of text.split('\n')) {
    let line = '';
    const push = () => {
      out.push(line.trimEnd());
      line = '';
    };
    for (const u of units(para)) {
      if (/^[ \t]+$/.test(u)) {
        if (line !== '') line += ' ';
        continue;
      }
      const next = line + u;
      if (measure(next.trimEnd(), size) <= widthOf(out.length)) {
        line = next;
        continue;
      }
      if (line.trim() !== '') push();
      else if (measure(u, size) <= widthOf(out.length + 1)) {
        // A short first line (after a word in another style) that cannot take the word: start on the next one.
        push();
        line = u;
        continue;
      }
      if (measure(u, size) <= widthOf(out.length)) {
        line = u;
        continue;
      }
      // A word wider than the slot: break it by characters.
      for (const ch of Array.from(u)) {
        if (line !== '' && measure(line + ch, size) > widthOf(out.length)) push();
        line += ch;
      }
    }
    push();
  }
  // Drop empty lines a trailing push left behind, keep deliberate blank lines between paragraphs.
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

/** Cuts `line` so that it plus an ellipsis fits `maxWidth`. */
export function ellipsize(line: string, maxWidth: number, size: number, measure: FitOptions['measure']): string {
  if (measure(line + ELLIPSIS, size) <= maxWidth) return line + ELLIPSIS;
  const chars = Array.from(line);
  while (chars.length > 0 && measure(chars.join('').trimEnd() + ELLIPSIS, size) > maxWidth) chars.pop();
  return chars.join('').trimEnd() + ELLIPSIS;
}

export function fitText(text: string, o: FitOptions): Fitted {
  const floor = Math.min(o.size, Math.max(o.minSize, o.size * SHRINK));
  const linesAt = (size: number) => {
    const fromHeight = Math.max(1, Math.floor((o.maxHeight + 1e-6) / (size * o.lineHeight)));
    return Math.max(1, Math.min(o.maxLines ?? Infinity, fromHeight));
  };
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const size = o.size - ((o.size - floor) * i) / steps;
    if (i > 0 && size === o.size) break;
    const lines = wrap(text, o.maxWidth, size, o.measure);
    if (lines.length <= linesAt(size) && lines.every((l) => o.measure(l, size) <= o.maxWidth)) {
      return { lines, size, truncated: false, height: lines.length * size * o.lineHeight };
    }
  }
  const size = floor;
  const max = linesAt(size);
  const all = wrap(text, o.maxWidth, size, o.measure);
  const lines = all.slice(0, max);
  const cut = all.length > max || lines.some((l) => o.measure(l, size) > o.maxWidth);
  if (cut) {
    const last = lines.length - 1;
    // The rest of the text joins the last line before it is cut, so the ellipsis stands where words are missing.
    const rest = CJK.test(all.slice(max).join('')) ? all.slice(last).join('') : all.slice(last).join(' ');
    lines[last] = ellipsize(rest, o.maxWidth, size, o.measure);
  }
  return { lines, size, truncated: cut, height: lines.length * size * o.lineHeight };
}
