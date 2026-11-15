/**
 * A plate button: an inked slab with its icon and label printed on top (9.1, 9.4), for the run cluster, the meter's
 * dial positions, the scope and serial panels and the fault deck. It shows hover before commit (the plate lifts 3 dmm
 * and its edge turns accent), sinks and fills on press (section 4), and can carry a badge and a filling ring. Lies on
 * the bench (faces +y) or stands in a panel (faces +z).
 *
 *   const run = plateButton(app, { w: 0.07, d: 0.06 }, { icon: 'run', label: s.t(lang, 'run'), lang, primary: true });
 *   cluster.add(run.group);
 *   const off = bindPlate(app, run, 'run', (e) => void start());
 *
 * Adapter: the spatial UI kit (#23) and the look kit will own buttons; switch when they land and keep the call sites.
 */
import { Group, type Mesh } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Lang, Unsubscribe } from '../../contracts/common';
import type { InteractionEvent } from '../../contracts/input';
import { canvasFace, fitLine, roundRect, scriptScale, SANS } from './face';
import { drawIcon, type IconName } from './icons';
import { inkShadow, inkSolid, roundedSlab } from './ink';
import { animated, MOTION } from './motion';
import { runFeedback } from './feedback';
import { dmm, INK, TYPE } from './tokens';

export type BadgeTone = 'accent' | 'warn' | 'bad' | 'info' | 'good';

export interface PlateLook {
  icon: IconName | null;
  label: string;
  lang: Lang;
  disabled?: boolean;
  /** A short tag on the top edge (`Away`, `Restart to apply`). */
  badge?: { text: string; tone: BadgeTone } | null;
  /** A ring filling round the icon, 0..1 (Compiling, Uploading), or null. */
  progress?: number | null;
  /** Shown filled, as pressed in (a latched control, the current dial position). */
  latched?: boolean;
}

export interface PlateSize {
  /** Width along x and depth (along z lying, along y standing), metres. */
  w: number;
  d: number;
  /** Thickness. Default 8 mm. */
  h?: number;
  /** Viewing distance for the text size, metres. Default the rail's 0.47. */
  distanceM?: number;
  /** Stands in a panel facing +z instead of lying on the bench. */
  standing?: boolean;
  /** Accent through and through with an ink label: the one primary control of a group (Run, Apply). */
  primary?: boolean;
}

export interface Plate {
  /** Add this to the scene: centred on its footprint, y = 0 at its base (or its back, standing). */
  readonly group: Group;
  /** The mesh to bind; its face, outline and shadow take no rays. */
  readonly hit: Mesh;
  readonly look: Readonly<PlateLook>;
  set(patch: Partial<PlateLook>): void;
  hover(on: boolean): void;
  press(on: boolean): void;
  dispose(): void;
}

const BADGE_FILL: Record<BadgeTone, string> = { accent: INK.accent, warn: INK.warn, bad: INK.bad, info: INK.info, good: INK.good };

export function plateButton(app: Pick<XrApp, 'world' | 'settings'>, size: PlateSize, initial: PlateLook): Plate {
  const h = size.h ?? 0.008;
  const dist = size.distanceM ?? 0.47;
  const radius = Math.min(size.w, size.d) * 0.16;
  const primary = !!size.primary;
  const group = new Group();
  const lift = new Group();
  group.add(lift);
  const solid = inkSolid(roundedSlab(size.w, size.d, h, radius), primary ? INK.accent : INK.paper);
  lift.add(solid.group);
  const shadow = inkShadow(size.w, size.d, radius);
  shadow.raycast = () => undefined;
  if (!size.standing) group.add(shadow);
  const face = canvasFace(size.w * 0.94, size.d * 0.94, { distanceM: dist, up: true, radius: radius * 0.9 });
  face.mesh.position.y = h + 0.0003;
  solid.body.add(face.mesh);
  if (size.standing) group.rotation.x = Math.PI / 2;

  const look: PlateLook = { ...initial };
  let hovered = false;
  let pressed = false;
  const rest = primary ? INK.accent : INK.paper;

  const redraw = () => {
    const fill = pressed || look.latched ? INK.accent : rest;
    const fg = look.disabled ? INK.muted : INK.ink;
    const key = JSON.stringify([look.icon, look.label, look.lang, look.disabled, look.badge, look.progress == null ? null : look.progress.toFixed(2), fill]);
    face.draw(key, (g, w, hpx) => {
      const px = face.pxPerM;
      if (fill !== rest) {
        g.fillStyle = fill;
        roundRect(g, 0, 0, w, hpx, radius * 0.9 * px);
        g.fill();
      }
      const icon = dmm(32, dist) * px;
      const label = dmm(TYPE.caption, dist) * px * scriptScale(look.lang);
      const gap = label * 0.35;
      const top = (hpx - (look.icon ? icon + gap : 0) - label) / 2 + (look.badge ? label * 0.35 : 0);
      if (look.icon) {
        drawIcon(g, look.icon, w / 2, top + icon / 2, icon, fg);
        if (look.progress != null) {
          g.strokeStyle = INK.ink;
          g.lineWidth = Math.max(2, icon * 0.08);
          g.lineCap = 'round';
          g.beginPath();
          const p = Math.min(1, Math.max(0, look.progress));
          g.arc(w / 2, top + icon / 2, icon * 0.66, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
          g.stroke();
        }
      }
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitLine(g, look.label, w / 2, top + (look.icon ? icon + gap : 0) + label / 2, w * 0.9, label);
      if (look.badge) {
        const bh = label * 1.1;
        g.font = `600 ${label * 0.78}px ${SANS}`;
        const bw = Math.min(w * 0.96, g.measureText(look.badge.text).width + bh);
        g.fillStyle = BADGE_FILL[look.badge.tone];
        roundRect(g, (w - bw) / 2, hpx * 0.03, bw, bh, bh / 2);
        g.fill();
        g.fillStyle = look.badge.tone === 'accent' ? INK.ink : INK.paper;
        fitLine(g, look.badge.text, w / 2, hpx * 0.03 + bh / 2, bw - bh * 0.5, label * 0.78, SANS, 600);
      }
    });
  };

  const liftBy = dmm(3, dist);
  const lifted = animated(app, 0, (v) => (lift.position.y = v));
  const outline = () => solid.setOutline(hovered && !look.disabled && !primary ? INK.accent : INK.ink);
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
      if (!pressed) lifted.to(on && !look.disabled ? liftBy : 0, on ? 0 : MOTION.hoverOff);
    },
    press(on) {
      pressed = on && !look.disabled;
      lifted.to(pressed ? -liftBy * 0.6 : hovered ? liftBy : 0, pressed ? MOTION.press : MOTION.release);
      redraw();
    },
    dispose() {
      lifted.dispose();
      face.dispose();
      solid.dispose();
      shadow.geometry.dispose();
      group.removeFromParent();
    },
  };
}

/**
 * Binds a plate with ray and poke: hover lifts it (with the barely-felt hover buzz), a press sinks it, a completed
 * select plays the UI press and calls `onSelect`. A disabled plate shows hover but does not select.
 */
export function bindPlate(app: XrApp, plate: Plate, id: string, onSelect: (e: InteractionEvent) => void): Unsubscribe {
  const fb = runFeedback(app);
  const hovering = new Set<number>();
  return app.input.bind(plate.hit, { id, ray: true, poke: true, kind: 'control' }, (e) => {
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
