/**
 * A paper panel of design 9.1: an opaque `paper` plate with a 2.5 dmm ink outline and 12 dmm corners, a flat `shadow`
 * plate 6 dmm right, 6 dmm down and 5 mm behind, and a 40 dmm title bar that is the move handle (three ink dots) with
 * Close as a 48 dmm hit at the top right. Everything static is drawn into one canvas texture, so a panel is two draw
 * calls (plate and shadow) plus a lift plate while a button is hovered. Buttons are drawn into the canvas and hit by
 * invisible regions (`hits.ts`); the hovered one is redrawn on a small lift plate 3 dmm in front, which sinks flush and
 * fills accent while pressed (design 4).
 *
 * Usage: const p = createPanel(app, { id: 'guide', widthM: 0.52, heightM: 0.4, distanceM: 1.1 }); p.draw(key, ctx, title, content);
 */
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Shape, ShapeGeometry, Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { InteractionEvent } from '../../contracts/input';
import { movable } from '../../ui/panels';
import { drawButton, roundRect, type ButtonFace, type DrawCtx } from './button';
import { dmm } from './dmm';
import { releaseEntities } from './entities';
import { createHits, type HitRegion } from './hits';
import { drawIcon, type IconName } from './icons';
import { surface, type Surface } from './surface';
import { drawText, type Box } from './text';
import type { Tokens } from './tokens';

export interface PanelOptions {
  /** Prefix of the input binding ids (`guide:next`). */
  readonly id: string;
  readonly widthM: number;
  readonly heightM: number;
  /** The distance its dmm sizes are set for. */
  readonly distanceM: number;
  /** Canvas texels per dmm (design 9.2 asks for at least two). */
  readonly texelsPerDmm?: number;
  /** Shows Close at the top right. */
  readonly onClose?: () => void;
  /** Called with the panel's new world position while it is dragged (by its grip bar or its title bar). */
  readonly onMove?: (world: Vector3) => void;
  /** Gives it the shared grip bar and makes it movable (ui/panels). Default true; false for a panel inside another. */
  readonly movable?: boolean;
}

/** A button or other hit drawn in the canvas: pixel rectangle, its face (for the lift plate) and what it does. */
export interface Region {
  readonly id: string;
  readonly rect: Box;
  readonly face?: ButtonFace;
  readonly disabled?: boolean;
  onSelect?(e: InteractionEvent): void;
  onEvent?(e: InteractionEvent): void;
}

/** What the title bar shows. */
export interface PanelHead {
  readonly title: string;
  /** Close's tooltip word. */
  readonly closeLabel: string;
  /** A state icon before the title (a lesson that is done). */
  readonly icon?: IconName;
}

export interface Panel {
  /** Position and turn this; +Z faces the person. */
  readonly group: Group;
  readonly body: Surface;
  /** Canvas size in px. */
  readonly W: number;
  readonly H: number;
  readonly pxPerDmm: number;
  /** The content area under the title bar, in px. */
  readonly content: Box;
  readonly titleBarPx: number;
  /** px to panel-local metres (x right, y up), the centre of a px rectangle. */
  toLocal(r: Box, out: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number };
  /** Redraws when `key` changes: plate, title bar, then `content`, which returns its regions. Returns whether it drew. */
  draw(key: string, c: DrawCtx, head: PanelHead, content: (g: CanvasRenderingContext2D) => Region[]): boolean;
  /** Re-runs the lift plates (after a state change that alters a hovered face). */
  refreshLifts(): void;
  /** Turns the panel to face `head` (world) in yaw and pitch, never rolled. */
  face(head: Vector3): void;
  /** True while its title bar is held. */
  readonly moving: boolean;
  dispose(): void;
}

const OUTLINE_DMM = 2.5;
const CORNER_DMM = 12;
const BAR_DMM = 44;
const CLOSE_DMM = 48;
const SHADOW_DMM = 6;
const SHADOW_BACK_M = 0.005;
const LIFT_DMM = 3;
/** The biggest button a lift plate can show, in dmm. */
const LIFT_W_DMM = 300;
const LIFT_H_DMM = 64;

function roundedShape(w: number, h: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function createPanel(app: Pick<XrApp, 'input' | 'world'> & { bench?: Pick<XrApp['bench'], 'table'> }, o: PanelOptions): Panel {
  const T = o.texelsPerDmm ?? 2.4;
  const mPerDmm = dmm(1, o.distanceM);
  const pxPerM = T / mPerDmm;
  const group = new Group();
  group.name = `${o.id}:panel`;
  const body = surface({ widthM: o.widthM, heightM: o.heightM, pxPerM, name: `${o.id}:plate` });
  const W = body.canvas.width;
  const H = body.canvas.height;
  const pxPerDmm = W / (o.widthM / mPerDmm);
  group.add(body.mesh);

  const shadowMat = new MeshBasicMaterial({ color: '#41538f' });
  const shadow = new Mesh(new ShapeGeometry(roundedShape(o.widthM, o.heightM, CORNER_DMM * mPerDmm), 6), shadowMat);
  shadow.position.set(SHADOW_DMM * mPerDmm, -SHADOW_DMM * mPerDmm, -SHADOW_BACK_M);
  shadow.name = `${o.id}:shadow`;
  group.add(shadow);

  const hits = createHits(app, group, o.id);
  // The plate catches rays too, so a ray on the panel never reaches the bench behind it.
  const offPlate = app.input.bind(body.mesh, { id: `${o.id}:plate`, ray: true }, () => undefined);

  const pad = 16 * pxPerDmm;
  const bar = BAR_DMM * pxPerDmm;
  const content: Box = { x: pad, y: bar + 10 * pxPerDmm, w: W - 2 * pad, h: H - bar - 10 * pxPerDmm - pad };

  const local = { x: 0, y: 0, w: 0, h: 0 };
  const toLocal: Panel['toLocal'] = (r, out) => {
    out.x = ((r.x + r.w / 2) / W - 0.5) * o.widthM;
    out.y = (0.5 - (r.y + r.h / 2) / H) * o.heightM;
    out.w = (r.w / W) * o.widthM;
    out.h = (r.h / H) * o.heightM;
    return out;
  };

  // ---- lift plates: the hovered button, redrawn 3 dmm in front (one per pointer, at most two) ----
  const liftPx = { w: Math.round(LIFT_W_DMM * pxPerDmm), h: Math.round(LIFT_H_DMM * pxPerDmm) };
  const lifts: Array<{ s: Surface; owner: number | null; key: string }> = [0, 1].map(() => {
    const s = surface({ widthM: liftPx.w / pxPerM, heightM: liftPx.h / pxPerM, pxPerM, name: `${o.id}:lift` });
    s.mesh.geometry.dispose();
    s.mesh.geometry = new PlaneGeometry(1, 1);
    s.mesh.visible = false;
    group.add(s.mesh);
    return { s, owner: null, key: '' };
  });
  let regions = new Map<string, Region>();
  let ctx: DrawCtx | null = null;

  const refreshLifts = () => {
    const want = new Map<number, string>();
    for (const [p, id] of hits.hovered) want.set(p, id);
    for (const [p, id] of hits.pressed) want.set(p, id);
    for (const l of lifts) if (l.owner !== null && !want.has(l.owner)) l.owner = null;
    for (const [p, id] of want) {
      const r = regions.get(id);
      let l = lifts.find((x) => x.owner === p);
      if (!r?.face || r.disabled || !ctx || r.rect.w > liftPx.w || r.rect.h > liftPx.h) {
        if (l) l.owner = null;
        continue;
      }
      l ??= lifts.find((x) => x.owner === null);
      if (!l) continue;
      l.owner = p;
      const pressed = [...hits.pressed.entries()].some(([q, h]) => q === p && h === id);
      const face: ButtonFace = { ...r.face, hover: !pressed, pressed };
      const key = `${id}|${JSON.stringify(face)}|${r.rect.w}x${r.rect.h}|${ctx.lang}|${ctx.k.paper}`;
      const c = ctx;
      if (key !== l.key) {
        l.key = key;
        l.s.redraw(key, (g) => drawButton(g, { x: 0, y: 0, w: r.rect.w, h: r.rect.h }, face, c));
        l.s.texture.repeat.set(r.rect.w / liftPx.w, r.rect.h / liftPx.h);
        l.s.texture.offset.set(0, 1 - r.rect.h / liftPx.h);
      }
      toLocal(r.rect, local);
      l.s.mesh.position.set(local.x, local.y, pressed ? 0.0006 : LIFT_DMM * mPerDmm);
      l.s.mesh.scale.set(local.w, local.h, 1);
    }
    for (const l of lifts) l.s.mesh.visible = l.owner !== null;
  };
  const offHits = hits.onChange(refreshLifts);

  // ---- moving: the shared grip bar under the panel, and the title bar, which feeds it ----
  const grip =
    o.movable === false ? null : movable(app, { id: `learn/${o.id}`, group, width: o.widthM, height: o.heightM, distanceM: o.distanceM, onMove: o.onMove });
  const move = (e: InteractionEvent) => grip?.drag(e);

  const draw: Panel['draw'] = (key, c, head, drawContent) => {
    let next: Region[] = [];
    const drew = body.redraw(key, (g) => {
      const k: Tokens = c.k;
      const line = OUTLINE_DMM * pxPerDmm * k.outline;
      const corner = CORNER_DMM * pxPerDmm;
      // Plate and outline.
      roundRect(g, { x: line / 2, y: line / 2, w: W - line, h: H - line }, corner);
      g.fillStyle = k.paper;
      g.fill();
      // Title bar: a rule under it, the grip in the middle, the title at the left, Close at the right.
      g.fillStyle = k.rule;
      g.fillRect(line, bar - line * 0.4, W - 2 * line, line * 0.8);
      g.beginPath();
      roundRect(g, { x: line / 2, y: line / 2, w: W - line, h: H - line }, corner);
      g.lineWidth = line;
      g.strokeStyle = k.ink;
      g.stroke();
      const close = CLOSE_DMM * pxPerDmm;
      const grip = 28 * pxPerDmm;
      drawIcon(g, 'grip', pad + grip / 2, bar / 2, grip, k);
      let titleX = pad + grip + 10 * pxPerDmm;
      if (head.icon) {
        const d = 28 * pxPerDmm;
        drawIcon(g, head.icon, titleX + d / 2, bar / 2, d, k);
        titleX += d + 8 * pxPerDmm;
      }
      const titleW = W - titleX - (o.onClose ? close + 8 * pxPerDmm : pad);
      drawText(g, head.title, { x: titleX, y: 2 * pxPerDmm, w: titleW, h: bar - 4 * pxPerDmm }, { role: 'title', lang: c.lang, pxPerDmm, colour: k.ink, textScale: c.textScale, maxLines: 1, valign: 'middle' });
      next = drawContent(g);
      const regionsNow: Region[] = [{ id: 'move', rect: { x: 0, y: 0, w: W - (o.onClose ? close : 0), h: bar }, onEvent: move }];
      if (o.onClose) {
        const rect = { x: W - close - line, y: (bar - close) / 2 + line / 2, w: close, h: close };
        drawIcon(g, 'close', rect.x + close / 2, rect.y + close / 2, 26 * pxPerDmm, k);
        regionsNow.push({ id: 'close', rect, face: { label: head.closeLabel, icon: 'close', iconOnly: true, kind: 'plain' }, onSelect: () => o.onClose?.() });
      }
      next = [...regionsNow, ...next];
    });
    ctx = c;
    if (!drew) return false;
    regions = new Map(next.map((r) => [r.id, r]));
    hits.set(
      next.map((r): HitRegion => {
        const l = toLocal(r.rect, { x: 0, y: 0, w: 0, h: 0 });
        return { id: r.id, ...l, disabled: r.disabled, onSelect: r.onSelect, onEvent: r.onEvent };
      }),
    );
    for (const l of lifts) l.key = '';
    refreshLifts();
    return true;
  };

  const look = new Vector3();
  return {
    group,
    body,
    W,
    H,
    pxPerDmm,
    content,
    titleBarPx: bar,
    toLocal,
    draw,
    refreshLifts,
    face(head) {
      look.copy(head);
      group.lookAt(look);
    },
    get moving() {
      return grip?.moving ?? false;
    },
    dispose() {
      grip?.dispose();
      offHits();
      offPlate();
      hits.dispose();
      releaseEntities(app.world, group);
      body.dispose();
      for (const l of lifts) l.s.dispose();
      shadow.geometry.dispose();
      shadowMat.dispose();
      group.removeFromParent();
    },
  };
}
