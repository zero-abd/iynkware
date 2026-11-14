/**
 * The Checks tab (design 7.3): one row per visible check with its state as icon, word and colour (not run: empty
 * circle; running: ring of dots; passed: tick in a `good` circle; failed: cross in a `bad` circle), its label, "Text
 * check" for a `code` check, and on a failed row the reason iynk gives. A summary and Run checks along the bottom.
 */
import type { Lang } from '../../../contracts/common';
import { drawButton, type ButtonFace, type DrawCtx } from '../../kit/button';
import { MIN_DMM, lineHeight, roleSize } from '../../kit/dmm';
import { ellipsize, wrap } from '../../kit/fit';
import { drawIcon, type IconName } from '../../kit/icons';
import type { Region } from '../../kit/panel';
import { drawText, fontOf, type Box } from '../../kit/text';
import { pick } from '../../text';
import type { LessonSessionState, SessionCheck } from '../../types';
import { drawStatus } from './status';
import { buttonRow } from './steps-tab';
import { t, type PanelKey } from './strings';

const BUTTON_DMM = 44;
const ICON_DMM = 26;
const TEXT_X_DMM = 38;
const ROW_GAP_DMM = 10;

const ICON: Record<SessionCheck['state'], IconName> = { notRun: 'idle', running: 'running', pass: 'pass', fail: 'fail' };
const WORD: Record<SessionCheck['state'], PanelKey> = { notRun: 'notRun', running: 'running', pass: 'passed', fail: 'failed' };

/** The reason iynk gives, in the person's words when it is one of the known codes. */
export function reasonText(detail: string | undefined, lang: Lang): string {
  if (!detail) return '';
  const key = `reason.${detail}` as PanelKey;
  const s = t(lang, key);
  return s === key ? detail : s;
}

interface RowLayout {
  readonly check: SessionCheck;
  readonly word: string;
  readonly wordW: number;
  readonly lines: string[];
  readonly detail: string;
  readonly height: number;
}

export function drawChecksTab(
  g: CanvasRenderingContext2D,
  area: Box,
  s: LessonSessionState,
  c: DrawCtx,
  a: { run(): void },
  animate: boolean,
): { regions: Region[]; spinners: Array<{ x: number; y: number; d: number }>; fallback: boolean } {
  const { k, pxPerDmm: P, lang } = c;
  const rows = s.checks.rows.filter((r) => !r.hidden);
  const hidden = s.checks.rows.length - rows.length;
  const spinners: Array<{ x: number; y: number; d: number }> = [];
  let fallback = false;

  // Bottom row: the summary and Run checks.
  const row: Box = { x: area.x, y: area.y + area.h - BUTTON_DMM * P, w: area.w, h: BUTTON_DMM * P };
  const running = s.checks.status === 'running';
  const ran = s.checks.status === 'done' || s.checks.status === 'limit';
  const runFace: ButtonFace = { label: t(lang, ran ? 'checkAgain' : 'runChecks'), icon: 'play', kind: 'primary', disabled: running || rows.length === 0 };
  const [runR] = buttonRow(g, row, [], [runFace], c);
  drawButton(g, runR!, runFace, c);
  const passed = rows.filter((r) => r.state === 'pass').length;
  let summary = t(lang, 'notRun');
  if (rows.length === 0) summary = t(lang, 'noChecks');
  else if (running) summary = t(lang, 'running');
  else if (s.checks.status === 'limit') summary = t(lang, 'limit');
  else if (ran) summary = passed === rows.length ? t(lang, 'allPass') : t(lang, 'summary', { passed, total: rows.length });
  drawText(g, summary, { x: area.x, y: row.y, w: runR!.x - area.x - 12 * P, h: row.h }, { role: 'label', lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: 2, valign: 'middle', weight: 600 });
  const regions: Region[] = [{ id: 'run', rect: runR!, face: runFace, disabled: runFace.disabled, onSelect: () => a.run() }];

  let bottom = row.y - 12 * P;
  const statusH = drawStatus(g, area.x, bottom, area.w, s, c, false);
  if (statusH > 0) bottom -= statusH + 8 * P;
  if (hidden > 0) {
    const h = 26 * P;
    drawText(g, t(lang, 'hiddenNote', { n: hidden }), { x: area.x, y: bottom - h, w: area.w, h }, { role: 'caption', lang, pxPerDmm: P, colour: k.ink, textScale: c.textScale, maxLines: 1, valign: 'middle' });
    bottom -= h + 6 * P;
  }

  // Rows: the state word starts the first line, the label follows it and wraps. Fit (design 9.5): wrap at the label
  // size with up to three lines a row, then shrink to 18 dmm, then take a line off the longest row with an ellipsis
  // until every row fits, so short rows keep their whole label.
  const textX = area.x + TEXT_X_DMM * P;
  const textW = area.x + area.w - textX;
  const room = bottom - area.y;
  const layout = (sizeDmm: number, trim: boolean): { rows: RowLayout[]; total: number; size: number; lh: number } => {
    const size = sizeDmm * P;
    const lh = size * lineHeight(lang);
    const cap = Math.max(MIN_DMM * P, roleSize('caption', lang, c.textScale) * P);
    const measure = (text: string, px: number, weight = 500) => {
      g.font = fontOf('label', px, weight);
      return g.measureText(text).width;
    };
    const full = rows.map((check) => {
      const tag = check.textCheck ? ` · ${t(lang, 'textCheck')}` : '';
      const word = t(lang, WORD[check.state]) + tag;
      const wordW = measure(word, size, 600) + 10 * P;
      const label = pick(check.label, lang);
      if (label.fallback) fallback = true;
      const lines = wrap(label.text, (i) => (i === 0 ? textW - wordW : textW), size, measure);
      const detail = check.state === 'fail' ? reasonText(check.detail, lang) : '';
      return { check, word, wordW, lines, detail };
    });
    const allow = full.map((r) => Math.min(r.lines.length, 3));
    const heightOf = (i: number) => Math.max(ICON_DMM * P, allow[i]! * lh) + (full[i]!.detail ? cap * 1.35 : 0);
    const totalOf = () => full.reduce((sum, _r, i) => sum + heightOf(i), 0) + Math.max(0, full.length - 1) * ROW_GAP_DMM * P;
    while (trim && totalOf() > room) {
      let longest = -1;
      allow.forEach((n, i) => {
        if (n > 1 && (longest < 0 || n > allow[longest]!)) longest = i;
      });
      if (longest < 0) break;
      allow[longest]!--;
    }
    const out = full.map((r, i): RowLayout => {
      const n = allow[i]!;
      let lines = r.lines.slice(0, n);
      if (r.lines.length > n) {
        const restWidth = n === 1 ? textW - r.wordW : textW;
        lines = [...r.lines.slice(0, n - 1), ellipsize(r.lines.slice(n - 1).filter(Boolean).join(' '), restWidth, size, measure)];
      }
      return { check: r.check, word: r.word, wordW: r.wordW, lines, detail: r.detail, height: heightOf(i) };
    });
    return { rows: out, total: totalOf(), size, lh };
  };
  const label = roleSize('label', lang, c.textScale);
  const small = Math.max(MIN_DMM, label * 0.9);
  let fit = layout(label, false);
  if (fit.total > room) fit = layout(small, false);
  if (fit.total > room) fit = layout(small, true);
  let y = area.y;
  for (const r of fit.rows) {
    if (y + r.height > bottom + 1) break;
    const cy = y + fit.lh / 2;
    const d = ICON_DMM * P;
    if (r.check.state === 'running' && animate) spinners.push({ x: area.x + d / 2, y: cy, d });
    else drawIcon(g, ICON[r.check.state], area.x + d / 2, cy, d, k);
    const colour = r.check.state === 'pass' ? k.good : r.check.state === 'fail' ? k.bad : k.ink;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = fontOf('label', fit.size, 600);
    g.fillStyle = colour;
    g.fillText(r.word, textX, cy);
    g.font = fontOf('label', fit.size, 500);
    g.fillStyle = k.ink;
    r.lines.forEach((line, i) => g.fillText(line, i === 0 ? textX + r.wordW : textX, cy + i * fit.lh));
    if (r.detail) {
      const capTop = y + r.lines.length * fit.lh;
      drawText(g, r.detail, { x: textX, y: capTop, w: textW, h: r.height - r.lines.length * fit.lh }, { role: 'caption', lang, pxPerDmm: P, colour: k.bad, textScale: c.textScale, maxLines: 1, valign: 'middle' });
    }
    y += r.height + ROW_GAP_DMM * P;
  }
  return { regions, spinners, fallback };
}
