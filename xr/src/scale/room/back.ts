/**
 * The small "Back to bench" panel, shown only at Room size: 1.2 m away, 30 degrees below eye level, built with the
 * shell's panel kit (a paper plate, never a bare plane). It re-places itself only when the head's heading differs from
 * the heading it was placed at by more than 40 degrees. The body has room below the button for the teleport switch
 * a later slice adds (#276).
 */
import { Vector3 } from '@iwsdk/core';
import type { Unsubscribe } from '../../contracts/common';
import type { XrApp } from '../../contracts/app';
import { shellButton, type ShellButton } from '../../shell/kit/button';
import { shellPanel, type ShellPanel } from '../../shell/kit/panel';
import { placeAhead } from '../../shell/kit/place';
import { tr } from '../kit/text';
import { headingOf, needsReplace } from './size';
import { ROOM_STRINGS } from './strings';

const DISTANCE = 1.2;
const BELOW_DEG = 30;
/** Panel size in metres at `DISTANCE`. Its lower part is left free for the teleport switch (#276). */
const PANEL_W = 0.5;
const PANEL_H = 0.3;

export interface BackPanel {
  /** Shows or hides the panel. Showing places it ahead of the head. */
  show(on: boolean): void;
  /** Call each frame: re-places the panel when the head has turned far from it. */
  tick(): void;
  dispose(): void;
}

export function createBackPanel(app: XrApp, onBack: () => void): BackPanel {
  const lang = () => app.settings.lang.value;
  const panel: ShellPanel = shellPanel(app, { id: 'room-back', w: PANEL_W, h: PANEL_H, distanceM: DISTANCE, title: tr(ROOM_STRINGS, lang(), 'title'), poke: true });
  const button: ShellButton = shellButton(
    app,
    { id: 'room/back', w: panel.inner, h: 0.1, distanceM: DISTANCE, poke: true, onSelect: onBack },
    { label: tr(ROOM_STRINGS, lang(), 'back'), icon: 'exit', layout: 'center', primary: true },
  );
  panel.add(button, 0, panel.top - 0.07);

  const dir = new Vector3();
  let placedHeading = 0;
  let shown = false;
  const headHeading = (): number | null => {
    app.world.camera.getWorldDirection(dir);
    // Looking almost straight up or down says nothing about heading.
    if (Math.hypot(dir.x, dir.z) < 0.25) return null;
    return headingOf(dir.x, dir.z);
  };
  const place = () => {
    placeAhead(app.world, panel.group, { distance: DISTANCE, belowDeg: BELOW_DEG });
    placedHeading = headHeading() ?? placedHeading;
  };

  const offLang: Unsubscribe = app.settings.lang.subscribe(() => {
    panel.setTitle(tr(ROOM_STRINGS, lang(), 'title'));
    button.set({ label: tr(ROOM_STRINGS, lang(), 'back') });
  });

  return {
    show(on) {
      if (on === shown) return;
      shown = on;
      if (on) {
        place();
        panel.open();
      } else panel.close();
    },
    tick() {
      if (!shown) return;
      const h = headHeading();
      if (h !== null && needsReplace(placedHeading, h)) place();
    },
    dispose() {
      offLang();
      shown = false;
      panel.dispose();
    },
  };
}
