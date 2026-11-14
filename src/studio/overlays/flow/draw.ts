import type { Viewport } from "../../engine/types.ts";
import type { FlowItem } from "./model.ts";
import { speedPx } from "./scale.ts";

/** The part of a 2D canvas context the flow drawing uses, so it can be tested without a browser canvas. */
export interface Ctx2D {
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, from: number, to: number): void;
  stroke(): void;
  fill(): void;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
}

export interface FlowStyle {
  /** Dots are filled with the paper colour and outlined in ink, so they show on a wire of any voltage colour. */
  paper: string;
  ink: string;
}

export const DOT_SPACING_PX = 14;
export const DOT_RADIUS_PX = 2.5;
export const MAX_DOTS = 3000;
const LINE_PX = 3;
const ARROW_PX = 3.5;
const MIN_SEGMENT_PX = 0.5;

const TAU = Math.PI * 2;

/** A box in canvas pixels the lens leaves empty: a run tag's card, which has to stay readable over a coloured wire. */
export interface Hole {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DrawResult {
  dots: number;
  /** True when some wire carries current, so a moving drawing has to be drawn again next frame. */
  flowing: boolean;
}

/** The phase a dot row starts at, spread by name so neighbouring wires do not march in step. */
function startPhase(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % DOT_SPACING_PX;
}

function visible(item: FlowItem, v: Viewport): boolean {
  const left = v.cx_mm - v.w / v.k / 2;
  const top = v.cy_mm - v.h / v.k / 2;
  return item.x1 >= left && item.x0 <= left + v.w / v.k && item.y1 >= top && item.y0 <= top + v.h / v.k;
}

/**
 * Draws the flow of one frame: the wire lines grouped by colour, then a row of dots (moving) or arrowheads (still)
 * along each polyline that carries current, then clears `holes` so the run tags under them show through. `phases` keeps where each row has got to, so a dot keeps its place when
 * the current changes; it moves by `dtSeconds` only when `motion` is true.
 */
export function drawFlow(
  ctx: Ctx2D,
  items: readonly FlowItem[],
  v: Viewport,
  phases: Map<string, number>,
  dtSeconds: number,
  opts: { style: FlowStyle; motion: boolean; holes?: readonly Hole[] },
): DrawResult {
  ctx.clearRect(0, 0, v.w, v.h);
  const shown = items.filter((i) => visible(i, v));
  const px = (xy: Float64Array, n: number): [number, number] => [(xy[2 * n]! - v.cx_mm) * v.k + v.w / 2, (xy[2 * n + 1]! - v.cy_mm) * v.k + v.h / 2];

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = LINE_PX;
  const byColour = new Map<string, FlowItem[]>();
  for (const item of shown) {
    if (item.colour === null) continue;
    const group = byColour.get(item.colour);
    if (group) group.push(item);
    else byColour.set(item.colour, [item]);
  }
  for (const [colour, group] of byColour) {
    ctx.strokeStyle = colour;
    ctx.beginPath();
    for (const item of group) {
      for (let n = 0; n < item.xy.length / 2; n++) {
        const [x, y] = px(item.xy, n);
        if (n === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  let dots = 0;
  let flowing = false;
  const marks: [number, number, number, number][] = [];
  for (const item of shown) {
    if (item.amps === 0) continue;
    const points = item.xy.length / 2;
    const xs: number[] = [];
    const ys: number[] = [];
    const along: number[] = [0];
    for (let n = 0; n < points; n++) {
      const [x, y] = px(item.xy, n);
      xs.push(x);
      ys.push(y);
      if (n > 0) along.push(along[n - 1]! + Math.hypot(x - xs[n - 1]!, y - ys[n - 1]!));
    }
    const length = along[points - 1]!;
    if (length < MIN_SEGMENT_PX) continue;
    const sign = item.amps > 0 ? 1 : -1;
    let phase = phases.get(item.key) ?? startPhase(item.key);
    if (opts.motion && dtSeconds > 0) {
      phase = (((phase + sign * speedPx(item.amps) * dtSeconds) % DOT_SPACING_PX) + DOT_SPACING_PX) % DOT_SPACING_PX;
    }
    flowing = true;
    phases.set(item.key, phase);
    let seg = 1;
    for (let d = phase; d < length && dots < MAX_DOTS; d += DOT_SPACING_PX) {
      while (seg < points - 1 && along[seg]! < d) seg++;
      const span = along[seg]! - along[seg - 1]!;
      if (span < MIN_SEGMENT_PX) continue;
      const t = (d - along[seg - 1]!) / span;
      const dx = (xs[seg]! - xs[seg - 1]!) / span;
      const dy = (ys[seg]! - ys[seg - 1]!) / span;
      marks.push([xs[seg - 1]! + (xs[seg]! - xs[seg - 1]!) * t, ys[seg - 1]! + (ys[seg]! - ys[seg - 1]!) * t, sign * dx, sign * dy]);
      dots++;
    }
  }

  if (opts.motion) {
    ctx.fillStyle = opts.style.paper;
    ctx.strokeStyle = opts.style.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [x, y] of marks) {
      ctx.moveTo(x + DOT_RADIUS_PX, y);
      ctx.arc(x, y, DOT_RADIUS_PX, 0, TAU);
    }
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.strokeStyle = opts.style.ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const [x, y, dx, dy] of marks) {
      ctx.moveTo(x - (dx - dy) * ARROW_PX, y - (dy + dx) * ARROW_PX);
      ctx.lineTo(x, y);
      ctx.lineTo(x - (dx + dy) * ARROW_PX, y - (dy - dx) * ARROW_PX);
    }
    ctx.stroke();
  }
  for (const h of opts.holes ?? []) ctx.clearRect(h.x, h.y, h.w, h.h);
  return { dots, flowing };
}
