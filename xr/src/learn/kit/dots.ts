/**
 * Step dots (design 7.1): a filled ink dot for a done step, an accent dot in an ink ring for the current one, an empty
 * ink ring for the rest; the viewed step is drawn larger. Shape tells them apart, not colour alone.
 *
 * Usage: const w = drawDots(g, 40, 120, states, view, 2.4, k);
 */
import type { Tokens } from './tokens';

export type DotState = 'notStarted' | 'current' | 'done' | 'blocked';

const D_DMM = 11;
const GAP_DMM = 7;

/** Width of `n` dots in px. */
export const dotsWidth = (n: number, pxPerDmm: number): number => (n * D_DMM + Math.max(0, n - 1) * GAP_DMM) * pxPerDmm;

/** Draws the dots with their left edge at x and their centre at cy; returns the width drawn. */
export function drawDots(g: CanvasRenderingContext2D, x: number, cy: number, states: readonly DotState[], view: number, pxPerDmm: number, k: Tokens): number {
  const d = D_DMM * pxPerDmm;
  const step = (D_DMM + GAP_DMM) * pxPerDmm;
  const line = 2 * pxPerDmm * k.outline;
  states.forEach((s, i) => {
    const cx = x + d / 2 + i * step;
    const r = (i === view ? d * 0.62 : d * 0.46) - line / 2;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.lineWidth = line;
    g.strokeStyle = s === 'blocked' ? k.muted : k.ink;
    if (s === 'done') {
      g.fillStyle = k.ink;
      g.fill();
    } else if (s === 'current') {
      g.fillStyle = k.accent;
      g.fill();
    }
    g.stroke();
  });
  return dotsWidth(states.length, pxPerDmm);
}
