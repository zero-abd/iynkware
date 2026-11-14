/**
 * The quiz card of the Steps tab (design 7.1): "Quick check", the question, its options as buttons (label size, two
 * lines when needed), then Correct or Not quite with iynk's `why` text and Next question or Back to the steps.
 */
import { buttonWidth, drawButton, roundRect, type ButtonFace, type DrawCtx } from '../../kit/button';
import { lineHeight, roleSize } from '../../kit/dmm';
import { drawIcon } from '../../kit/icons';
import type { Region } from '../../kit/panel';
import { drawText, measureText, type Box } from '../../kit/text';
import { pick } from '../../text';
import { nextQuestion, type StepsCard } from './finish';
import { t } from './strings';

type QuizCard = Extract<StepsCard, { kind: 'quiz' }>;

export interface QuizActions {
  answer(card: QuizCard, choice: number): void;
  /** Next question, or back to the steps after the last one. */
  advance(card: QuizCard): void;
}

const BUTTON_DMM = 44;
const OPTION_PAD_DMM = 14;
const GAP_DMM = 8;

/** True when the card goes on to another question rather than back to the steps. */
export const hasNext = (card: QuizCard): boolean => nextQuestion(card.quiz) !== null;

/** Draws the card in `area` (the Steps tab body under the top row); returns its regions and the title line for the top row. */
export function drawQuizCard(g: CanvasRenderingContext2D, area: Box, card: QuizCard, c: DrawCtx, a: QuizActions): Region[] {
  const { k, pxPerDmm: P, lang } = c;
  const regions: Region[] = [];
  const q = card.question;
  const question = pick(q.q, lang);

  if (!card.answered) {
    // Options from the bottom up, each as tall as its (at most two) lines need; the question takes what is left above.
    const lh = roleSize('label', lang, c.textScale) * P * lineHeight(lang);
    const textW = area.w - 2 * OPTION_PAD_DMM * P;
    const styleOf = (colour: string) => ({ role: 'label' as const, lang, pxPerDmm: P, colour, textScale: c.textScale, maxLines: 2, weight: 600, valign: 'middle' as const });
    const opts = q.options.map((o) => pick(o, lang));
    const heights = opts.map((o) => {
      const f = measureText(g, o.text, { x: 0, y: 0, w: textW, h: 2 * lh }, styleOf(k.ink));
      return Math.max(BUTTON_DMM * P, f.lines.length * lh + 16 * P);
    });
    const total = heights.reduce((s, h) => s + h, 0) + (opts.length - 1) * GAP_DMM * P;
    let y = area.y + area.h - total;
    opts.forEach((o, i) => {
      const r: Box = { x: area.x, y, w: area.w, h: heights[i]! };
      const face: ButtonFace = { label: '', kind: 'plain' };
      drawButton(g, r, face, c);
      drawText(g, o.text, { x: r.x + OPTION_PAD_DMM * P, y: r.y, w: textW, h: r.h }, styleOf(k.ink));
      // No `face` on the region: the lift plate would redraw the label on one line, and an option is wider than a plate.
      regions.push({ id: `quiz:option:${i}`, rect: r, onSelect: () => a.answer(card, i) });
      y += r.h + GAP_DMM * P;
    });
    drawText(g, question.text, { x: area.x, y: area.y, w: area.w, h: Math.max(0, area.y + area.h - total - 10 * P - area.y) }, { role: 'body', lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: 4, weight: 600 });
    return regions;
  }

  // Answered: the question small, then one row with the verdict and the way on, then why (the room that is left).
  const right = q.chosen === q.answer;
  let y = area.y;
  const qf = drawText(g, question.text, { x: area.x, y, w: area.w, h: 52 * P }, { role: 'label', lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: 2, weight: 500 });
  y += qf.height + 6 * P;
  const row: Box = { x: area.x, y, w: area.w, h: BUTTON_DMM * P };
  const face: ButtonFace = { label: t(lang, hasNext(card) ? 'quizNext' : 'backToSteps'), icon: 'next', iconAfter: true, kind: 'primary' };
  const bw = Math.min(row.w * 0.58, Math.max(96 * P, buttonWidth(g, face, c)));
  const r: Box = { x: row.x + row.w - bw, y: row.y, w: bw, h: row.h };
  drawButton(g, r, face, c);
  regions.push({ id: 'quiz:next', rect: r, face, onSelect: () => a.advance(card) });
  // The verdict on a plate: tone, icon and word, never colour alone.
  const plate: Box = { x: row.x, y: row.y, w: row.w - bw - 8 * P, h: row.h };
  const line = 2.5 * P * k.outline;
  roundRect(g, { x: plate.x + line / 2, y: plate.y + line / 2, w: plate.w - line, h: plate.h - line }, 10 * P);
  g.fillStyle = right ? k.good : k.bad;
  g.fill();
  g.lineWidth = line;
  g.strokeStyle = k.ink;
  g.stroke();
  drawIcon(g, right ? 'tick' : 'fail', plate.x + 22 * P, plate.y + plate.h / 2, 24 * P, k, k.paper);
  drawText(g, t(lang, right ? 'quizCorrect' : 'quizWrong'), { x: plate.x + 40 * P, y: plate.y, w: plate.w - 48 * P, h: plate.h }, { role: 'label', lang, pxPerDmm: P, colour: k.paper, textScale: c.textScale, maxLines: 1, valign: 'middle', weight: 700 });
  y += row.h + 8 * P;
  drawText(g, pick(q.why, lang).text, { x: area.x, y, w: area.w, h: Math.max(0, area.y + area.h - y) }, { role: 'label', lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: 6, weight: 500 });
  return regions;
}
