/**
 * One corner button, inked with the look kit in the shell kit's anatomy (paper plate, ink outline, flat blue shadow
 * plate, Phosphor icon over a label). Hover lifts it before commit and the edge turns accent; a press sinks it. A plain
 * button runs `onSelect` on a completed select. A holding button (Exit) runs `onHold` only after the press has been kept
 * for `holdMs`: an accent wipe rises from its base and a ring fills round the icon, and letting go early empties both.
 * Bound through `app.input.bind`, so a controller ray and trigger, a hand pinch on the ray, a fingertip poke and the mouse
 * all work.
 */
import { Group } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { InteractionEvent } from '../../contracts/input';
import type { IconName } from '../../look/icons';
import { hoverLift, pressTravel } from '../../look/moves';
import { fitLines, paintIcon, paintPlate, PLATE } from '../../look/paint';
import { ACCENT, INK, PAPER, SHADOW } from '../../look/palette';
import { dmm, TYPE } from '../../look/type';
import { dropEntities, ownEntity } from '../kit/entity';
import { canvasFace, type Face } from '../kit/face';
import { createHold, type HoldGuard } from './hold';

export interface SessionButtonOptions {
  id: string;
  w: number;
  h: number;
  distanceM: number;
  icon: IconName;
  /** Runs on a completed select. */
  onSelect?(e: InteractionEvent): void;
  /** Present: the button is a hold-to-confirm. Runs once the press has lasted `ms`. */
  hold?: { ms: number; onDone(e: InteractionEvent | null): void };
}

export interface SessionButton {
  readonly group: Group;
  readonly mesh: Face['mesh'];
  /** The label shown at rest; `hint` replaces it while hovered or held (the hold instruction). */
  set(look: { label: string; hint?: string }): void;
  /** Advances a hold by `dtMs`; a no-op on a plain button. */
  tick(dtMs: number): void;
  readonly holdProgress: number;
  setOpacity(a: number): void;
  dispose(): void;
}

/** Ring and wipe move in 24ths, so the face repaints at most 24 times per hold. */
const STEPS = 24;

export function sessionButton(app: XrApp, o: SessionButtonOptions, initial: { label: string; hint?: string }): SessionButton {
  const group = new Group();
  group.name = `session-button:${o.id}`;
  ownEntity(app.world, group);
  const lift = new Group();
  group.add(lift);
  const face = canvasFace(o.w, o.h, o.distanceM, { hit: true, order: 22 });
  face.mesh.name = `button:${o.id}`;
  lift.add(face.mesh);
  let look = { ...initial };
  let state: 'idle' | 'hover' | 'press' = 'idle';
  let hovering = 0;
  let lastEvent: InteractionEvent | null = null;
  const travel = dmm(3, o.distanceM);

  const guard: HoldGuard | null = o.hold ? createHold(o.hold.ms, () => finish()) : null;
  function finish() {
    if (!o.hold) return;
    if (lastEvent?.pointer.source === 'controller' && lastEvent.pointer.hand) app.input.pulse(lastEvent.pointer.hand, 0.8, 40);
    o.hold.onDone(lastEvent);
  }

  const paint = () => {
    const p = guard ? Math.round(guard.progress * STEPS) / STEPS : 0;
    const showHint = !!look.hint && (state !== 'idle' || p > 0);
    face.draw(JSON.stringify([look.label, look.hint, state, p, showHint]), (g, w, h) => {
      const px = face.px;
      const shadow = Math.min(PLATE.shadow * px, h * 0.12);
      const border = PLATE.border * px;
      const radius = Math.min(PLATE.radius * px, h * 0.3);
      const fill = state === 'press' && !guard ? ACCENT : PAPER;
      paintPlate(g, 0, 0, w, h, { fill, ink: state === 'idle' ? INK : state === 'press' ? INK : ACCENT, border: state === 'idle' ? border : border * 1.4, radius, shadow, shadowColor: SHADOW });
      const iw = w - shadow;
      const ih = h - shadow;
      if (p > 0) {
        // The wipe: accent rising from the base, clipped to the plate.
        g.save();
        g.beginPath();
        g.roundRect(border / 2, border / 2, iw - border, ih - border, radius);
        g.clip();
        g.fillStyle = ACCENT;
        g.fillRect(0, ih * (1 - p), iw, ih * p);
        g.restore();
        g.lineWidth = border;
        g.strokeStyle = INK;
        g.beginPath();
        g.roundRect(border / 2, border / 2, iw - border, ih - border, radius);
        g.stroke();
      }
      const icon = 36 * px;
      const labelPx = TYPE.label.size * px;
      const gap = labelPx * 0.3;
      const label = fitLines(g, showHint ? look.hint! : look.label, { role: TYPE.label, size: labelPx, maxWidth: iw * 0.92, maxLines: 1 });
      const top = (ih - icon - gap - label.lineHeight) / 2;
      const cx = iw / 2;
      paintIcon(g, o.icon, cx - icon / 2, top, icon, INK);
      if (p > 0) {
        g.strokeStyle = INK;
        g.lineWidth = Math.max(2, icon * 0.09);
        g.lineCap = 'round';
        g.beginPath();
        g.arc(cx, top + icon / 2, icon * 0.78, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
        g.stroke();
      }
      g.fillStyle = INK;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label.lines[0] ?? '', cx, top + icon + gap + label.lineHeight / 2);
    });
  };
  paint();

  const buzz = (e: InteractionEvent, intensity: number, ms: number) => {
    if (e.pointer.source === 'controller' && e.pointer.hand) app.input.pulse(e.pointer.hand, intensity, ms);
  };
  // Session controls stay reachable, but yield when they visually overlap a work control on a large bench (the
  // drone build's XT60 and camera plates sit behind this cluster from some seated head poses).
  const off = app.input.bind(face.mesh, { id: o.id, ray: true, poke: true, kind: 'panel' }, (e) => {
    switch (e.type) {
      case 'hover-start':
        hovering++;
        state = state === 'press' ? 'press' : 'hover';
        hoverLift(app.world, lift, travel, true);
        buzz(e, 0.08, 8);
        break;
      case 'hover-end':
        hovering = Math.max(0, hovering - 1);
        guard?.release(e.pointer.id);
        if (hovering === 0) {
          state = 'idle';
          hoverLift(app.world, lift, travel, false);
          pressTravel(app.world, face.mesh, travel, false, 'z');
        }
        break;
      case 'select-start':
        state = 'press';
        lastEvent = e;
        guard?.press(e.pointer.id);
        pressTravel(app.world, face.mesh, travel, true, 'z');
        buzz(e, 0.35, 12);
        break;
      case 'select-end':
        guard?.release(e.pointer.id);
        state = hovering > 0 ? 'hover' : 'idle';
        pressTravel(app.world, face.mesh, travel, false, 'z');
        break;
      case 'select':
        if (!guard) o.onSelect?.(e);
        break;
      default:
        return;
    }
    paint();
  });

  return {
    group,
    mesh: face.mesh,
    set(next) {
      look = { ...look, ...next };
      paint();
    },
    tick(dtMs) {
      if (!guard?.holding) return;
      guard.tick(dtMs);
      paint();
    },
    get holdProgress() {
      return guard?.progress ?? 0;
    },
    setOpacity: (a) => face.setOpacity(a),
    dispose() {
      off();
      dropEntities(app.world, group);
      face.dispose();
    },
  };
}
