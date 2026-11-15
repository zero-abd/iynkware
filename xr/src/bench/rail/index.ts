/**
 * The bench's part of the front rail (design 2.1, 2.3, 3.2, 3.3, 4): Undo and Redo plates (poke and ray, 48 mm, lying
 * on the rail's tilt, greyed when there is nothing to do), A or X undoing as well while the bench is the place, and the
 * ticker, one inked line naming the last event ("Undid: wire"), fading after 4 s. Everything sits on `app.bench.table`
 * and follows the posture and the dominant hand live. The ticker is fed through `benchKit(app).feedback.ticker`.
 */
import { Group, type Mesh, type MeshBasicMaterial } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe, Vec3 } from '../../contracts/common';
import type { Hand } from '../../contracts/input';
import { paintPill, paintText, useFont } from '../../look/paint';
import { easeIynk } from '../../look/motion';
import { INK } from '../../look/palette';
import { onLookFrame, motionOf } from '../../look/runner';
import { dmm, TYPE } from '../../look/type';
import { benchGeometry } from '../core/geometry';
import { benchKit } from '../core/kit';
import { say } from '../core/text';
import { benchPlate, bindPlate, canvasFace, type Face } from '../core/ui';
import { removeBound } from '../wire/entities';
import { RAIL_STRINGS } from './strings';
import { railEnabled, tickerText } from './text';

/** How long the ticker line stays before it fades, and how long the fade takes, ms. */
export const TICKER_HOLD_MS = 4000;
export const TICKER_FADE_MS = 400;
const PLATE = 0.048;
const TICKER_W = 0.14;
const TICKER_H = 0.036;
const DISTANCE = 0.47;

export const railModule: FeatureModule = {
  id: 'bench/rail',
  mount: (app) => mountRail(app),
};

function mountRail(app: XrApp): Unsubscribe {
  const feedback = benchKit(app).feedback;
  const offs: Unsubscribe[] = [];
  const group = new Group();
  group.name = 'bench:rail';
  app.bench.table.add(group);

  const undoPlate = benchPlate(app, { w: PLATE, d: PLATE }, { icon: 'undo', label: say(app, RAIL_STRINGS, 'rail.undo') });
  const redoPlate = benchPlate(app, { w: PLATE, d: PLATE }, { icon: 'redo', label: say(app, RAIL_STRINGS, 'rail.redo') });
  group.add(undoPlate.group, redoPlate.group);

  const refresh = () => {
    const on = railEnabled(app.project.canUndo(), app.project.canRedo());
    undoPlate.set({ label: say(app, RAIL_STRINGS, 'rail.undo'), disabled: !on.undo });
    redoPlate.set({ label: say(app, RAIL_STRINGS, 'rail.redo'), disabled: !on.redo });
    // readable by the emulator check (the state is otherwise only painted)
    undoPlate.group.userData.disabled = !on.undo;
    redoPlate.group.userData.disabled = !on.redo;
  };

  // where the plates and the ticker are: on the rail's tilt, mirrored by the dominant hand
  let tickerFace: Face | null = null;
  const place = () => {
    const xr = app.settings.xr.value;
    const g = benchGeometry(xr.posture, xr.dominantHand);
    group.position.set(0, g.rail.raise, g.rail.z);
    group.rotation.set(g.rail.tiltRad, 0, 0, 'YXZ');
    undoPlate.group.position.set(g.slots.undo, 0, 0);
    redoPlate.group.position.set(g.slots.redo, 0, 0);
    if (tickerFace) tickerFace.mesh.position.set(g.slots.ticker, 0.0012, 0);
  };

  // ---- the ticker ----------------------------------------------------------------------------------------------------
  const material = (): MeshBasicMaterial | null => (tickerFace ? (tickerFace.mesh.material as MeshBasicMaterial) : null);
  let hold: ReturnType<typeof setTimeout> | null = null;
  const show = (text: string) => {
    if (!tickerFace) {
      tickerFace = canvasFace(TICKER_W, TICKER_H, { distanceM: DISTANCE, up: true, radius: TICKER_H / 2 });
      (tickerFace.mesh as Mesh).name = 'bench:ticker';
      group.add(tickerFace.mesh);
      place();
    }
    const face = tickerFace;
    const m = material()!;
    face.mesh.userData.text = text;
    face.draw(text, (g, w, h) => {
      const border = Math.max(3, h * 0.07);
      paintPill(g, 0, 0, w, h, { border, shadow: Math.round(h * 0.1) });
      let px = dmm(TYPE.label.size, DISTANCE) * face.pxPerM;
      const maxW = w - h * 1.1;
      useFont(g, TYPE.label, px, text);
      const wide = g.measureText(text).width;
      if (wide > maxW) px *= Math.max(0.7, maxW / wide);
      paintText(g, text, w / 2, h / 2, TYPE.label, px, INK, 'center');
    });
    if (hold) clearTimeout(hold);
    motionOf(app.world).cancel(face.mesh);
    m.opacity = 1;
    face.mesh.visible = true;
    hold = setTimeout(() => {
      hold = null;
      motionOf(app.world).tween({
        key: face.mesh,
        ms: TICKER_FADE_MS,
        ease: easeIynk,
        onUpdate: (k) => (m.opacity = 1 - k),
        onDone: () => (face.mesh.visible = false),
      });
    }, TICKER_HOLD_MS);
  };
  offs.push(feedback.onTicker(show));

  // ---- undo and redo -------------------------------------------------------------------------------------------------
  const worldOfPlate = (plate: { group: Group }): Vec3 => {
    const v = plate.group.getWorldPosition(plate.group.position.clone());
    return [v.x, v.y, v.z];
  };
  const run = (kind: 'undo' | 'redo', hand: Hand | null) => {
    const r = kind === 'undo' ? app.project.undo() : app.project.redo();
    if (!r) return;
    if (r.ok) {
      feedback.play('undo', worldOfPlate(kind === 'undo' ? undoPlate : redoPlate), hand);
      feedback.ticker(tickerText(app.settings.lang.value, kind, r.inverse));
    }
  };
  offs.push(bindPlate(app, undoPlate, 'bench/rail/undo', (e) => run('undo', e.pointer.hand)));
  offs.push(bindPlate(app, redoPlate, 'bench/rail/redo', (e) => run('redo', e.pointer.hand)));

  // A or X undoes while the bench is the place (the Range's flight room reads A for itself)
  const held: Record<Hand, boolean> = { left: true, right: true };
  offs.push(
    onLookFrame(app.world, () => {
      for (const hand of ['left', 'right'] as Hand[]) {
        const down = app.input.button(hand, 'lower').pressed;
        const edge = down && !held[hand];
        held[hand] = down;
        if (edge && app.shell.place.value === 'bench') run('undo', hand);
      }
    }),
  );

  // the session notifies before it records the undo entry, so `canUndo` is read a moment later
  offs.push(app.project.subscribe(() => queueMicrotask(refresh)));
  offs.push(app.settings.lang.subscribe(refresh));
  offs.push(app.settings.xr.subscribe(place));
  refresh();
  place();

  return () => {
    for (const off of offs) off();
    if (hold) clearTimeout(hold);
    if (tickerFace) {
      motionOf(app.world).cancel(tickerFace.mesh);
      tickerFace.dispose();
    }
    removeBound(app, group);
    undoPlate.dispose();
    redoPlate.dispose();
  };
}
