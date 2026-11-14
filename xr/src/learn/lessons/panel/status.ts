/**
 * The line along the bottom of the Steps and Checks tabs that says what is left (the first open reason, with its
 * icon, in iynk's sentence), and on the Steps tab the done band in the `good` tone once the lesson is done.
 */
import { roundRect, type DrawCtx } from '../../kit/button';
import { drawIcon } from '../../kit/icons';
import { drawText, measureText, type Box } from '../../kit/text';
import type { LessonSessionState } from '../../types';
import { OPEN_ICON, openReason } from './finish';
import { t, type PanelKey } from './strings';

const ICON_DMM = 22;
const BAND_DMM = 34;

/** The height the status line takes in px (0 when there is nothing to say), so the tab can leave room for it. */
export function statusHeight(g: CanvasRenderingContext2D, width: number, s: LessonSessionState, c: DrawCtx, band: boolean, lines = 2): number {
  const P = c.pxPerDmm;
  if (s.done) return band ? BAND_DMM * P : 0;
  const reason = openReason(s);
  if (!reason) return 0;
  const f = measureText(g, t(c.lang, `open.${reason}` as PanelKey), { x: 0, y: 0, w: width - (ICON_DMM + 10) * P, h: 56 * P }, { role: 'label', lang: c.lang, pxPerDmm: P, colour: c.k.ink, textScale: c.textScale, maxLines: lines, weight: 500 });
  return Math.max(f.height, ICON_DMM * P) + 4 * P;
}

/** Draws the line with its bottom edge at `bottom`; returns the height it took. */
export function drawStatus(g: CanvasRenderingContext2D, x: number, bottom: number, width: number, s: LessonSessionState, c: DrawCtx, band: boolean, lines = 2): number {
  const { k, pxPerDmm: P, lang } = c;
  const h = statusHeight(g, width, s, c, band, lines);
  if (h === 0) return 0;
  const box: Box = { x, y: bottom - h, w: width, h };
  if (s.done) {
    const line = 2.5 * P * k.outline;
    roundRect(g, { x: box.x + line / 2, y: box.y + line / 2, w: box.w - line, h: box.h - line }, 10 * P);
    g.fillStyle = k.good;
    g.fill();
    g.lineWidth = line;
    g.strokeStyle = k.ink;
    g.stroke();
    drawIcon(g, 'tick', box.x + 24 * P, box.y + box.h / 2, 24 * P, k, k.paper);
    drawText(g, t(lang, 'doneWord'), { x: box.x + 44 * P, y: box.y, w: box.w - 56 * P, h: box.h }, { role: 'label', lang, pxPerDmm: P, colour: k.paper, textScale: c.textScale, maxLines: 1, valign: 'middle', weight: 700 });
    return h;
  }
  const reason = openReason(s);
  if (!reason) return 0;
  drawIcon(g, OPEN_ICON[reason], box.x + (ICON_DMM * P) / 2, box.y + box.h / 2, ICON_DMM * P, k);
  const tx = box.x + (ICON_DMM + 10) * P;
  drawText(g, t(lang, `open.${reason}` as PanelKey), { x: tx, y: box.y, w: box.x + box.w - tx, h: box.h }, { role: 'label', lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: lines, valign: 'middle', weight: 500 });
  return h;
}
