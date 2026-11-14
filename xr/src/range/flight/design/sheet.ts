/**
 * The panel's printed face: one canvas (one draw call) with the title, the pick kickers, the numbers, the design
 * checks with their level tags and the arming checklist with an icon and a word per rule. Drawn with the look kit's
 * painters and state colours; the option plates and the Fly plate stand on top of it.
 */
import { fitLines, paintIcon, paintKicker, paintPill, paintText } from '../../../look/paint';
import { INK, MUTED, PAPER, RULE, STATE } from '../../../look/palette';
import { TYPE, type TypeRole } from '../../../look/type';
import { PANEL, ROWS } from './layout';
import type { CheckLevelName, CheckRow, LineRow, RuleRow, RuleState } from './rows';

export interface SheetModel {
  readonly title: string;
  /** Kicker words for the three pick rows. */
  readonly kickers: readonly string[];
  readonly lines: readonly LineRow[];
  readonly checks: readonly CheckRow[];
  /** Said when no check fires. */
  readonly allGood: string;
  readonly rulesTitle: string;
  readonly rules: readonly RuleRow[];
}

export const LEVEL_FILL: Record<CheckLevelName, string> = { danger: STATE.bad, warn: STATE.warn, info: STATE.info };
export const RULE_INK: Record<RuleState, string> = { ok: STATE.good, blocked: STATE.bad, warn: STATE.warn };

type G = CanvasRenderingContext2D;

/** One line in a role, fitted to `maxW` (wrap is off: shrink at most 15 percent, then an ellipsis). */
function line(g: G, text: string, x: number, y: number, role: TypeRole, px: number, maxW: number, colour: string, align: CanvasTextAlign = 'left') {
  const fit = fitLines(g, text, { role, size: px, minSize: px * 0.85, maxWidth: maxW, maxLines: 1 });
  g.fillStyle = colour;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(fit.lines[0] ?? '', x, y);
}

/** Paints the whole sheet. `w` and `h` are the canvas pixels; the panel is `PANEL.w` by `PANEL.h` metres. */
export function drawSheet(g: G, w: number, h: number, m: SheetModel): void {
  const px = w / PANEL.w;
  const mm = (v: number) => v * px;
  const left = mm(PANEL.margin);
  const right = w - mm(PANEL.margin);
  const unit = 2; // px per dmm at the sheet's viewing distance
  g.clearRect(0, 0, w, h);

  paintText(g, m.title, left, mm(ROWS.title), TYPE.title, TYPE.title.size * unit, INK);
  m.kickers.forEach((k, i) => paintKicker(g, k, left, mm(ROWS.picks[i]!), TYPE.caption.size * unit * 0.9, MUTED));

  // the numbers: two columns of label and value
  const col = (right - left) / 2;
  m.lines.forEach((r, i) => {
    const x = left + (i % 2) * (col + mm(0.006));
    const y = mm(ROWS.numbers + Math.floor(i / 2) * ROWS.numberPitch);
    const cw = col - mm(0.012);
    line(g, r.label, x, y, TYPE.caption, TYPE.caption.size * unit, cw * 0.58, MUTED);
    line(g, r.value, x + cw, y, TYPE.label, TYPE.label.size * unit, cw * 0.46, INK, 'right');
  });

  g.fillStyle = RULE;
  g.fillRect(left, mm(ROWS.rule1), right - left, Math.max(2, mm(0.0012)));

  // the design checks
  if (m.checks.length === 0) {
    paintIcon(g, 'checkCircle', left, mm(ROWS.checks) + mm(0.002), mm(0.014), STATE.good);
    line(g, m.allGood, left + mm(0.02), mm(ROWS.checks + 0.009), TYPE.caption, TYPE.caption.size * unit, right - left - mm(0.02), INK);
  }
  m.checks.forEach((c, i) => {
    const top = mm(ROWS.checks + i * ROWS.checkBlock);
    const chipW = mm(0.062);
    const chipH = mm(0.0155);
    paintPill(g, left, top + mm(0.001), chipW, chipH, { fill: LEVEL_FILL[c.level], border: 0, radius: chipH });
    line(g, c.tag, left + chipW / 2, top + mm(0.001) + chipH / 2, TYPE.caption, TYPE.caption.size * unit * 0.9, chipW * 0.86, PAPER, 'center');
    const tx = left + chipW + mm(0.008);
    const size = TYPE.caption.size * unit;
    const fit = fitLines(g, c.text, { role: TYPE.caption, size, minSize: size * 0.85, maxWidth: right - tx, maxLines: 2 });
    g.fillStyle = INK;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    fit.lines.forEach((t, j) => g.fillText(t, tx, top + mm(0.0075) + j * fit.lineHeight * 0.92));
  });

  g.fillStyle = RULE;
  g.fillRect(left, mm(ROWS.rule2), right - left, Math.max(2, mm(0.0012)));

  // the arming checklist: icon, rule, state word
  paintKicker(g, m.rulesTitle, left, mm(ROWS.rulesTitle), TYPE.caption.size * unit * 0.9, MUTED);
  const wordW = mm(0.095);
  m.rules.forEach((r, i) => {
    const y = mm(ROWS.rules + i * ROWS.rulePitch);
    const ink = RULE_INK[r.state];
    paintIcon(g, r.icon, left, y - mm(0.005), mm(0.0105), ink);
    line(g, r.text, left + mm(0.015), y, TYPE.caption, TYPE.caption.size * unit, right - left - mm(0.015) - wordW - mm(0.004), INK);
    line(g, r.word, right, y, { ...TYPE.caption, weight: 700 }, TYPE.caption.size * unit * 0.9, wordW, ink, 'right');
  });
}
