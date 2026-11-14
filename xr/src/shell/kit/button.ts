/**
 * A shell button, painted with the look kit: a paper plate with an ink outline and its flat blue shadow plate, an
 * optional Phosphor icon, a label and a detail line. It shows hover before commit (the plate lifts 3 dmm towards you
 * and its edge turns accent), sinks 3 dmm and fills on press (XR_DESIGN.md section 4), and is bound through
 * `app.input.bind`, so a controller trigger, a hand pinch on the ray, a fingertip poke and the mouse all press it.
 *
 *   const b = shellButton(app, { id: 'home/new', w: 0.24, h: 0.09, distanceM: 1.3, onSelect: () => create() },
 *     { label: say(COPY, lang, 'new'), icon: 'plus', layout: 'row' });
 *   panel.body.add(b.group); b.group.position.set(x, y, 0);
 *   b.set({ label: say(COPY, nextLang, 'new') });   // repaints only what changed
 */
import { Group } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { InteractionEvent } from '../../contracts/input';
import type { IconName } from '../../look/icons';
import { hoverLift, pressTravel } from '../../look/moves';
import { fitLines, paintIcon, paintPill, paintPlate, PLATE, useFont } from '../../look/paint';
import { ACCENT, FIGURE_ACCENT, INK, MUTED, PAPER, PAPER_DIM, RULE, SHADOW, STATE } from '../../look/palette';
import { dmm, TYPE } from '../../look/type';
import { dropEntities, ownEntity } from './entity';
import { canvasFace, type Ctx, type Face } from './face';

export type ButtonLayout = 'center' | 'row' | 'tile';

export interface ButtonLook {
  label: string;
  /** A second, quieter line: a project's board and date, a setting's value. */
  detail?: string;
  icon?: IconName;
  /** `center`: icon and label on one line. `row`: left aligned, label over detail. `tile`: icon on top. */
  layout?: ButtonLayout;
  /** The one main action of a panel: accent fill, ink label. */
  primary?: boolean;
  /** The chosen option of a segmented choice: the figures' yellow "on" fill. */
  selected?: boolean;
  /** A destructive confirm (Delete): the bad colour, paper label. */
  danger?: boolean;
  disabled?: boolean;
  /** Draws a switch at the right end: on or off. The detail line should say which in words. */
  switchOn?: boolean;
}

export interface ShellButton {
  readonly group: Group;
  readonly look: Readonly<ButtonLook>;
  set(patch: Partial<ButtonLook>): void;
  setOpacity(a: number): void;
  dispose(): void;
}

export interface ButtonOptions {
  /** Reported as the interaction target (`home/continue`). */
  id: string;
  w: number;
  h: number;
  /** Reading distance in metres: sets the texture density and the dmm-sized hover and press travel. */
  distanceM: number;
  /** Fingertip poke as well as the ray. On for anything within touch range (under 0.6 m). */
  poke?: boolean;
  onSelect(e: InteractionEvent): void;
}

type State = 'idle' | 'hover' | 'press';

/** The fill and ink of a button in a state; pure, so tests can check every case. */
export function buttonColours(look: ButtonLook, state: State): { fill: string; ink: string; edge: string; label: string; shadow: boolean } {
  if (look.disabled) return { fill: PAPER_DIM, ink: MUTED, edge: MUTED, label: MUTED, shadow: false };
  const edge = state === 'idle' ? INK : ACCENT;
  if (state === 'press') return { fill: ACCENT, ink: INK, edge: INK, label: INK, shadow: true };
  if (look.danger) return { fill: STATE.bad, ink: INK, edge, label: PAPER, shadow: true };
  if (look.primary) return { fill: ACCENT, ink: INK, edge, label: INK, shadow: true };
  if (look.selected) return { fill: FIGURE_ACCENT, ink: INK, edge, label: INK, shadow: true };
  return { fill: PAPER, ink: INK, edge, label: INK, shadow: true };
}

function paintButton(g: Ctx, w: number, h: number, px: number, look: ButtonLook, state: State): void {
  const c = buttonColours(look, state);
  const border = PLATE.border * px;
  const shadow = c.shadow ? Math.min(PLATE.shadow * px, h * 0.12) : 0;
  const radius = Math.min(PLATE.radius * px, h * 0.3);
  paintPlate(g, 0, 0, w, h, { fill: c.fill, ink: c.edge, border: state === 'idle' ? border : border * 1.4, radius, shadow, shadowColor: SHADOW });
  const iw = w - shadow;
  const ih = h - shadow;
  const pad = Math.min(PLATE.padding * px, ih * 0.28);
  const layout = look.layout ?? 'center';
  const labelPx = TYPE.label.size * px;
  const detailPx = TYPE.caption.size * px;
  const iconPx = (layout === 'tile' ? 48 : 32) * px;
  let right = iw - pad;
  if (look.switchOn !== undefined) {
    const sw = 64 * px;
    const sh = 34 * px;
    const sx = right - sw;
    const sy = ih / 2 - sh / 2;
    paintPill(g, sx, sy, sw, sh, { fill: look.switchOn ? FIGURE_ACCENT : RULE, ink: c.label === PAPER ? PAPER : INK, border: border * 0.8 });
    const r = sh * 0.36;
    g.beginPath();
    g.arc(look.switchOn ? sx + sw - sh / 2 : sx + sh / 2, ih / 2, r, 0, Math.PI * 2);
    g.fillStyle = look.switchOn ? INK : PAPER;
    g.fill();
    g.lineWidth = border * 0.8;
    g.strokeStyle = INK;
    g.stroke();
    right = sx - pad * 0.6;
  }
  g.textBaseline = 'middle';
  if (layout === 'tile') {
    if (look.icon) paintIcon(g, look.icon, pad, pad, iconPx, c.label);
    const top = look.icon ? pad + iconPx + pad * 0.5 : pad;
    const label = fitLines(g, look.label, { role: TYPE.label, size: labelPx, maxWidth: right - pad, maxLines: 2 });
    g.fillStyle = c.label;
    g.textAlign = 'left';
    label.lines.forEach((l, i) => g.fillText(l, pad, top + label.lineHeight * (i + 0.5)));
    if (look.detail) {
      const y = top + label.lineHeight * label.lines.length + detailPx * 0.4;
      const d = fitLines(g, look.detail, { role: TYPE.caption, size: detailPx, minSize: detailPx, maxWidth: right - pad, maxLines: 2 });
      g.fillStyle = c.label === PAPER ? PAPER : look.disabled ? MUTED : INK;
      d.lines.forEach((l, i) => g.fillText(l, pad, y + d.lineHeight * (i + 0.5)));
    }
    return;
  }
  if (layout === 'row') {
    let x = pad;
    if (look.icon) {
      paintIcon(g, look.icon, x, ih / 2 - iconPx / 2, iconPx, c.label);
      x += iconPx + pad * 0.7;
    }
    const maxWidth = Math.max(10, right - x);
    if (look.detail) {
      const label = fitLines(g, look.label, { role: TYPE.label, size: labelPx, maxWidth, maxLines: 1 });
      const lh = label.lineHeight;
      useFont(g, TYPE.caption, detailPx, look.detail);
      const d = fitLines(g, look.detail, { role: TYPE.caption, size: detailPx, minSize: detailPx, maxWidth, maxLines: 1 });
      const total = lh + d.lineHeight;
      const y0 = ih / 2 - total / 2;
      fitLines(g, look.label, { role: TYPE.label, size: labelPx, maxWidth, maxLines: 1 });
      g.fillStyle = c.label;
      g.textAlign = 'left';
      g.fillText(label.lines[0] ?? '', x, y0 + lh / 2);
      fitLines(g, look.detail, { role: TYPE.caption, size: detailPx, minSize: detailPx, maxWidth, maxLines: 1 });
      g.fillStyle = c.label === PAPER ? PAPER : look.disabled ? MUTED : INK;
      g.globalAlpha = c.label === PAPER ? 0.9 : 0.78;
      g.fillText(d.lines[0] ?? '', x, y0 + lh + d.lineHeight / 2);
      g.globalAlpha = 1;
    } else {
      const label = fitLines(g, look.label, { role: TYPE.label, size: labelPx, maxWidth, maxLines: 1 });
      g.fillStyle = c.label;
      g.textAlign = 'left';
      g.fillText(label.lines[0] ?? '', x, ih / 2);
    }
    return;
  }
  // center: icon and label on one line, the pair centred.
  const label = fitLines(g, look.label, { role: TYPE.label, size: labelPx, maxWidth: right - pad - (look.icon ? iconPx + pad * 0.5 : 0), maxLines: 1 });
  const text = label.lines[0] ?? '';
  const tw = g.measureText(text).width;
  const gap = look.icon && text ? pad * 0.5 : 0;
  const total = (look.icon ? iconPx : 0) + gap + tw;
  let x = (right + pad) / 2 - total / 2;
  if (look.icon) {
    paintIcon(g, look.icon, x, ih / 2 - iconPx / 2, iconPx, c.label);
    x += iconPx + gap;
  }
  g.fillStyle = c.label;
  g.textAlign = 'left';
  g.fillText(text, x, ih / 2);
}

export function shellButton(app: XrApp, opts: ButtonOptions, initial: ButtonLook): ShellButton {
  const group = new Group();
  group.name = `shell-button:${opts.id}`;
  // Its own entity first, so the bound face's entities hang under it and the button can be added to a panel (entity.ts).
  ownEntity(app.world, group);
  const lift = new Group();
  group.add(lift);
  const face: Face = canvasFace(opts.w, opts.h, opts.distanceM, { hit: true, order: 22 });
  face.mesh.name = `button:${opts.id}`;
  lift.add(face.mesh);
  let look: ButtonLook = { ...initial };
  let state: State = 'idle';
  const travel = dmm(3, opts.distanceM);
  const paint = () =>
    face.draw(JSON.stringify([look, state]), (g, w, h) => paintButton(g, w, h, face.px, look, state));
  paint();
  const buzz = (e: InteractionEvent, intensity: number, ms: number) => {
    if (e.pointer.source === 'controller' && e.pointer.hand) app.input.pulse(e.pointer.hand, intensity, ms);
  };
  const off = app.input.bind(face.mesh, { id: opts.id, ray: true, poke: opts.poke ?? false }, (e) => {
    if (look.disabled) return;
    switch (e.type) {
      case 'hover-start':
        state = 'hover';
        hoverLift(app.world, lift, travel, true);
        buzz(e, 0.08, 8);
        break;
      case 'hover-end':
        state = 'idle';
        hoverLift(app.world, lift, travel, false);
        pressTravel(app.world, face.mesh, travel, false, 'z');
        break;
      case 'select-start':
        state = 'press';
        pressTravel(app.world, face.mesh, travel, true, 'z');
        buzz(e, 0.35, 12);
        break;
      case 'select-end':
        state = state === 'press' ? 'hover' : state;
        pressTravel(app.world, face.mesh, travel, false, 'z');
        break;
      case 'select':
        opts.onSelect(e);
        break;
      default:
        return;
    }
    paint();
  });
  return {
    group,
    get look() {
      return look;
    },
    set(patch) {
      look = { ...look, ...patch };
      if (look.disabled && state !== 'idle') state = 'idle';
      paint();
    },
    setOpacity: (a) => face.setOpacity(a),
    dispose() {
      off();
      dropEntities(app.world, group);
      face.dispose();
    },
  };
}
