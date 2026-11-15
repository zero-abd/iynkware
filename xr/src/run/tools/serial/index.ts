/**
 * The serial panel: an inked paper panel beside the code panel that shows what the board prints (mono, 14 lines,
 * following the newest until you scroll) and sends short text back through a compact keypad of inked keys. A Serial
 * plate on the rack's deck slot opens and closes it; it also opens by itself on the first output of a run. Text comes
 * from `frame.serial`; typed text goes out with `app.sim.input({ kind: 'serial', text })`. Two canvases and one slab,
 * so the open panel costs five draw calls.
 */
import { Mesh } from '@iwsdk/core';
import type { XrApp } from '../../../contracts/app';
import type { Unsubscribe } from '../../../contracts/common';
import { ACCENT, INK, MUTED, PAPER, RULE, SHADOW } from '../../../look/palette';
import { bindPlate, canvasFace, dmm, fitLine, MONO, onTick, plateButton, roundRect, runFeedback, SANS, scriptScale, TYPE } from '../../kit';
import { cellAt, faceXY, layoutCells, type Cell } from '../grid';
import { createPanel } from '../panel';
import { followLayout } from '../rack';
import { applyKey, COLUMNS, createLineBuffer, KEYS, visible, VISIBLE_LINES, type Key } from './lines';
import { serialStrings as S } from './strings';

const PANEL_W = 0.52;
const TEXT_W = 0.5;
const HEADER = 0.03;
const LINE_H = 0.0282;
const INPUT_H = 0.036;
const TEXT_H = HEADER + VISIBLE_LINES * LINE_H + INPUT_H;
const PAD_W = 0.5;
const PAD_H = 0.183;
const PANEL_H = 0.012 + TEXT_H + 0.008 + PAD_H + 0.012;
const VIEW_M = 1.0;
const DRAW_EVERY_MS = 100;
/** How many rows one tap of the arrows moves. */
const SCROLL = 4;

type PadKey = Key | 'up' | 'down' | 'newest' | 'clear';

const PAD_ROWS = [
  [['up', 1], ['down', 1], ['newest', 1.5], ['clear', 1.5]],
  [['1', 1], ['2', 1], ['3', 1], ['4', 1], ['5', 1]],
  [['6', 1], ['7', 1], ['8', 1], ['9', 1], ['0', 1]],
  [[' ', 1.2], ['-', 1], ['.', 1], ['back', 1.2], ['send', 1.6]],
] as const;

export function mountSerial(app: XrApp): Unsubscribe {
  const fb = runFeedback(app);
  const lang = () => app.settings.lang.value;
  const lines = createLineBuffer(COLUMNS);
  let draft = '';
  let back = 0;
  let pressed: string | null = null;
  let drawn = '';
  let lastDraw = -Infinity;
  let dirty = true;
  let nowNs = 0;
  let autoOpened = false;
  let seenNetlist: object | null = null;

  const panel = createPanel(app, PANEL_W, PANEL_H, 'run-serial-panel');
  app.bench.table.add(panel.group);
  const text = canvasFace(TEXT_W, TEXT_H, { distanceM: VIEW_M });
  text.mesh.position.set(0, PANEL_H / 2 - 0.012 - TEXT_H / 2, 0);
  panel.front.add(text.mesh);
  const pad = canvasFace(PAD_W, PAD_H, { distanceM: VIEW_M });
  pad.mesh.position.set(0, -PANEL_H / 2 + 0.012 + PAD_H / 2, 0);
  panel.front.add(pad.mesh);
  // The keypad takes rays and pokes itself (a canvas face takes none by default).
  const hit = pad.mesh;
  hit.raycast = Mesh.prototype.raycast;
  const cells = layoutCells(PAD_W, PAD_H, PAD_ROWS, 0.005);

  // The plate on the rack's deck slot.
  const deck = plateButton(app, { w: 0.05, d: 0.044, h: 0.008 }, { icon: 'serial', label: S.t(lang(), 'plate'), lang: lang() });
  deck.hit.name = 'run:serial:plate';
  app.bench.table.add(deck.group);

  const paintText = (t: number) => {
    const l = lang();
    const view = visible(lines.lines(), VISIBLE_LINES, back);
    back = view.back;
    const key = JSON.stringify([l, lines.version, back, draft, panel.isOpen]);
    if (key === drawn) return;
    drawn = key;
    lastDraw = t;
    text.draw(key, (g, w, h) => {
      const k = w / TEXT_W;
      g.fillStyle = PAPER;
      roundRect(g, 0, 0, w, h, dmm(6, VIEW_M) * k);
      g.fill();
      const size = dmm(TYPE.code, VIEW_M) * k;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = INK;
      fitLine(g, S.t(l, 'title'), w * 0.02, HEADER * k * 0.5, w * 0.6, size * scriptScale(l), SANS, 600);
      g.strokeStyle = RULE;
      g.lineWidth = dmm(1.5, VIEW_M) * k;
      g.beginPath();
      g.moveTo(w * 0.01, HEADER * k);
      g.lineTo(w * 0.99, HEADER * k);
      g.stroke();
      if (view.rows.length === 0) {
        g.fillStyle = MUTED;
        fitLine(g, S.t(l, 'empty'), w * 0.02, (HEADER + LINE_H * 0.5) * k, w * 0.9, size * scriptScale(l), SANS, 500);
      }
      g.fillStyle = INK;
      view.rows.forEach((row, i) => {
        // The newest rows sit at the bottom of the page.
        const slot = VISIBLE_LINES - view.rows.length + i;
        fitLine(g, row, w * 0.02, (HEADER + LINE_H * (slot + 0.5)) * k, w * 0.96, size, MONO, 500);
      });
      if (back > 0) {
        g.textAlign = 'right';
        g.fillStyle = MUTED;
        fitLine(g, S.t(l, 'older', { n: back }), w * 0.98, HEADER * k * 0.5, w * 0.34, size * 0.8 * scriptScale(l), SANS, 500);
      }
      // The line being typed.
      const y = (HEADER + VISIBLE_LINES * LINE_H) * k;
      g.strokeStyle = INK;
      g.beginPath();
      g.moveTo(w * 0.01, y);
      g.lineTo(w * 0.99, y);
      g.stroke();
      g.textAlign = 'left';
      g.fillStyle = INK;
      fitLine(g, `> ${draft}`, w * 0.02, y + INPUT_H * k * 0.5, w * 0.96, size, MONO, 600);
    });
  };

  const labelOf = (id: string): string => {
    const l = lang();
    switch (id) {
      case 'up':
        return '▲';
      case 'down':
        return '▼';
      case 'newest':
        return S.t(l, 'newest');
      case 'clear':
        return S.t(l, 'clear');
      case 'send':
        return S.t(l, 'send');
      case 'back':
        return '⌫';
      case ' ':
        return '␣';
      default:
        return id;
    }
  };

  const paintPad = () => {
    const l = lang();
    const key = JSON.stringify([l, pressed]);
    pad.draw(key, (g, w) => {
      const k = w / PAD_W;
      const size = dmm(TYPE.body, VIEW_M) * k;
      const off = dmm(3, VIEW_M) * k;
      for (const c of cells) {
        const x = c.x * k;
        const y = c.y * k;
        const cw = c.w * k;
        const ch = c.h * k;
        const on = pressed === c.id;
        g.fillStyle = SHADOW;
        roundRect(g, x + off, y + off, cw - off, ch - off, ch * 0.2);
        g.fill();
        g.fillStyle = on ? ACCENT : c.id === 'send' ? ACCENT : PAPER;
        roundRect(g, x, y, cw - off, ch - off, ch * 0.2);
        g.fill();
        g.lineWidth = dmm(2.2, VIEW_M) * k;
        g.strokeStyle = INK;
        roundRect(g, x + g.lineWidth / 2, y + g.lineWidth / 2, cw - off - g.lineWidth, ch - off - g.lineWidth, ch * 0.2);
        g.stroke();
        g.fillStyle = INK;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const word = c.id.length > 1 && c.id !== 'up' && c.id !== 'down' && c.id !== 'back';
        fitLine(g, labelOf(c.id), x + (cw - off) / 2, y + (ch - off) / 2, (cw - off) * 0.88, word ? size * 0.8 * scriptScale(l) : size * 1.1, word ? SANS : MONO, 600);
      }
    });
  };

  const keyAt = (point: readonly number[] | undefined): Cell | null => {
    if (!point) return null;
    hit.updateWorldMatrix(true, false);
    const local = hit.worldToLocal(hit.position.clone().set(point[0]!, point[1]!, point[2]!));
    const f = faceXY(local.x, local.y, PAD_W, PAD_H);
    return cellAt(cells, f.x, f.y);
  };

  const press = (id: PadKey) => {
    if (id === 'up') back += SCROLL;
    else if (id === 'down') back = Math.max(0, back - SCROLL);
    else if (id === 'newest') back = 0;
    else if (id === 'clear') {
      lines.clear();
      back = 0;
    } else {
      const r = applyKey(draft, id);
      draft = r.draft;
      if (r.send !== null) void app.sim.input({ kind: 'serial', text: r.send }).catch(() => undefined);
    }
    dirty = true;
    lastDraw = -Infinity;
  };

  const syncDeck = () => deck.set({ latched: panel.isOpen, label: S.t(lang(), 'plate'), lang: lang() });
  const toggle = () => {
    panel.open(!panel.isOpen);
    syncDeck();
    dirty = true;
  };

  const offs: Unsubscribe[] = [
    bindPlate(app, deck, 'run:serial:plate', toggle),
    app.input.bind(hit, { id: 'run:serial:keys', ray: true, poke: true }, (e) => {
      if (!panel.isOpen) return;
      if (e.type === 'select-start') {
        pressed = keyAt(e.point)?.id ?? null;
        drawn = '';
      } else if (e.type === 'select-end') {
        pressed = null;
        drawn = '';
      } else if (e.type === 'select') {
        const c = keyAt(e.point);
        if (!c) return;
        fb.play('ui-press', e.point, e);
        if ((KEYS as readonly string[]).includes(c.id) || ['up', 'down', 'newest', 'clear'].includes(c.id)) press(c.id as PadKey);
      }
    }),
    app.sim.onFrame((f) => {
      if (f.atNs < nowNs) {
        // The run started again from the beginning: its output starts again too.
        lines.clear();
        back = 0;
      }
      nowNs = f.atNs;
      if (f.serial.length === 0) return;
      const before = lines.lines().length;
      for (const s of f.serial) lines.push(s.text);
      if (back > 0) back += lines.lines().length - before;
      if (!autoOpened) {
        autoOpened = true;
        panel.open(true);
        syncDeck();
      }
      dirty = true;
    }),
    app.settings.lang.subscribe(() => {
      syncDeck();
      pad.draw('', () => undefined);
      drawn = '';
      dirty = true;
    }),
    followLayout(app, (l) => {
      panel.place(l.serial);
      deck.group.position.set(l.deck.position[0], 0.0004, l.deck.position[2] - 0.014);
    }),
    onTick(app.world, () => {
      // A new load is a new run: its first output opens the panel again.
      const nl = app.sim.netlist;
      if (nl !== seenNetlist) {
        seenNetlist = nl;
        autoOpened = false;
        lines.clear();
        back = 0;
        dirty = true;
      }
      if (!panel.isOpen) return;
      const t = performance.now();
      if (dirty && t - lastDraw >= DRAW_EVERY_MS) {
        dirty = false;
        paintText(t);
        paintPad();
        panel.group.userData.serial = { open: true, lines: lines.lines().slice(-VISIBLE_LINES), draft, back };
      }
    }),
  ];
  syncDeck();

  return () => {
    for (const off of offs) off();
    deck.dispose();
    text.dispose();
    pad.dispose();
    panel.dispose();
  };
}
