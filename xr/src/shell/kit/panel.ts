/**
 * A shell panel (XR_DESIGN.md 9.1): an opaque paper plate with a 2.5 dmm ink outline, 12 dmm corners and its flat
 * blue shadow plate, a title bar with a kicker, the title and Close, and a body that holds controls. It opens with the
 * look kit's scale-in and closes with its scale-out; everything added to it fades with it. World-locked: place it with
 * `placeAhead` when it opens, never head-locked. It is in the scene from the start (hidden, under its own entity, see
 * entity.ts): do not add `group` to a plain Group, and add controls only through `add`.
 *
 *   const p = shellPanel(app, { id: 'home', w: 0.8, h: 0.5, distanceM: 1.3, title, kicker: 'iynkware', onClose });
 *   p.add(shellButton(app, {...}, {...}), x, y);   // x, y in metres from the panel centre
 *   placeAhead(app.world, p.group, { distance: 1.3, belowDeg: 8 }); p.open();
 */
import { Group } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { IconName } from '../../look/icons';
import { panelClose, panelOpen, setPanelHit } from '../../look/moves';
import { fitLines, paintIcon, paintKicker, paintPlate, PLATE } from '../../look/paint';
import { INK, MUTED, PAPER, RULE, SHADOW } from '../../look/palette';
import { dmm, TYPE } from '../../look/type';
import { shellButton, type ShellButton } from './button';
import { dropEntities, ownEntity } from './entity';
import { canvasFace, type Ctx, type Face } from './face';

/** Title bar height and the Close button's hit, in dmm (9.1). */
export const TITLE_BAR_DMM = 64;
const CLOSE_DMM = 48;

export interface PanelOptions {
  id: string;
  w: number;
  h: number;
  distanceM: number;
  title: string;
  /** Small caps over the title (`IYNKWARE`, `SETTINGS`). */
  kicker?: string;
  icon?: IconName;
  /** Shows Close at top right; called when it is pressed. */
  onClose?(): void;
  /** Poke for every control (touch range). */
  poke?: boolean;
}

export interface Fading {
  readonly group: Group;
  setOpacity(a: number): void;
  dispose(): void;
}

export interface ShellPanel {
  readonly group: Group;
  /** Controls go here, in metres from the panel centre, +y up, +z towards the viewer. */
  readonly body: Group;
  /** Metres: the top of the body area (under the title bar) and the panel's inner width. */
  readonly top: number;
  readonly inner: number;
  readonly isOpen: boolean;
  setTitle(title: string, kicker?: string): void;
  /** Adds a control at (x, y) on the panel, slightly in front of the plate, fading with the panel. */
  add<T extends Fading>(control: T, x: number, y: number): T;
  /** Removes and disposes every control added (the panel itself stays). */
  clear(): void;
  open(): void;
  close(onDone?: () => void): void;
  dispose(): void;
}

function paintPanel(g: Ctx, w: number, h: number, px: number, o: { title: string; kicker?: string; icon?: IconName; closable: boolean }): void {
  const shadow = PLATE.shadow * px;
  const border = PLATE.border * px;
  paintPlate(g, 0, 0, w, h, { fill: PAPER, ink: INK, border, radius: PLATE.radius * px, shadow, shadowColor: SHADOW });
  const pad = PLATE.padding * px;
  const bar = TITLE_BAR_DMM * px;
  let x = pad * 1.4;
  if (o.icon) {
    const s = 36 * px;
    paintIcon(g, o.icon, x, bar / 2 - s / 2 + 4 * px, s, INK);
    x += s + pad * 0.6;
  }
  const right = w - shadow - pad - (o.closable ? CLOSE_DMM * px + pad * 0.5 : 0);
  if (o.kicker) paintKicker(g, o.kicker, x, bar * 0.3, TYPE.kicker.size * px * 0.9, MUTED);
  const title = fitLines(g, o.title, { role: TYPE.title, size: TYPE.title.size * px, maxWidth: right - x, maxLines: 1 });
  g.fillStyle = INK;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(title.lines[0] ?? '', x, o.kicker ? bar * 0.68 : bar / 2);
  // The rule under the title bar, and the move handle's three ink dots at its centre (9.1).
  g.strokeStyle = RULE;
  g.lineWidth = 2 * px;
  g.beginPath();
  g.moveTo(pad, bar + pad * 0.3);
  g.lineTo(w - shadow - pad, bar + pad * 0.3);
  g.stroke();
  g.fillStyle = INK;
  for (let i = -1; i <= 1; i++) {
    g.beginPath();
    g.arc((w - shadow) / 2 + i * 9 * px, pad * 0.75, 2.4 * px, 0, Math.PI * 2);
    g.fill();
  }
}

export function shellPanel(app: XrApp, o: PanelOptions): ShellPanel {
  const group = new Group();
  group.name = `shell-panel:${o.id}`;
  group.visible = false;
  setPanelHit(group, false);
  ownEntity(app.world, group);
  const body = new Group();
  body.name = `shell-panel-body:${o.id}`;
  body.position.z = dmm(4, o.distanceM);
  group.add(body);
  ownEntity(app.world, body, group);
  const plate: Face = canvasFace(o.w, o.h, o.distanceM, { hit: true, order: 20 });
  plate.mesh.name = `panel:${o.id}`;
  group.add(plate.mesh);
  // The plate takes rays, so pointing at a panel never reaches the bench behind it.
  const offPlate = app.input.bind(plate.mesh, { id: `${o.id}/plate`, ray: true }, () => undefined);
  const px = plate.px;
  const head = { title: o.title, kicker: o.kicker };
  const repaint = () => plate.draw(JSON.stringify(head), (g, w, h) => paintPanel(g, w, h, px, { ...head, icon: o.icon, closable: !!o.onClose }));
  repaint();
  const controls: Fading[] = [];
  let close: ShellButton | null = null;
  const shadowM = dmm(PLATE.shadow, o.distanceM);
  const bar = dmm(TITLE_BAR_DMM, o.distanceM);
  if (o.onClose) {
    const s = dmm(CLOSE_DMM, o.distanceM);
    close = shellButton(app, { id: `${o.id}/close`, w: s, h: s, distanceM: o.distanceM, poke: o.poke, onSelect: () => o.onClose?.() }, { label: '', icon: 'close' });
    close.group.position.set(o.w / 2 - shadowM - dmm(PLATE.padding, o.distanceM) - s / 2, o.h / 2 - bar / 2, dmm(4, o.distanceM));
    group.add(close.group);
  }
  let opacity = 0;
  let isOpen = false;
  const setOpacity = (a: number) => {
    opacity = a;
    plate.setOpacity(a);
    close?.setOpacity(a);
    for (const c of controls) c.setOpacity(a);
  };
  setOpacity(0);
  return {
    group,
    body,
    top: o.h / 2 - bar - dmm(PLATE.padding, o.distanceM),
    inner: o.w - shadowM - 2 * dmm(PLATE.padding * 1.4, o.distanceM),
    get isOpen() {
      return isOpen;
    },
    setTitle(title, kicker) {
      head.title = title;
      if (kicker !== undefined) head.kicker = kicker;
      repaint();
    },
    add(control, x, y) {
      control.group.position.set(x - shadowM / 2, y + shadowM / 2, 0);
      body.add(control.group);
      controls.push(control);
      control.setOpacity(opacity);
      return control;
    },
    clear() {
      for (const c of controls.splice(0)) c.dispose();
    },
    open() {
      if (isOpen) return;
      isOpen = true;
      panelOpen(app.world, group, setOpacity);
    },
    close(onDone) {
      if (!isOpen) {
        onDone?.();
        return;
      }
      isOpen = false;
      panelClose(app.world, group, setOpacity, onDone);
    },
    dispose() {
      offPlate();
      for (const c of controls.splice(0)) c.dispose();
      close?.dispose();
      dropEntities(app.world, group);
      plate.dispose();
    },
  };
}
