/**
 * Buttons drawn into a panel's canvas (design 9.1 to 9.4 and 4): primary is accent with an ink label, plain is paper
 * with an ink outline, disabled is `rule` with a `muted` label. An icon always has its word; labels never wrap (they
 * shrink, then cut). Hover and press are drawn by the panel's lift plate (`panel.ts`) over the same rectangle.
 *
 * Usage: drawButton(g, rect, { label: 'Next', icon: 'next', kind: 'primary' }, ctx);
 */
import type { Lang } from '../../contracts/common';
import { roleSize } from './dmm';
import { drawIcon, type IconName } from './icons';
import { measureText, drawFitted, fontOf, type Box } from './text';
import type { Tokens } from './tokens';

export type ButtonKind = 'primary' | 'plain' | 'tab' | 'chip';

export interface ButtonFace {
  readonly label: string;
  readonly icon?: IconName;
  /** The icon after the label (Next). */
  readonly iconAfter?: boolean;
  /** Close only (design 9.4): the icon alone, the label is its tooltip. */
  readonly iconOnly?: boolean;
  readonly kind: ButtonKind;
  readonly disabled?: boolean;
  /** A tab that is the open one, a toggle that is on. */
  readonly active?: boolean;
  readonly hover?: boolean;
  readonly pressed?: boolean;
}

export interface DrawCtx {
  readonly k: Tokens;
  readonly lang: Lang;
  readonly pxPerDmm: number;
  readonly textScale?: number;
}

const PAD_DMM = 14;
const ICON_DMM = 24;
const GAP_DMM = 8;
const OUTLINE_DMM = 2.5;
const RADIUS_DMM = 10;

/** The width a button needs for its face, in px (label at the label role's size). */
export function buttonWidth(g: CanvasRenderingContext2D, face: Pick<ButtonFace, 'label' | 'icon'>, c: DrawCtx): number {
  const size = roleSize('label', c.lang, c.textScale) * c.pxPerDmm;
  g.font = fontOf('label', size, 600);
  const text = g.measureText(face.label).width;
  const icon = face.icon ? (ICON_DMM + GAP_DMM) * c.pxPerDmm : 0;
  return Math.ceil(text + icon + 2 * PAD_DMM * c.pxPerDmm);
}

export function roundRect(g: CanvasRenderingContext2D, r: Box, radius: number): void {
  g.beginPath();
  g.roundRect(r.x, r.y, r.w, r.h, Math.min(radius, r.h / 2, r.w / 2));
}

export function drawButton(g: CanvasRenderingContext2D, r: Box, face: ButtonFace, c: DrawCtx): void {
  const { k } = c;
  const line = OUTLINE_DMM * c.pxPerDmm * k.outline;
  const inset: Box = { x: r.x + line / 2, y: r.y + line / 2, w: r.w - line, h: r.h - line };
  const radius = (face.kind === 'chip' ? 7 : RADIUS_DMM) * c.pxPerDmm;
  let fill: string = k.paper;
  if (face.disabled) fill = k.rule;
  else if (face.pressed || face.kind === 'primary' || face.kind === 'chip' || (face.kind === 'tab' && face.active)) fill = k.accent;
  if (face.kind === 'tab' && face.active && !face.pressed) fill = k.paper;
  roundRect(g, inset, radius);
  g.fillStyle = fill;
  g.fill();
  const hoverEdge = face.hover && !face.disabled && !face.pressed;
  g.lineWidth = hoverEdge ? line * 1.6 : line;
  g.strokeStyle = hoverEdge && fill !== k.accent ? k.accent : k.ink;
  if (face.kind === 'tab' && !face.active && !face.hover && !face.pressed) g.strokeStyle = k.rule;
  if (face.disabled) g.strokeStyle = k.muted;
  g.stroke();
  // The open tab is marked by an accent bar along its bottom as well as its ink outline (never colour alone).
  if (face.kind === 'tab' && face.active) {
    g.fillStyle = k.accent;
    const bar = 4 * c.pxPerDmm;
    g.beginPath();
    g.roundRect(r.x + radius, r.y + r.h - line - bar, r.w - 2 * radius, bar, bar / 2);
    g.fill();
  }
  const fg = face.disabled ? k.muted : k.ink;
  if (face.iconOnly && face.icon) {
    drawIcon(g, face.icon, r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.55, k, fg);
    return;
  }
  const pad = (face.kind === 'chip' ? 8 : PAD_DMM) * c.pxPerDmm;
  const icon = face.icon ? ICON_DMM * c.pxPerDmm : 0;
  const gap = face.icon ? GAP_DMM * c.pxPerDmm : 0;
  const room = Math.max(10, r.w - 2 * pad - icon - gap);
  const style = { role: 'label' as const, lang: c.lang, pxPerDmm: c.pxPerDmm, colour: fg, textScale: c.textScale, maxLines: 1, weight: 600, valign: 'middle' as const };
  const f = measureText(g, face.label, { x: 0, y: 0, w: room, h: r.h }, style);
  g.font = fontOf('label', f.size, 600);
  const textW = Math.min(room, g.measureText(f.lines[0] ?? '').width);
  const total = textW + icon + gap;
  let x = r.x + (r.w - total) / 2;
  const cy = r.y + r.h / 2;
  if (face.icon && !face.iconAfter) {
    drawIcon(g, face.icon, x + icon / 2, cy, icon, k, fg);
    x += icon + gap;
  }
  drawFitted(g, f, { x, y: r.y, w: textW, h: r.h }, style);
  if (face.icon && face.iconAfter) drawIcon(g, face.icon, x + textW + gap + icon / 2, cy, icon, k, fg);
}
