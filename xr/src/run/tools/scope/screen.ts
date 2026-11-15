/**
 * The scope's screen panel: an inked paper panel with a dark screen (grid, the probed pin's name, the trace) and one
 * strip of inked keys under it (time per division minus and plus, volts per division minus and plus, Single). The
 * screen and the strip are one canvas each, so the panel costs five draw calls. Draws only; `index.ts` feeds it.
 */
import { Mesh } from '@iwsdk/core';
import type { XrApp } from '../../../contracts/app';
import type { Lang } from '../../../contracts/common';
import { ACCENT, CHAR, FIGURE_ACCENT, INK, MUTED, PAPER, RULE, SHADOW } from '../../../look/palette';
import { canvasFace, dmm, fitLine, MONO, roundRect, runFeedback, SANS, scriptScale, TYPE } from '../../kit';
import { cellAt, faceXY, layoutCells, type Cell } from '../grid';
import { createPanel, type Panel } from '../panel';
import {
  columnsOf,
  DIVS_X,
  DIVS_Y,
  project,
  rowOf,
  TIME_STEPS,
  timeText,
  VOLT_STEPS,
  voltsText,
  type Columns,
  type TraceBuffer,
} from './trace';
import { scopeStrings as S, type ScopeReason } from './strings';

export const PANEL_W = 0.42;
export const PANEL_H = 0.32;
const SCREEN_W = 0.38;
const SCREEN_H = 0.236;
const HEADER = 0.03;
const KEYS_W = 0.38;
const KEYS_H = 0.05;
const VIEW_M = 0.95;
const KEY_ROWS = [
  [
    ['t-', 1],
    ['t', 2.4],
    ['t+', 1],
    ['v-', 1],
    ['v', 2.4],
    ['v+', 1],
    ['single', 2.2],
  ],
] as const;

export type ScopeKey = 't-' | 't+' | 'v-' | 'v+' | 'single';

export interface ScreenModel {
  readonly lang: Lang;
  /** The probed pin or hole, or null when the probe is not clipped. */
  readonly where: string | null;
  readonly net: string | null;
  readonly reason: ScopeReason | null;
  readonly trace: TraceBuffer;
  readonly endNs: number;
  readonly timeIdx: number;
  readonly voltIdx: number;
  readonly frozen: boolean;
}

export interface ScopeScreen {
  readonly panel: Panel;
  draw(model: ScreenModel): void;
  /** Calls `fn` with each key pressed (ray, poke, pinch or trigger). */
  onKey(fn: (key: ScopeKey) => void): () => void;
  dispose(): void;
}

export function createScopeScreen(app: XrApp): ScopeScreen {
  const panel = createPanel(app, PANEL_W, PANEL_H, 'run-scope-screen');
  const screen = canvasFace(SCREEN_W, SCREEN_H, { distanceM: VIEW_M });
  screen.mesh.position.set(0, PANEL_H / 2 - 0.012 - SCREEN_H / 2, 0);
  panel.front.add(screen.mesh);
  const keys = canvasFace(KEYS_W, KEYS_H, { distanceM: VIEW_M });
  keys.mesh.position.set(0, -PANEL_H / 2 + 0.012 + KEYS_H / 2, 0);
  panel.front.add(keys.mesh);
  // The strip takes rays and pokes itself (a canvas face takes none by default).
  const hit = keys.mesh;
  hit.raycast = Mesh.prototype.raycast;

  const cells = layoutCells(KEYS_W, KEYS_H, KEY_ROWS, 0.006);
  const plotW = Math.round(SCREEN_W * screen.pxPerM);
  const columns: Columns = columnsOf(Math.max(60, Math.floor(plotW / 2)));
  let pressed: string | null = null;
  let last: ScreenModel | null = null;

  const paintKeys = (m: ScreenModel) => {
    const key = JSON.stringify([m.lang, m.timeIdx, m.voltIdx, m.frozen, pressed]);
    keys.draw(key, (g, w, h) => {
      const k = w / KEYS_W;
      const caption = dmm(TYPE.caption * 0.85, VIEW_M) * k * scriptScale(m.lang);
      const big = dmm(TYPE.body, VIEW_M) * k;
      const draw = (c: Cell, fill: string, labels: ReadonlyArray<{ text: string; size: number; mono?: boolean; y: number }>) => {
        const x = c.x * k;
        const y = c.y * k;
        const cw = c.w * k;
        const ch = c.h * k;
        const off = dmm(3, VIEW_M) * k;
        g.fillStyle = SHADOW;
        roundRect(g, x + off, y + off, cw - off, ch - off, ch * 0.2);
        g.fill();
        g.fillStyle = fill;
        roundRect(g, x, y, cw - off, ch - off, ch * 0.2);
        g.fill();
        g.lineWidth = dmm(2.2, VIEW_M) * k;
        g.strokeStyle = INK;
        roundRect(g, x + g.lineWidth / 2, y + g.lineWidth / 2, cw - off - g.lineWidth, ch - off - g.lineWidth, ch * 0.2);
        g.stroke();
        g.fillStyle = INK;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        for (const label of labels) fitLine(g, label.text, x + (cw - off) / 2, y + (ch - off) * label.y, (cw - off) * 0.9, label.size, label.mono ? MONO : SANS, 600);
      };
      for (const c of cells) {
        const on = pressed === c.id;
        if (c.id === 't-' || c.id === 'v-') draw(c, on ? ACCENT : PAPER, [{ text: '−', size: big * 1.5, y: 0.5 }]);
        else if (c.id === 't+' || c.id === 'v+') draw(c, on ? ACCENT : PAPER, [{ text: '+', size: big * 1.5, y: 0.5 }]);
        else if (c.id === 't')
          draw(c, PAPER, [
            { text: `${S.t(m.lang, 'time')}/${S.t(m.lang, 'perDiv')}`, size: caption, y: 0.27 },
            { text: timeText(TIME_STEPS[m.timeIdx]!, m.lang), size: big, mono: true, y: 0.68 },
          ]);
        else if (c.id === 'v')
          draw(c, PAPER, [
            { text: `${S.t(m.lang, 'volts')}/${S.t(m.lang, 'perDiv')}`, size: caption, y: 0.27 },
            { text: voltsText(VOLT_STEPS[m.voltIdx]!, m.lang), size: big, mono: true, y: 0.68 },
          ]);
        else draw(c, m.frozen || on ? ACCENT : PAPER, [{ text: S.t(m.lang, 'single'), size: big * 0.9, y: 0.5 }]);
      }
    });
  };

  const paintScreen = (m: ScreenModel) => {
    const empty = m.trace.length === 0;
    const key = JSON.stringify([m.lang, m.where, m.net, m.reason, m.timeIdx, m.voltIdx, m.frozen, m.trace.length, m.trace.lastNs, m.endNs, empty]);
    screen.draw(key, (g, w, h) => {
      const k = w / SCREEN_W;
      const head = HEADER * k;
      // Header on paper: the pin, its net, the hold tag.
      g.fillStyle = PAPER;
      roundRect(g, 0, 0, w, h, dmm(6, VIEW_M) * k);
      g.fill();
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = INK;
      const size = dmm(TYPE.label, VIEW_M) * k * scriptScale(m.lang);
      fitLine(g, S.t(m.lang, 'title'), w * 0.02, head * 0.5, w * 0.3, size, SANS, 600);
      if (m.where) {
        g.fillStyle = INK;
        g.textAlign = 'center';
        fitLine(g, m.net && m.net !== m.where ? `${m.where}  ${m.net}` : m.where, w * 0.5, head * 0.5, w * 0.34, size, MONO, 600);
      }
      if (m.frozen) {
        g.textAlign = 'right';
        g.fillStyle = INK;
        const tag = S.t(m.lang, 'held');
        const tw = Math.min(w * 0.2, g.measureText(tag).width + size);
        g.fillStyle = FIGURE_ACCENT;
        roundRect(g, w * 0.98 - tw, head * 0.12, tw, head * 0.76, head * 0.3);
        g.fill();
        g.fillStyle = INK;
        g.textAlign = 'center';
        fitLine(g, tag, w * 0.98 - tw / 2, head * 0.5, tw * 0.9, size * 0.9, SANS, 600);
      }
      // The screen.
      const px = 0;
      const py = head;
      const pw = w;
      const ph = h - head;
      g.fillStyle = CHAR;
      roundRect(g, px, py, pw, ph, dmm(6, VIEW_M) * k);
      g.fill();
      const gx = px + pw * 0.015;
      const gy = py + ph * 0.04;
      const gw = pw * 0.97;
      const gh = ph * 0.92;
      g.lineWidth = Math.max(1, dmm(1, VIEW_M) * k);
      g.strokeStyle = MUTED;
      g.globalAlpha = 0.45;
      g.beginPath();
      for (let i = 0; i <= DIVS_X; i++) {
        g.moveTo(gx + (gw * i) / DIVS_X, gy);
        g.lineTo(gx + (gw * i) / DIVS_X, gy + gh);
      }
      for (let j = 0; j <= DIVS_Y; j++) {
        g.moveTo(gx, gy + (gh * j) / DIVS_Y);
        g.lineTo(gx + gw, gy + (gh * j) / DIVS_Y);
      }
      g.stroke();
      // The zero line a little stronger.
      g.globalAlpha = 0.9;
      g.strokeStyle = RULE;
      const zeroY = gy + gh * rowOf(0, 1);
      g.beginPath();
      g.moveTo(gx, zeroY);
      g.lineTo(gx + gw, zeroY);
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = RULE;
      g.textAlign = 'left';
      fitLine(g, '0', gx + gw * 0.006, zeroY - ph * 0.035, gw * 0.05, size * 0.8, MONO, 500);

      if (empty) {
        g.fillStyle = RULE;
        g.textAlign = 'center';
        fitLine(g, m.reason ? S.t(m.lang, m.reason) : S.t(m.lang, 'waiting'), gx + gw / 2, gy + gh * 0.42, gw * 0.8, size * 1.1, SANS, 500);
        return;
      }
      // The trace: per column, the value at its start, its range and the value at its end, as one polyline.
      const spanNs = TIME_STEPS[m.timeIdx]! * 1e6 * DIVS_X;
      project(m.trace, m.endNs, spanNs, columns);
      const vdiv = VOLT_STEPS[m.voltIdx]!;
      const n = columns.has.length;
      const yOf = (v: number) => {
        const row = Math.max(-0.05, Math.min(1.05, rowOf(v, vdiv)));
        return gy + gh * row;
      };
      g.strokeStyle = FIGURE_ACCENT;
      g.lineWidth = dmm(3, VIEW_M) * k;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      let pen = false;
      for (let c = 0; c < n; c++) {
        if (!columns.has[c]) {
          pen = false;
          continue;
        }
        const x = gx + (gw * (c + 0.5)) / n;
        if (!pen) {
          g.moveTo(x, yOf(columns.first[c]!));
          pen = true;
        } else g.lineTo(x, yOf(columns.first[c]!));
        if (columns.hi[c]! !== columns.lo[c]!) {
          const up = columns.last[c]! >= columns.first[c]!;
          g.lineTo(x, yOf(up ? columns.lo[c]! : columns.hi[c]!));
          g.lineTo(x, yOf(up ? columns.hi[c]! : columns.lo[c]!));
        }
        g.lineTo(x, yOf(columns.last[c]!));
      }
      g.stroke();
    });
  };

  const fb = runFeedback(app);
  const listeners = new Set<(key: ScopeKey) => void>();
  const keyAt = (point: readonly number[] | undefined): Cell | null => {
    if (!point) return null;
    // The hit point is in the world; the plane's own frame turns it into the face's.
    hit.updateWorldMatrix(true, false);
    const local = hit.worldToLocal(hit.position.clone().set(point[0]!, point[1]!, point[2]!));
    const f = faceXY(local.x, local.y, KEYS_W, KEYS_H);
    return cellAt(cells, f.x, f.y);
  };
  const unbind = app.input.bind(hit, { id: 'run:scope:keys', ray: true, poke: true }, (e) => {
    if (!panel.isOpen) return;
    if (e.type === 'select-start') {
      pressed = keyAt(e.point)?.id ?? null;
      if (last) paintKeys(last);
    } else if (e.type === 'select-end') {
      pressed = null;
      if (last) paintKeys(last);
    } else if (e.type === 'select') {
      const c = keyAt(e.point);
      if (!c) return;
      fb.play('ui-press', e.point, e);
      for (const fn of listeners) fn(c.id as ScopeKey);
    }
  });

  return {
    panel,
    draw(m) {
      last = m;
      paintScreen(m);
      paintKeys(m);
    },
    onKey(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      unbind();
      screen.dispose();
      keys.dispose();
      panel.dispose();
    },
  };
}
