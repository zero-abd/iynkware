/**
 * Type for the headset (XR_DESIGN.md 9.2): Geist and Geist Mono, self-hosted (`xr/public/fonts`, SIL OFL), with the
 * browser's own Devanagari and Chinese after them; sizes in dmm (1 dmm = 1 mm per metre of viewing distance), so text
 * keeps its angular size; Devanagari and Chinese set 1.15x larger with taller lines.
 *
 *   import { TYPE, FONT, dmm, scriptOf, loadFonts } from '../look/type';
 *   const h = dmm(TYPE.body.size, 0.6);           // 22 dmm read at 0.6 m: 0.0132 m tall
 *   await loadFonts();                            // once; canvas text drawn earlier is redrawn by ui/text.ts
 */

/** The sans stack: Geist, then system fonts that carry Devanagari and Chinese. */
export const FONT = '"Geist", system-ui, -apple-system, "Segoe UI", "Noto Sans", "Noto Sans Devanagari", "Noto Sans SC", "PingFang SC", sans-serif';
/** The mono stack, for readouts, code, serial, the clock, and figure callout tags. */
export const FONT_MONO = '"Geist Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, "Noto Sans Mono", "Noto Sans SC", monospace';

export interface TypeRole {
  /** Font size in dmm. */
  readonly size: number;
  readonly weight: 400 | 500 | 600 | 700 | 800;
  readonly mono: boolean;
  /** Letter spacing in em (kickers are spaced out, as the figures' small caps). */
  readonly tracking?: number;
  readonly upper?: boolean;
}

/** The type scale (XR_DESIGN.md 9.2), plus the figures' kicker and callout tag. Nothing smaller than 18 dmm. */
export const TYPE = {
  /** Meter digits, the clock. */
  display: { size: 44, weight: 600, mono: true },
  title: { size: 30, weight: 600, mono: false },
  body: { size: 22, weight: 400, mono: false },
  /** Buttons, chips. */
  label: { size: 20, weight: 500, mono: false },
  code: { size: 20, weight: 400, mono: true },
  /** Pin names, tags, rail labels: the minimum. */
  caption: { size: 18, weight: 500, mono: false },
  /** A figure's small-caps kicker over a value ("STATUS"). */
  kicker: { size: 18, weight: 600, mono: true, tracking: 0.12, upper: true },
  /** A figure's callout tag on a leader line. */
  tag: { size: 20, weight: 700, mono: true, tracking: 0.04 },
} as const satisfies Record<string, TypeRole>;
export type TypeName = keyof typeof TYPE;

/** Metres for `d` dmm seen from `distance` metres. */
export const dmm = (d: number, distance: number): number => (d * distance) / 1000;

export type Script = 'latin' | 'devanagari' | 'han';
/** The script that sets the size and line height of a string. */
export function scriptOf(text: string): Script {
  if (/[ऀ-ॿ]/.test(text)) return 'devanagari';
  if (/[　-〿㐀-鿿豈-﫿＀-￯]/.test(text)) return 'han';
  return 'latin';
}
/** Devanagari and Chinese at 1.15x the Latin size for the same role. */
export const scriptScale = (s: Script): number => (s === 'latin' ? 1 : 1.15);
/** Line height as a share of the font size: 1.35 Latin, 1.45 Chinese, 1.55 Devanagari. */
export const lineHeight = (s: Script): number => (s === 'devanagari' ? 1.55 : s === 'han' ? 1.45 : 1.35);

/** A canvas font string for a role at `px` pixels (before the script scale). */
export function fontOf(role: TypeRole, px: number, script: Script = 'latin'): string {
  return `${role.weight} ${Math.round(px * scriptScale(script))}px ${role.mono ? FONT_MONO : FONT}`;
}

const waiting = new Set<() => void>();
/**
 * Runs `fn` once the self-hosted fonts have loaded (asks for them if nobody has), so canvas text drawn earlier in the
 * system stack is redrawn in Geist. Returns its removal.
 */
export function onFontsReady(fn: () => void): () => void {
  waiting.add(fn);
  void loadFonts().then((ok) => {
    if (ok && waiting.has(fn)) fn();
  });
  return () => void waiting.delete(fn);
}

let loading: Promise<boolean> | null = null;
/**
 * Loads the self-hosted Geist faces (relative to the page, so it works at any deploy path). Resolves true when they
 * are ready, false when the browser cannot (no FontFace, offline before the first visit): text then uses the system
 * stack. Safe to call many times.
 */
export function loadFonts(): Promise<boolean> {
  if (loading) return loading;
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return (loading = Promise.resolve(false));
  const base = new URL('./fonts/', document.baseURI).href;
  const faces = [
    new FontFace('Geist', `url(${base}geist-latin.woff2) format("woff2")`, { weight: '100 900', unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' }),
    new FontFace('Geist', `url(${base}geist-latin-ext.woff2) format("woff2")`, { weight: '100 900', unicodeRange: 'U+0100-02AF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF' }),
    new FontFace('Geist Mono', `url(${base}geist-mono-latin.woff2) format("woff2")`, { weight: '100 900', unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' }),
    new FontFace('Geist Mono', `url(${base}geist-mono-latin-ext.woff2) format("woff2")`, { weight: '100 900', unicodeRange: 'U+0100-02AF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF' }),
  ];
  loading = Promise.all(
    faces.map((f) =>
      f.load().then(
        (face) => {
          document.fonts.add(face);
          return true;
        },
        () => false,
      ),
    ),
  ).then((ok) => ok.every(Boolean));
  return loading;
}
