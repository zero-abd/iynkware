/**
 * The pillar's plate button (XR_DESIGN.md 2.6, 9.1, 9.4, section 4): an inked paper slab, three tone bands and an ink
 * hull, a flat blue shadow plate under it, a canvas face printed with a Phosphor icon and an 18 dmm label (or a large
 * readout such as "3x"). It lifts 3 dmm with an accent outline on hover, sinks on press, fills accent when latched (a
 * switch that is on), takes a figure-accent edge when lit (Room size at 6x) and greys its ink when disabled. Lies on
 * the bench facing +y, or stands in a panel facing +z. The face redraws only when what it shows changes.
 *
 *   const minus = scalePlate(app, { w: 0.048, d: 0.048 }, { icon: 'minus', label: 'Smaller' });
 *   table.add(minus.group);
 *   const off = bindPlate(app, minus, 'scale/minus', () => app.scale.stepWorkScale(-1));
 *
 * Colours, type, icons and moves are the look kit's; the slab and the face come through `./ui` (adapter).
 */
import { Group, type Mesh } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import type { InteractionEvent } from '../../contracts/input';
import type { IconName } from '../../look/icons';
import { hoverLift, pressTravel } from '../../look/moves';
import { fitLines, paintIcon, useFont } from '../../look/paint';
import { ACCENT, FIGURE_ACCENT, INK, MUTED, PAPER } from '../../look/palette';
import { dmm, TYPE } from '../../look/type';
import { canvasFace, inkShadow, inkSolid, roundedSlab, uiFeedback } from './ui';

export interface PlateLook {
  icon: IconName | null;
  /** The label: an 18 dmm caption under the icon or the readout, or the plate's only text. */
  label: string;
  /** A readout drawn large (display type) in place of the icon, such as "3x". */
  value?: string | null;
  /** A switch that is on: filled accent. */
  latched?: boolean;
  /** Calls for attention (Room size at 6x): a figure-accent edge. */
  lit?: boolean;
  disabled?: boolean;
}

export interface PlateSize {
  /** Width along x and depth (along z lying, along y standing), metres. */
  w: number;
  d: number;
  /** Thickness. Default 8 mm. */
  h?: number;
  /** Viewing distance the text is sized for, metres. Default the rail's 0.47. */
  distanceM?: number;
  /** Stands in a panel facing +z instead of lying on the bench. */
  standing?: boolean;
  /** A wide row: icon at the left and the label beside it (panel rows), instead of icon over caption. */
  row?: boolean;
}

export interface Plate {
  /** Add this: centred on its footprint, y = 0 at its base (its back, standing). */
  readonly group: Group;
  /** The mesh to bind; the face, outline and shadow take no rays. */
  readonly hit: Mesh;
  readonly look: Readonly<PlateLook>;
  set(patch: Partial<PlateLook>): void;
  hover(on: boolean): void;
  press(on: boolean): void;
  dispose(): void;
}

export function scalePlate(app: Pick<XrApp, 'world'>, size: PlateSize, initial: PlateLook): Plate {
  const h = size.h ?? 0.008;
  const dist = size.distanceM ?? 0.47;
  const radius = Math.min(size.w, size.d) * 0.16;
  const group = new Group();
  const lift = new Group();
  const travel = new Group();
  group.add(lift);
  lift.add(travel);
  const solid = inkSolid(roundedSlab(size.w, size.d, h, radius), PAPER);
  travel.add(solid.group);
  const shadow = inkShadow(size.w, size.d, radius);
  shadow.raycast = () => undefined;
  group.add(shadow);
  const face = canvasFace(size.w * 0.94, size.d * 0.94, { distanceM: dist, up: true, radius: radius * 0.9 });
  face.mesh.position.y = h + 0.0003;
  solid.body.add(face.mesh);
  if (size.standing) group.rotation.x = Math.PI / 2;

  const look: PlateLook = { ...initial };
  let hovered = false;
  let pressed = false;

  const redraw = () => {
    const fill = pressed || look.latched ? ACCENT : PAPER;
    const ink = look.disabled ? MUTED : INK;
    const key = JSON.stringify([look.icon, look.label, look.value ?? null, look.lit ?? false, look.disabled ?? false, fill]);
    face.draw(key, (g, w, hp) => {
      const px = face.pxPerM;
      const r = radius * 0.9 * px;
      if (fill !== PAPER || look.lit) {
        g.beginPath();
        g.roundRect(0, 0, w, hp, r);
        if (fill !== PAPER) {
          g.fillStyle = fill;
          g.fill();
        }
        if (look.lit) {
          g.lineWidth = Math.max(3, dmm(5, dist) * px);
          g.strokeStyle = FIGURE_ACCENT;
          g.stroke();
        }
      }
      if (size.row) {
        // A row: the icon at the left, the label beside it in the label role, up to two lines.
        const icon = look.icon ? Math.min(hp * 0.62, dmm(32, dist) * px) : 0;
        const pad = hp * 0.2;
        if (look.icon) paintIcon(g, look.icon, pad, (hp - icon) / 2, icon, ink);
        const left = pad + (icon ? icon + pad * 0.8 : 0);
        const text = look.value ? `${look.label}  ${look.value}` : look.label;
        const fit = fitLines(g, text, { role: TYPE.label, size: dmm(TYPE.label.size, dist) * px, maxWidth: w - left - pad, maxLines: 2 });
        g.fillStyle = ink;
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        const top = (hp - fit.lines.length * fit.lineHeight) / 2;
        fit.lines.forEach((line, i) => g.fillText(line, left, top + fit.lineHeight * (i + 0.5)));
        return;
      }
      const caption = dmm(TYPE.caption.size, dist) * px;
      const big = look.value ? dmm(TYPE.display.size, dist) * px * 0.8 : look.icon ? dmm(32, dist) * px : 0;
      const gap = big ? caption * 0.4 : 0;
      const label = look.label
        ? fitLines(g, look.label, { role: TYPE.caption, size: caption, maxWidth: w * 0.9, maxLines: big ? 1 : 2 })
        : null;
      const labelH = label ? label.lines.length * label.lineHeight : 0;
      let y = (hp - big - gap - labelH) / 2;
      if (look.value) {
        const v = fitLines(g, look.value, { role: TYPE.display, size: big, maxWidth: w * 0.9, maxLines: 1 });
        g.fillStyle = ink;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(v.lines[0] ?? '', w / 2, y + big / 2);
      } else if (look.icon) {
        paintIcon(g, look.icon, (w - big) / 2, y, big, ink);
      }
      y += big + gap;
      if (label) {
        useFont(g, TYPE.caption, label.size, look.label);
        g.fillStyle = ink;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        label.lines.forEach((line, i) => g.fillText(line, w / 2, y + label.lineHeight * (i + 0.5)));
      }
    });
  };

  const liftBy = dmm(3, dist);
  const outline = () => solid.setOutline(hovered && !look.disabled ? ACCENT : INK);
  redraw();

  return {
    group,
    hit: solid.body,
    look,
    set(patch) {
      Object.assign(look, patch);
      outline();
      redraw();
    },
    hover(on) {
      hovered = on;
      outline();
      hoverLift(app.world, lift, liftBy, on && !look.disabled, 'y');
    },
    press(on) {
      pressed = on && !look.disabled;
      pressTravel(app.world, travel, liftBy * 1.6, pressed, 'y');
      redraw();
    },
    dispose() {
      face.dispose();
      solid.dispose();
      shadow.geometry.dispose();
      group.removeFromParent();
    },
  };
}

/**
 * Binds a plate with ray and poke: hover lifts it with the barely-felt hover buzz, a press sinks it, a completed select
 * plays the UI press (haptic and sound) and calls `onSelect`. A disabled plate shows hover but does not select.
 */
export function bindPlate(app: XrApp, plate: Plate, id: string, onSelect: (e: InteractionEvent) => void): Unsubscribe {
  const fb = uiFeedback(app);
  const hovering = new Set<number>();
  return app.input.bind(plate.hit, { id, ray: true, poke: true }, (e) => {
    switch (e.type) {
      case 'hover-start':
        if (hovering.size === 0) fb.play('ui-hover', undefined, e);
        hovering.add(e.pointer.id);
        plate.hover(true);
        break;
      case 'hover-end':
        hovering.delete(e.pointer.id);
        if (hovering.size === 0) {
          plate.hover(false);
          plate.press(false);
        }
        break;
      case 'select-start':
        plate.press(true);
        break;
      case 'select-end':
        plate.press(false);
        break;
      case 'select':
        if (plate.look.disabled) return;
        fb.play('ui-press', e.point, e);
        onSelect(e);
        break;
      default:
        break;
    }
  });
}
