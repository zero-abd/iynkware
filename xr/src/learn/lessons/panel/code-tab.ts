/**
 * The Code tab (design 7.2): the program from `learn/code/` (`codeView`, `chipOps`) in mono at 20 dmm, coloured by
 * token kind as the 2D `CodeBlock` colours it, with the parameter chips as accent chips. The code is one canvas texture
 * of its own; scrolling (index swipe near, pinch or trigger drag far) moves the texture window, so it never redraws
 * while scrolling. Selecting a chip opens its picker, a small panel in front; a choice applies `chipOps` as one undo.
 *
 * `learn/code/` is written in parallel: the tab shows only once that module exists (`import.meta.glob`).
 */
import { PlaneGeometry, Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../../contracts/app';
import type { Unsubscribe } from '../../../contracts/common';
import type { InteractionEvent } from '../../../contracts/input';
import type { Op, Project } from '../../../contracts/project';
import { drawButton, roundRect, type ButtonFace, type DrawCtx } from '../../kit/button';
import { drawIcon } from '../../kit/icons';
import { createPanel, type Panel, type Region } from '../../kit/panel';
import { surface, MAX_TEXTURE_PX, type Surface } from '../../kit/surface';
import { drawText, fontOf, type Box } from '../../kit/text';
import { pick } from '../../text';
import type { Chip, CodeView, TokenKind } from '../../types';
import { layoutCode, pickerOptions, valueLabel, type VisualRow } from './code-layout';
import { t } from './strings';

interface CodeModule {
  codeView(doc: Project): CodeView | null;
  chipOps(doc: Project, param: string, value: string | number | boolean): Op[];
}

const loaders = import.meta.glob<CodeModule>('../../code/index.ts');

/** The 2D `CodeBlock`'s light colours (`src/styles/tokens.css`, `--code-*`). */
export const CODE_COLOURS: Record<Exclude<TokenKind, 'chip'>, string> = {
  plain: '#231e16',
  keyword: '#2a4f9a',
  type: '#2a4f9a',
  number: '#5a4fa0',
  string: '#2e6b52',
  comment: '#6b6457',
  function: '#9a4316',
};
const CODE_BG = '#fbfbfa';
const GUTTER_DMM = 34;
const NOTE_DMM = 28;
const DRAG_M = 0.01;

export interface CodeTab {
  /** The code module is there and the project has a program. */
  readonly available: boolean;
  /** Changes whenever what the tab draws changes. */
  readonly version: number;
  draw(g: CanvasRenderingContext2D, area: Box, c: DrawCtx, simRunning: boolean): Region[];
  setVisible(on: boolean): void;
  onChange(fn: () => void): Unsubscribe;
  dispose(): void;
}

export function createCodeTab(app: XrApp, panel: Panel): CodeTab {
  let mod: CodeModule | null = null;
  let view: CodeView | null = null;
  let version = 0;
  let visible = false;
  let disposed = false;
  const fns = new Set<() => void>();
  const changed = () => {
    version++;
    fns.forEach((fn) => fn());
  };
  const refresh = () => {
    if (!mod) return;
    try {
      view = mod.codeView(app.project.doc);
    } catch (err) {
      console.warn('[learn] codeView failed', err);
      view = null;
    }
    codeKey = '';
    changed();
  };
  const loader = Object.values(loaders)[0];
  if (loader) {
    void loader()
      .then((m) => {
        if (disposed || typeof m.codeView !== 'function') return;
        mod = m;
        refresh();
      })
      .catch((err) => console.warn('[learn] the code module did not load', err));
  }
  const offDoc = app.project.subscribe(() => refresh());

  // ---- the code texture ----
  let code: Surface | null = null;
  let codeKey = '';
  let rows: VisualRow[] = [];
  let chips: Array<{ param: string; x: number; y: number; w: number; h: number }> = [];
  let areaPx: Box = { x: 0, y: 0, w: 0, h: 0 };
  let lhPx = 0;
  let scroll = 0;
  let windowStart = 0;
  let capacity = 0;
  let ctx: DrawCtx | null = null;

  const chipText = (param: string, text: string): string => {
    const chip = view?.chips.find((x) => x.param === param);
    return chip && ctx ? valueLabel(chip, chip.value, ctx.lang, { on: t(ctx.lang, 'on'), off: t(ctx.lang, 'off') }) : text;
  };

  const maxScroll = () => Math.max(0, rows.length * lhPx - areaPx.h);
  const place = () => {
    if (!code) return;
    const hc = code.canvas.height;
    const winPx = windowStart * lhPx;
    code.texture.repeat.set(1, areaPx.h / hc);
    code.texture.offset.set(0, 1 - (scroll - winPx + areaPx.h) / hc);
    const l = panel.toLocal(areaPx, { x: 0, y: 0, w: 0, h: 0 });
    code.mesh.position.set(l.x, l.y, 0.0003);
    code.mesh.scale.set(l.w, l.h, 1);
    code.mesh.visible = visible;
  };

  const drawCode = (c: DrawCtx) => {
    if (!view || !code) return;
    const P = c.pxPerDmm;
    const size = 20 * P * (c.textScale ?? 1);
    const key = `${c.lang}|${size}|${windowStart}|${JSON.stringify(view.lines)}|${JSON.stringify(view.chips.map((x) => x.value))}`;
    code.redraw(key, (g, w, h) => {
      g.fillStyle = CODE_BG;
      g.fillRect(0, 0, w, h);
      g.textBaseline = 'middle';
      chips = [];
      g.font = fontOf('code', size);
      const cw = g.measureText('M').width;
      const gutter = GUTTER_DMM * P;
      for (let i = windowStart; i < Math.min(rows.length, windowStart + capacity); i++) {
        const row = rows[i]!;
        const cy = (i - windowStart + 0.5) * lhPx;
        if (row.n > 0) {
          g.font = fontOf('code', size * 0.9);
          g.fillStyle = CODE_COLOURS.comment;
          g.textAlign = 'right';
          g.fillText(String(row.n), gutter - 10 * P, cy);
        }
        g.textAlign = 'left';
        for (const s of row.spans) {
          const x = gutter + s.col * cw;
          if (s.kind === 'chip') {
            const r = { x: x + 1, y: cy - lhPx * 0.42, w: s.cols * cw - 2, h: lhPx * 0.84 };
            roundRect(g, r, 6 * P);
            g.fillStyle = c.k.accent;
            g.fill();
            g.lineWidth = 2 * P * c.k.outline;
            g.strokeStyle = c.k.ink;
            g.stroke();
            g.font = fontOf('code', size, 600);
            g.fillStyle = c.k.ink;
            g.fillText(s.text, x + cw / 2, cy);
            chips.push({ param: s.chip ?? '', x: r.x, y: (i - windowStart) * lhPx, w: r.w, h: lhPx });
            continue;
          }
          g.font = fontOf('code', size, s.kind === 'keyword' ? 600 : 400);
          g.fillStyle = CODE_COLOURS[s.kind];
          g.fillText(s.text, x, cy);
        }
      }
    });
  };

  // ---- the picker ----
  let picker: Panel | null = null;
  const closePicker = () => {
    if (!picker) return;
    picker.dispose();
    picker = null;
    changed();
  };
  const openPicker = (chip: Chip) => {
    if (!ctx) return;
    closePicker();
    const c = ctx;
    const options = pickerOptions(chip, c.lang, { on: t(c.lang, 'on'), off: t(c.lang, 'off') });
    const cols = options.length > 6 ? 3 : 2;
    const rowsN = Math.ceil(options.length / cols);
    const heightDmm = 44 + 12 + 30 + rowsN * 54 + 12;
    const widthDmm = cols === 3 ? 330 : 280;
    const p = createPanel(app, { id: 'guide-picker', widthM: (widthDmm * 1.1) / 1000, heightM: (heightDmm * 1.1) / 1000, distanceM: 1.1, parent: panel.group, onClose: closePicker, movable: false });
    picker = p;
    p.group.position.set(0, 0, 0.03);
    const P = p.pxPerDmm;
    const label = pick(chip.label, c.lang).text;
    p.draw(`${chip.param}|${c.lang}|${chip.value}`, { ...c, pxPerDmm: P }, { title: label || t(c.lang, 'pick'), closeLabel: t(c.lang, 'close') }, (g) => {
      const area = p.content;
      drawText(g, t(c.lang, 'pick'), { x: area.x, y: area.y, w: area.w, h: 28 * P }, { role: 'caption', lang: c.lang, pxPerDmm: P, colour: c.k.ink, textScale: c.textScale, maxLines: 1, valign: 'middle' });
      const regions: Region[] = [];
      const gap = 10 * P;
      const bw = (area.w - gap * (cols - 1)) / cols;
      options.forEach((o, i) => {
        const r = { x: area.x + (i % cols) * (bw + gap), y: area.y + 36 * P + Math.floor(i / cols) * 54 * P, w: bw, h: 44 * P };
        const face: ButtonFace = { label: o.label, kind: o.current ? 'primary' : 'plain', icon: o.current ? 'tick' : undefined };
        drawButton(g, r, face, { ...c, pxPerDmm: P });
        regions.push({
          id: `opt${i}`,
          rect: r,
          face,
          onSelect: () => {
            if (mod) app.project.apply(mod.chipOps(app.project.doc, chip.param, o.value), { label: `${label}: ${o.label}` });
            closePicker();
          },
        });
      });
      return regions;
    });
    changed();
  };

  // ---- pointer on the code: drag scrolls, a tap on a chip opens its picker ----
  const o = new Vector3();
  const d = new Vector3();
  const local = { x: 0, y: 0 };
  const toLocal = (e: InteractionEvent): boolean => {
    const g = panel.group;
    g.updateWorldMatrix(true, false);
    o.set(e.pointer.origin[0], e.pointer.origin[1], e.pointer.origin[2]);
    d.set(e.pointer.origin[0] + e.pointer.direction[0], e.pointer.origin[1] + e.pointer.direction[1], e.pointer.origin[2] + e.pointer.direction[2]);
    g.worldToLocal(o);
    g.worldToLocal(d);
    d.sub(o);
    if (Math.abs(o.z) < 0.03 || Math.abs(d.z) < 1e-6) {
      local.x = o.x;
      local.y = o.y;
      return true;
    }
    const s = -o.z / d.z;
    if (s < 0) return false;
    local.x = o.x + d.x * s;
    local.y = o.y + d.y * s;
    return true;
  };
  let startY = 0;
  let startScroll = 0;
  let dragged = false;
  const onEvent = (e: InteractionEvent) => {
    if (e.type === 'select-start') {
      if (!toLocal(e)) return;
      startY = local.y;
      startScroll = scroll;
      dragged = false;
    } else if (e.type === 'drag-move') {
      if (!toLocal(e)) return;
      const dy = local.y - startY;
      if (Math.abs(dy) > DRAG_M) dragged = true;
      if (!dragged) return;
      scroll = Math.max(0, Math.min(maxScroll(), startScroll + dy * panel.body.pxPerM));
      const first = Math.floor(scroll / lhPx);
      const need = Math.ceil((scroll + areaPx.h) / lhPx);
      if (first < windowStart || need > windowStart + capacity) {
        windowStart = Math.max(0, Math.min(first, rows.length - capacity));
        if (ctx) drawCode(ctx);
      }
      place();
    } else if (e.type === 'select' && !dragged) {
      if (!toLocal(e) || !view) return;
      const px = (local.x / (panel.W / panel.body.pxPerM) + 0.5) * panel.W - areaPx.x;
      const py = (0.5 - local.y / (panel.H / panel.body.pxPerM)) * panel.H - areaPx.y + scroll - windowStart * lhPx;
      const hit = chips.find((ch) => px >= ch.x && px <= ch.x + ch.w && py >= ch.y && py <= ch.y + ch.h);
      const chip = hit && view.chips.find((x) => x.param === hit.param);
      if (chip) openPicker(chip);
    }
  };

  return {
    get available() {
      return !!mod && !!view && view.lines.length > 0;
    },
    get version() {
      return version;
    },
    draw(g, area, c, simRunning) {
      ctx = c;
      const P = c.pxPerDmm;
      const regions: Region[] = [];
      if (!view) {
        drawText(g, t(c.lang, 'noCode'), area, { role: 'body', lang: c.lang, pxPerDmm: P, colour: c.k.ink, textScale: c.textScale });
        return regions;
      }
      const note = simRunning ? NOTE_DMM * P : 0;
      const box: Box = { x: area.x, y: area.y, w: area.w, h: area.h - (note ? note + 8 * P : 0) };
      roundRect(g, box, 10 * P);
      g.fillStyle = CODE_BG;
      g.fill();
      g.lineWidth = 2 * P * c.k.outline;
      g.strokeStyle = c.k.rule;
      g.stroke();
      if (note) {
        const y = area.y + area.h - note;
        drawIcon(g, 'info', area.x + 12 * P, y + note / 2, 22 * P, c.k, c.k.info);
        drawText(g, t(c.lang, 'runAgain'), { x: area.x + 30 * P, y, w: area.w - 30 * P, h: note }, { role: 'label', lang: c.lang, pxPerDmm: P, colour: c.k.ink, textScale: c.textScale, maxLines: 1, valign: 'middle', weight: 600 });
      }
      const inset = 4 * P;
      const next: Box = { x: box.x + inset, y: box.y + inset, w: box.w - 2 * inset, h: box.h - 2 * inset };
      const size = 20 * P * (c.textScale ?? 1);
      g.font = fontOf('code', size);
      const cw = g.measureText('M').width;
      const cols = Math.floor((next.w - GUTTER_DMM * P - 8 * P) / cw);
      const key = `${cols}|${c.lang}|${JSON.stringify(view.lines)}|${JSON.stringify(view.chips.map((x) => x.value))}`;
      if (key !== codeKey || next.w !== areaPx.w || next.h !== areaPx.h) {
        codeKey = key;
        areaPx = next;
        lhPx = size * 1.3;
        rows = layoutCode(view.lines, cols, chipText);
        const wantH = Math.min(MAX_TEXTURE_PX, Math.ceil((rows.length * lhPx) / 256) * 256 || 256);
        if (!code || code.canvas.height < Math.min(wantH, MAX_TEXTURE_PX) || code.canvas.width !== Math.round(next.w)) {
          code?.dispose();
          code = surface({ widthM: next.w / panel.body.pxPerM, heightM: wantH / panel.body.pxPerM, pxPerM: panel.body.pxPerM, name: 'guide:code' });
          code.mesh.geometry.dispose();
          code.mesh.geometry = new PlaneGeometry(1, 1);
          panel.group.add(code.mesh);
        }
        capacity = Math.floor(code.canvas.height / lhPx);
        scroll = Math.min(scroll, maxScroll());
        windowStart = Math.max(0, Math.min(windowStart, rows.length - capacity));
      }
      drawCode(c);
      place();
      regions.push({ id: 'code', rect: areaPx, onEvent });
      return regions;
    },
    setVisible(on) {
      visible = on;
      if (code) code.mesh.visible = on;
      if (!on && picker) closePicker();
    },
    onChange(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    dispose() {
      disposed = true;
      offDoc();
      picker?.dispose();
      code?.dispose();
      fns.clear();
    },
  };
}
