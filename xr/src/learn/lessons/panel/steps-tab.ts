/**
 * The Steps tab (design 7.1): the step dots and "Step 3 of 7" (or the done state), the viewed step's text at 22 dmm
 * in at most six lines, its problem under it in the `bad` tone with its icon, the notice when content fell back to
 * English, and Back, Show me and Next (Next primary). A gated step that completes shows a tick for 400 ms.
 */
import type { Lang } from '../../../contracts/common';
import { buttonWidth, drawButton, roundRect, type ButtonFace, type DrawCtx } from '../../kit/button';
import { drawDots } from '../../kit/dots';
import { lineHeight } from '../../kit/dmm';
import { drawIcon } from '../../kit/icons';
import type { Region } from '../../kit/panel';
import { drawFitted, drawText, fontOf, measureText, type Box } from '../../kit/text';
import { pick } from '../../text';
import type { LessonSessionState } from '../../types';
import { nextHint, openHints, type StepsCard } from './finish';
import { clampPage, hintPaging, pageRange } from './hint-pages';
import { drawQuizCard, type QuizActions } from './quiz-card';
import { drawStatus } from './status';
import { t } from './strings';

export interface StepsActions {
  back(): void;
  next(): void;
  showMe(): void;
}

const ROW_DMM = 28;
const HINT_ROW_DMM = 36;
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

/** What finishing a lesson adds to the tab: the card to show, the quiz and hint actions. */
export interface StepsFinish {
  readonly card: StepsCard;
  readonly quiz: QuizActions;
  hint(): void;
  /** The hint card's page (0 based) and its setter; the card clamps it. */
  readonly hintPage: number;
  setHintPage(page: number): void;
}

export function drawStepsTab(g: CanvasRenderingContext2D, area: Box, s: LessonSessionState, c: DrawCtx, a: StepsActions, tick: boolean, fin: StepsFinish): { regions: Region[]; fallback: boolean } {
  const { k, pxPerDmm: P } = c;
  const lang: Lang = c.lang;
  const regions: Region[] = [];
  let fallback = false;
  const view = Math.max(0, Math.min(s.steps.length - 1, s.viewIndex));
  const step = s.steps[view];
  const card = fin.card;

  // Dots and "Step 3 of 7", or the done state: every dot filled and saying so.
  const more = nextHint(s);
  const hasHints = s.hints.length > 0 && card.kind === 'step';
  const rowH = (hasHints ? HINT_ROW_DMM : ROW_DMM) * P;
  const rowCy = area.y + rowH / 2;
  // Hints sits at the right of the top row; each press reveals the next level.
  const hintFace: ButtonFace = { label: more === null ? t(lang, 'hints') : t(lang, 'hintReveal', { n: more }), icon: 'info', kind: 'plain', disabled: more === null };
  const hintH = 34 * P;
  const hintW = hasHints ? Math.min(area.w * 0.5, Math.max(96 * P, buttonWidth(g, hintFace, c))) : 0;
  const hintR: Box = { x: area.x + area.w - hintW, y: area.y + (rowH - hintH) / 2, w: hintW, h: hintH };
  const rightEdge = hasHints ? hintR.x - 8 * P : area.x + area.w;
  const states = s.steps.map((x) => (s.done ? 'done' : x.state));
  const dw = drawDots(g, area.x, rowCy, states, s.done ? -1 : view, P, k);
  let x = area.x + dw + 12 * P;
  // (With Hints beside it the tick is left out here: the title bar and the done band carry it, the label needs the room.)
  if (s.done && !hasHints) {
    drawIcon(g, 'pass', x + 12 * P, rowCy, 24 * P, k);
    x += 32 * P;
  }
  const label =
    card.kind === 'quiz'
      ? `${t(lang, 'quizTitle')} · ${card.index + 1}/${card.quiz.questions.length}`
      : s.done
        ? t(lang, hasHints ? 'doneWord' : 'lessonDone')
        : t(lang, 'stepOf', { n: view + 1, total: s.steps.length });
  const tickW = tick ? 200 * P : 0;
  drawText(g, label, { x, y: area.y, w: rightEdge - x - tickW, h: rowH }, { role: 'label', lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: 1, valign: 'middle', weight: 600 });
  if (tick) {
    const word = t(lang, 'stepDone');
    const style = { role: 'label' as const, lang, pxPerDmm: P, colour: k.good, textScale: c.textScale, maxLines: 1, valign: 'middle' as const, weight: 600, align: 'right' as const };
    const f = measureText(g, word, { x: 0, y: 0, w: tickW - 36 * P, h: rowH }, style);
    g.font = fontOf('label', f.size, 600);
    const wordW = Math.min(tickW - 36 * P, g.measureText(f.lines[0] ?? '').width);
    drawFitted(g, f, { x: rightEdge - tickW, y: area.y, w: tickW, h: rowH }, style);
    drawIcon(g, 'pass', rightEdge - wordW - 22 * P, rowCy, 28 * P, k);
  }
  if (hasHints) {
    drawButton(g, hintR, hintFace, c);
    regions.push({ id: 'hint', rect: hintR, face: hintFace, disabled: hintFace.disabled, onSelect: () => fin.hint() });
  }

  // A quiz question instead of the step.
  if (card.kind === 'quiz') {
    const top = area.y + rowH + 10 * P;
    regions.push(...drawQuizCard(g, { x: area.x, y: top, w: area.w, h: area.y + area.h - top }, card, c, fin.quiz));
    return { regions, fallback };
  }

  // Buttons: Back, Show me, Next.
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

  // What is left, or the done band, above the buttons.
  // While a hint is open (the hint card and the step text need the room) it is left out unless the lesson is done; two lines otherwise.
  const hintOpen = openHints(s).length > 0;
  const statusH = hintOpen && !s.done ? 0 : drawStatus(g, area.x, row.y - 6 * P, area.w, s, c, true, hintOpen ? 1 : 2);

  // The step: title, text, hint, problem and the English notice, bottom up.
  let top = area.y + rowH + 6 * P;
  let bottom = row.y - 8 * P - (statusH > 0 ? statusH + 4 * P : 0);
  const opened = openHints(s);
  const latest = opened[opened.length - 1];
  if (latest) {
    const hint = pick(latest.text, lang);
    const body = hint.text.replace(/\s+/g, ' ').trim();
    const pad = 6 * P;
    const iconW = 26 * P;
    // The step text gets what it needs but leaves the hint two lines and its page row; the hint takes the rest,
    // wrapped whole at its role's size and paged when it does not fit.
    const stepStyle = { role: 'body' as const, lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: 6 };
    const style = { role: 'label' as const, lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, weight: 500 };
    const hintText = `${latest.level}/${s.hints.length} · ${body}`;
    const hintW = area.w - 2 * pad - iconW;
    const whole = measureText(g, hintText, { x: 0, y: 0, w: hintW, h: 1e9 }, style);
    const lh = whole.size * lineHeight(lang);
    const bh = 32 * P;
    const bw = 44 * P;
    const numW = 56 * P;
    // Page controls sit at the card's right end, so a page keeps every line the card has room for.
    const ctrlW = 2 * bw + numW + 8 * P;
    const stepH = measureText(g, pick(step.text, lang).text, { x: 0, y: 0, w: area.w, h: Math.max(0, bottom - top - (2 * lh + 2 * pad) - 6 * P) }, stepStyle).height;
    const room = Math.max(0, bottom - top - stepH - 6 * P);
    const cap = Math.floor((room - 2 * pad) / lh);
    let lines = whole.lines;
    let paging = hintPaging(lines.length, cap, cap);
    let textW = hintW;
    if (paging.paged) {
      textW = hintW - ctrlW;
      lines = measureText(g, hintText, { x: 0, y: 0, w: textW, h: 1e9 }, style).lines;
      paging = hintPaging(lines.length, 0, cap);
    }
    const pageNow = clampPage(fin.hintPage, paging.pages);
    const [from, to] = pageRange(paging, pageNow, lines.length);
    const shown = lines.slice(from, to);
    const h = 2 * pad + Math.max(paging.paged ? paging.perPage * lh : shown.length * lh, paging.paged ? bh : 0);
    const plate: Box = { x: area.x, y: bottom - h, w: area.w, h };
    const line = 2 * P * k.outline;
    roundRect(g, { x: plate.x + line / 2, y: plate.y + line / 2, w: plate.w - line, h: plate.h - line }, 8 * P);
    g.fillStyle = k.rule;
    g.fill();
    g.lineWidth = line;
    g.strokeStyle = k.ink;
    g.stroke();
    drawIcon(g, 'info', plate.x + pad + 10 * P, plate.y + pad + (whole.size * 1.35) / 2, 20 * P, k, k.info);
    drawFitted(g, { lines: shown, size: whole.size, truncated: false, height: shown.length * lh }, { x: plate.x + pad + iconW, y: plate.y + pad, w: textW, h: shown.length * lh }, style);
    if (paging.paged) {
      // "1/2" with previous and next, centred in the card's right end.
      const by = plate.y + (plate.h - bh) / 2;
      const nextR: Box = { x: plate.x + plate.w - pad - bw, y: by, w: bw, h: bh };
      const prevR: Box = { x: nextR.x - numW - bw, y: by, w: bw, h: bh };
      const prevFace: ButtonFace = { label: t(lang, 'hintPrev'), icon: 'back', iconOnly: true, kind: 'plain', disabled: pageNow <= 0 };
      const nextFace: ButtonFace = { label: t(lang, 'hintNext'), icon: 'next', iconOnly: true, kind: 'plain', disabled: pageNow >= paging.pages - 1 };
      drawButton(g, prevR, prevFace, c);
      drawButton(g, nextR, nextFace, c);
      drawText(g, `${pageNow + 1}/${paging.pages}`, { x: prevR.x + bw, y: by, w: numW, h: bh }, { role: 'caption', lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: 1, valign: 'middle', align: 'center' });
      regions.push(
        { id: 'hint-prev', rect: prevR, face: prevFace, disabled: prevFace.disabled, onSelect: () => fin.setHintPage(pageNow - 1) },
        { id: 'hint-next', rect: nextR, face: nextFace, disabled: nextFace.disabled, onSelect: () => fin.setHintPage(pageNow + 1) },
      );
    }
    bottom = plate.y - 6 * P;
  }
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
