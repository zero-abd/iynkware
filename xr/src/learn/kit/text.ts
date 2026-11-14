/**
 * Canvas text in a box, fitted per design 9.5 (`fit.ts`) at a role's size (9.2), with the script's line height and the
 * 1.15x size for Devanagari and Chinese. Sizes in dmm, the box in canvas pixels; `pxPerDmm` converts.
 *
 * Usage: drawText(g, 'Press Run.', { x: 40, y: 200, w: 900, h: 300 }, { role: 'body', lang, pxPerDmm: 2.4, colour: k.ink });
 */
import type { Lang } from '../../contracts/common';
import { MIN_DMM, ROLES, lineHeight, roleSize, type Role } from './dmm';
import { fitText, type Fitted } from './fit';
import { MONO, SANS } from './tokens';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextStyle {
  readonly role: Role;
  readonly lang: Lang;
  readonly pxPerDmm: number;
  readonly colour: string;
  /** The text size setting (1, 1.25, 1.5). */
  readonly textScale?: number;
  readonly maxLines?: number;
  readonly align?: 'left' | 'center' | 'right';
  /** Vertical placement of the block in its box. */
  readonly valign?: 'top' | 'middle' | 'bottom';
  readonly weight?: number;
}

export const fontOf = (role: Role, sizePx: number, weight?: number): string =>
  `${weight ?? ROLES[role].weight} ${sizePx.toFixed(1)}px ${ROLES[role].mono ? MONO : SANS}`;

/** Fits without drawing: lines, size (px) and height (px). */
export function measureText(g: CanvasRenderingContext2D, text: string, box: Box, s: TextStyle): Fitted {
  const size = roleSize(s.role, s.lang, s.textScale) * s.pxPerDmm;
  const measure = (t: string, px: number) => {
    g.font = fontOf(s.role, px, s.weight);
    return g.measureText(t).width;
  };
  return fitText(text, {
    size,
    minSize: MIN_DMM * s.pxPerDmm,
    maxWidth: box.w,
    maxHeight: box.h,
    lineHeight: s.role === 'code' ? 1.3 : lineHeight(s.lang),
    maxLines: s.maxLines,
    measure,
  });
}

/** Draws fitted text; returns what was drawn. */
export function drawText(g: CanvasRenderingContext2D, text: string, box: Box, s: TextStyle): Fitted {
  const f = measureText(g, text, box, s);
  drawFitted(g, f, box, s);
  return f;
}

/** Draws lines `measureText` returned. */
export function drawFitted(g: CanvasRenderingContext2D, f: Fitted, box: Box, s: TextStyle): void {
  const lh = f.size * (s.role === 'code' ? 1.3 : lineHeight(s.lang));
  const block = f.lines.length * lh;
  const top = s.valign === 'middle' ? box.y + (box.h - block) / 2 : s.valign === 'bottom' ? box.y + box.h - block : box.y;
  g.font = fontOf(s.role, f.size, s.weight);
  g.fillStyle = s.colour;
  g.textBaseline = 'middle';
  g.textAlign = s.align ?? 'left';
  const x = s.align === 'center' ? box.x + box.w / 2 : s.align === 'right' ? box.x + box.w : box.x;
  f.lines.forEach((line, i) => g.fillText(line, x, top + lh * (i + 0.5)));
}
