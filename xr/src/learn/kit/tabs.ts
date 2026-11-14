/**
 * A row of tabs, each a button face of kind `tab` (icon and word); the open one has an ink outline and an accent bar.
 * Tabs share the row's width when they would overflow it, never wrap.
 *
 * Usage: const rects = drawTabs(g, row, [{ id: 'steps', label: 'Steps', icon: 'steps' }], 'steps', ctx);
 */
import { buttonWidth, drawButton, type DrawCtx } from './button';
import type { IconName } from './icons';
import type { Box } from './text';

export interface TabFace {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
}

const GAP_DMM = 8;

/** Rects of the tabs in `row`, left aligned, each as wide as its face needs or an equal share when they overflow. */
export function tabRects(g: CanvasRenderingContext2D, row: Box, tabs: readonly TabFace[], c: DrawCtx): Box[] {
  const gap = GAP_DMM * c.pxPerDmm;
  const want = tabs.map((t) => buttonWidth(g, t, c));
  const total = want.reduce((a, b) => a + b, 0) + gap * Math.max(0, tabs.length - 1);
  const share = (row.w - gap * Math.max(0, tabs.length - 1)) / Math.max(1, tabs.length);
  let x = row.x;
  return want.map((w) => {
    const width = total > row.w ? share : w;
    const r = { x, y: row.y, w: width, h: row.h };
    x += width + gap;
    return r;
  });
}

export function drawTabs(g: CanvasRenderingContext2D, row: Box, tabs: readonly TabFace[], open: string, c: DrawCtx): Box[] {
  const rects = tabRects(g, row, tabs, c);
  tabs.forEach((t, i) => drawButton(g, rects[i]!, { label: t.label, icon: t.icon, kind: 'tab', active: t.id === open }, c));
  return rects;
}
