/**
 * The Steps tab (design 7.1): the step dots and "Step 3 of 7" (or the done state), the viewed step's text at 22 dmm
 * in at most six lines, its problem under it in the `bad` tone with its icon, the notice when content fell back to
 * English, and Back, Show me and Next (Next primary). A gated step that completes shows a tick for 400 ms.
 */
import type { Lang } from '../../../contracts/common';
import { buttonWidth, drawButton, type ButtonFace, type DrawCtx } from '../../kit/button';
import { drawDots } from '../../kit/dots';
import { drawIcon } from '../../kit/icons';
import type { Region } from '../../kit/panel';
import { drawFitted, drawText, fontOf, measureText, type Box } from '../../kit/text';
import { pick } from '../../text';
import type { LessonSessionState } from '../../types';
import { t } from './strings';

export interface StepsActions {
  back(): void;
  next(): void;
  showMe(): void;
}

const ROW_DMM = 28;
const BUTTON_DMM = 44;
const MIN_BUTTON_DMM = 96;

/** Lays out a row of buttons: `left` from the left edge, `right` from the right edge; shrinks them all to fit. */
export function buttonRow(g: CanvasRenderingContext2D, row: Box, left: readonly ButtonFace[], right: readonly ButtonFace[], c: DrawCtx): Box[] {
  const P = c.pxPerDmm;
  const gap = 10 * P;
  const all = [...left, ...right];
  const want = all.map((f) => Math.max(MIN_BUTTON_DMM * P, buttonWidth(g, f, c)));
  const total = want.reduce((a, b) => a + b, 0) + gap * (all.length - 1) + (left.length && right.length ? gap : 0);
  const k = total > row.w ? (row.w - gap * all.length) / want.reduce((a, b) => a + b, 0) : 1;
  const widths = want.map((w) => w * k);
  const rects: Box[] = [];
  let x = row.x;
  left.forEach((_f, i) => {
    rects.push({ x, y: row.y, w: widths[i]!, h: row.h });
    x += widths[i]! + gap;
  });
  let xr = row.x + row.w;
  const rightRects: Box[] = [];
  for (let i = right.length - 1; i >= 0; i--) {
    const w = widths[left.length + i]!;
    xr -= w;
    rightRects.unshift({ x: xr, y: row.y, w, h: row.h });
    xr -= gap;
  }
  return [...rects, ...rightRects];
}

export function drawStepsTab(g: CanvasRenderingContext2D, area: Box, s: LessonSessionState, c: DrawCtx, a: StepsActions, tick: boolean): { regions: Region[]; fallback: boolean } {
  const { k, pxPerDmm: P } = c;
  const lang: Lang = c.lang;
  const regions: Region[] = [];
  let fallback = false;
  const view = Math.max(0, Math.min(s.steps.length - 1, s.viewIndex));
  const step = s.steps[view];

  // Dots and "Step 3 of 7", or the done state: every dot filled and saying so.
  const rowCy = area.y + (ROW_DMM * P) / 2;
  const states = s.steps.map((x) => (s.done ? 'done' : x.state));
  const dw = drawDots(g, area.x, rowCy, states, s.done ? -1 : view, P, k);
  let x = area.x + dw + 12 * P;
  if (s.done) {
    drawIcon(g, 'pass', x + 12 * P, rowCy, 24 * P, k);
    x += 32 * P;
  }
  const label = s.done ? t(lang, 'lessonDone') : t(lang, 'stepOf', { n: view + 1, total: s.steps.length });
  const tickW = tick ? 200 * P : 0;
  drawText(g, label, { x, y: area.y, w: area.x + area.w - x - tickW, h: ROW_DMM * P }, { role: 'label', lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: 1, valign: 'middle', weight: 600 });
  if (tick) {
    const word = t(lang, 'stepDone');
    const style = { role: 'label' as const, lang, pxPerDmm: P, colour: k.good, textScale: c.textScale, maxLines: 1, valign: 'middle' as const, weight: 600, align: 'right' as const };
    const f = measureText(g, word, { x: 0, y: 0, w: tickW - 36 * P, h: ROW_DMM * P }, style);
    g.font = fontOf('label', f.size, 600);
    const wordW = Math.min(tickW - 36 * P, g.measureText(f.lines[0] ?? '').width);
    drawFitted(g, f, { x: area.x + area.w - tickW, y: area.y, w: tickW, h: ROW_DMM * P }, style);
    drawIcon(g, 'pass', area.x + area.w - wordW - 22 * P, rowCy, 28 * P, k);
  }

  // Buttons.
  const row: Box = { x: area.x, y: area.y + area.h - BUTTON_DMM * P, w: area.w, h: BUTTON_DMM * P };
  const last = s.steps.length - 1;
  const backFace: ButtonFace = { label: t(lang, 'back'), icon: 'back', kind: 'plain', disabled: view <= 0 };
  const showFace: ButtonFace = { label: t(lang, 'showMe'), icon: 'eye', kind: 'plain', disabled: !step || step.targets.length === 0 };
  const nextFace: ButtonFace = { label: t(lang, 'next'), icon: 'next', iconAfter: true, kind: 'primary', disabled: !step || (view >= last && (s.done || step.state === 'done')) };
  const [backR, showR, nextR] = buttonRow(g, row, [backFace], [showFace, nextFace], c);
  drawButton(g, backR!, backFace, c);
  drawButton(g, showR!, showFace, c);
  drawButton(g, nextR!, nextFace, c);
  regions.push(
    { id: 'back', rect: backR!, face: backFace, disabled: backFace.disabled, onSelect: () => a.back() },
    { id: 'showme', rect: showR!, face: showFace, disabled: showFace.disabled, onSelect: () => a.showMe() },
    { id: 'next', rect: nextR!, face: nextFace, disabled: nextFace.disabled, onSelect: () => a.next() },
  );
  if (!step) return { regions, fallback };

  // The step: title, text, problem and the English notice, bottom up.
  let top = area.y + (ROW_DMM + 10) * P;
  let bottom = row.y - 10 * P;
  const text = pick(step.text, lang);
  const title = step.title ? pick(step.title, lang) : null;
  const problem = step.problem ? pick(step.problem, lang) : null;
  fallback = text.fallback || (title?.fallback ?? false) || (problem?.fallback ?? false);
  if (fallback) {
    const h = 26 * P;
    drawIcon(g, 'info', area.x + 11 * P, bottom - h / 2, 20 * P, k, k.info);
    drawText(g, t(lang, 'shownInEnglish'), { x: area.x + 28 * P, y: bottom - h, w: area.w - 28 * P, h }, { role: 'caption', lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: 1, valign: 'middle' });
    bottom -= h + 4 * P;
  }
  if (problem && problem.text) {
    const style = { role: 'label' as const, lang, pxPerDmm: P, colour: k.bad, textScale: c.textScale, maxLines: 2, weight: 500 };
    const box = { x: area.x + 34 * P, y: 0, w: area.w - 34 * P, h: Math.min(70 * P, (bottom - top) / 2) };
    const f = measureText(g, problem.text, box, style);
    box.y = bottom - f.height;
    drawIcon(g, 'fail', area.x + 13 * P, box.y + (f.size * 1.35) / 2, 24 * P, k);
    drawFitted(g, f, box, style);
    bottom = box.y - 8 * P;
  }
  if (title && title.text) {
    const f = drawText(g, title.text, { x: area.x, y: top, w: area.w, h: 34 * P }, { role: 'label', lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: 1, weight: 600 });
    top += f.height + 4 * P;
  }
  drawText(g, text.text, { x: area.x, y: top, w: area.w, h: Math.max(0, bottom - top) }, { role: 'body', lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: 6 });
  return { regions, fallback };
}
