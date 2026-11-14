/**
 * Canvas painters for the spatial UI, in iynk's hand: opaque paper plates with an ink outline and a flat blue shadow
 * plate, pill buttons, the figures' cream callout tags, small-caps kickers over values, Phosphor icons, and text that
 * wraps, shrinks at most 15 % and then ellipsises (XR_DESIGN.md 9.5). Every UI texture is drawn with these, so panels,
 * chips, cards, callouts and the run cluster look like one product.
 *
 *   import { paintPlate, paintPill, paintTag, paintKicker, paintIcon, fitLines } from '../look/paint';
 *   paintPlate(g, 0, 0, w, h, { radius: 24, border: 5, shadow: 12 });
 *   paintIcon(g, 'play', 20, 20, 64, INK);
 *   const lines = fitLines(g, text, { maxWidth: 600, size: 44, minSize: 38, maxLines: 4, role: TYPE.body });
 *
 * Coordinates are canvas pixels. Sizes (border, radius, shadow) are given in pixels by the caller, which knows its
 * texels per dmm (`PX_PER_DMM`).
 */
import { ICONS, type IconName } from './icons';
import { INK, PAPER, SHADOW, TAG } from './palette';
import { fontOf, lineHeight, scriptOf, type TypeRole } from './type';

/** Texels per dmm for UI textures (XR_DESIGN.md 9.2: two texels per dmm). */
export const PX_PER_DMM = 2;
/** The panel anatomy in dmm (XR_DESIGN.md 9.1): outline 2.5, corners 12, padding 16, shadow plate 6 right and down. */
export const PLATE = { border: 2.5, radius: 12, padding: 16, shadow: 6 } as const;

type G = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface PlateStyle {
  fill?: string;
  ink?: string;
  /** Outline width, px. 0 for none. */
  border?: number;
  /** Corner radius, px. */
  radius?: number;
  /** The flat shadow plate's offset right and down, px. 0 for none. */
  shadow?: number;
  shadowColor?: string;
}

/** The space a plate's shadow needs on its right and bottom: draw the plate `shadow` px smaller than the canvas. */
export const plateInset = (s: PlateStyle): number => (s.shadow ?? 0) + (s.border ?? 0) / 2;

function roundRect(g: G, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** A paper plate: the flat shadow plate first, then the paper, then the ink outline (inside the given rectangle). */
export function paintPlate(g: G, x: number, y: number, w: number, h: number, s: PlateStyle = {}): void {
  const border = s.border ?? 5;
  const radius = s.radius ?? 24;
  const shadow = s.shadow ?? 0;
  const half = border / 2;
  if (shadow > 0) {
    g.fillStyle = s.shadowColor ?? SHADOW;
    roundRect(g, x + shadow + half, y + shadow + half, w - shadow - border, h - shadow - border, radius);
    g.fill();
  }
  roundRect(g, x + half, y + half, w - shadow - border, h - shadow - border, radius);
  g.fillStyle = s.fill ?? PAPER;
  g.fill();
  if (border > 0) {
    g.lineWidth = border;
    g.strokeStyle = s.ink ?? INK;
    g.lineJoin = 'round';
    g.stroke();
  }
}

/** A pill (fully rounded ends): the figures' buttons and toggles. */
export function paintPill(g: G, x: number, y: number, w: number, h: number, s: PlateStyle = {}): void {
  paintPlate(g, x, y, w, h, { ...s, radius: h });
}

/** Sets the font for a role at `px` for this text's script, and its tracking. Returns the script's line height. */
export function useFont(g: G, role: TypeRole, px: number, text = ''): number {
  const script = scriptOf(text);
  g.font = fontOf(role, px, script);
  const gl = g as unknown as { letterSpacing?: string };
  if ('letterSpacing' in g) gl.letterSpacing = role.tracking ? `${(role.tracking * px).toFixed(1)}px` : '0px';
  return lineHeight(script);
}

/** Draws one line of text in a role. `align` and `baseline` as canvas. */
export function paintText(
  g: G,
  text: string,
  x: number,
  y: number,
  role: TypeRole,
  px: number,
  colour: string = INK,
  align: CanvasTextAlign = 'left',
  baseline: CanvasTextBaseline = 'middle',
): void {
  const t = role.upper ? text.toLocaleUpperCase() : text;
  useFont(g, role, px, t);
  g.fillStyle = colour;
  g.textAlign = align;
  g.textBaseline = baseline;
  g.fillText(t, x, y);
}

/** A figure's kicker: small caps, spaced, muted, over a value (STATUS / RUNNING). */
export function paintKicker(g: G, text: string, x: number, y: number, px: number, colour: string, align: CanvasTextAlign = 'left'): void {
  paintText(g, text, x, y, { size: 18, weight: 600, mono: true, tracking: 0.12, upper: true }, px, colour, align);
}

const pathCache = new Map<IconName, Path2D>();
/** A Phosphor icon `size` px square with its top left at (x, y). */
export function paintIcon(g: G, name: IconName, x: number, y: number, size: number, colour: string = INK): void {
  if (typeof Path2D === 'undefined') return;
  let p = pathCache.get(name);
  if (!p) {
    p = new Path2D(ICONS[name]);
    pathCache.set(name, p);
  }
  g.save();
  g.translate(x, y);
  g.scale(size / 256, size / 256);
  g.fillStyle = colour;
  g.fill(p);
  g.restore();
}

/**
 * A figure's callout tag (core.js): a cream pill with an ink outline and mono text, `on` filled with the figure
 * accent. Returns nothing; size the canvas with `measureTag` first.
 */
export function paintTag(g: G, text: string, x: number, y: number, w: number, h: number, opts: { fill?: string; border?: number } = {}): void {
  paintPill(g, x, y, w, h, { fill: opts.fill ?? TAG, border: opts.border ?? Math.max(2, h * 0.07) });
  paintText(g, text, x + w / 2, y + h / 2, { size: 20, weight: 700, mono: true, tracking: 0.04 }, h * 0.5, INK, 'center');
}

/** Breaks text into words, or into characters for scripts written without spaces (Chinese). */
function tokens(text: string): string[] {
  if (scriptOf(text) === 'han') return Array.from(text);
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

/** Wraps `text` into lines no wider than `maxWidth` at the current font. */
export function wrap(g: G, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const tok of tokens(para)) {
      const next = line + tok;
      if (line && g.measureText(next.trimEnd()).width > maxWidth) {
        out.push(line.trimEnd());
        line = /^\s+$/.test(tok) ? '' : tok;
      } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

export interface FitOptions {
  role: TypeRole;
  /** The role's size in px. */
  size: number;
  /** Never smaller than this (XR_DESIGN.md 9.5: at most 15 % smaller, never under 18 dmm). Default 0.85 x size. */
  minSize?: number;
  maxWidth: number;
  maxLines: number;
}
export interface Fitted {
  lines: string[];
  /** The font size in px the lines were fitted at. */
  size: number;
  /** Line height in px. */
  lineHeight: number;
  /** True when the text had to be cut with an ellipsis. */
  cut: boolean;
}

/**
 * Fits text into at most `maxLines` lines of `maxWidth`: wrap first; else shrink in steps down to `minSize`; else cut
 * the last line with an ellipsis. Leaves the context's font set to the fitted size.
 */
export function fitLines(g: G, text: string, o: FitOptions): Fitted {
  const min = o.minSize ?? o.size * 0.85;
  const t = o.role.upper ? text.toLocaleUpperCase() : text;
  for (let size = o.size; size >= min - 0.01; size -= Math.max(1, o.size * 0.05)) {
    const lh = useFont(g, o.role, size, t);
    const lines = wrap(g, t, o.maxWidth);
    if (lines.length <= o.maxLines && lines.every((l) => g.measureText(l).width <= o.maxWidth)) return { lines, size, lineHeight: size * lh, cut: false };
  }
  const lh = useFont(g, o.role, min, t);
  const lines = wrap(g, t, o.maxWidth).slice(0, o.maxLines);
  let last = lines[lines.length - 1] ?? '';
  while (last.length > 0 && g.measureText(last + '…').width > o.maxWidth) last = Array.from(last).slice(0, -1).join('');
  lines[lines.length - 1] = last.trimEnd() + '…';
  return { lines, size: min, lineHeight: min * lh, cut: true };
}

/** A 2D canvas, in the DOM when there is one (CanvasTexture needs a source the GPU can upload). */
export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.ceil(w));
  c.height = Math.max(2, Math.ceil(h));
  return c;
}
