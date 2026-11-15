/**
 * The onboarding detectors: a small local adapter from the app's real events to `StepEvent`s. It only reads: the input
 * service's `onAny`, the project's DocChange ops, the sim's run state, and the menu panel being open in the scene.
 */
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { onLookFrame } from '../../look/runner';
import type { StepEvent } from './steps';

/** Pure: does an input event count as moving a panel by its grip or title handle? */
export const isPanelMove = (target: string): boolean => /(^|[/:._-])(move|grip)$/.test(target);

/** Pure: a grab of anything that is not part of an interface panel. */
export const isPartGrab = (target: string): boolean => !/^(onboarding|session|menu|home|shell)\//.test(target) && !isPanelMove(target);

const PANEL_MOVED_M = 0.06;
const MENU_NAME = 'shell-panel:menu';

export function detect(app: XrApp, emit: (e: StepEvent) => void, panel: () => { x: number; y: number; z: number } | null): Unsubscribe {
  const offs: Unsubscribe[] = [];

  offs.push(
    app.input.onAny((e) => {
      if (e.type === 'grab-start' && isPartGrab(e.target)) emit('grab');
      if ((e.type === 'grab-start' || e.type === 'select-start' || e.type === 'drag-move' || e.type === 'grab-move') && isPanelMove(e.target)) emit('move');
      if (e.type === 'select' && e.target === 'session/recentre') emit('recentre');
    }),
  );

  offs.push(app.project.subscribe((change) => (change.origin === 'local' || change.origin === 'ai') && change.ops.some((o) => o.k === 'wire.add') && emit('wire')));
  offs.push(app.sim.onState((s) => s === 'running' && emit('run')));

  let frame = 0;
  let home: { x: number; y: number; z: number } | null = null;
  offs.push(
    onLookFrame(app.world, () => {
      if (app.input.button('left', 'stick').down) setTimeout(() => menuOpen() && emit('menu'), 350);
      frame++;
      if (frame % 6 === 0 && menuOpen()) emit('menu');
      // The onboarding panel's own move: it left where it was placed.
      const p = panel();
      if (!p) {
        home = null;
        return;
      }
      home ??= { ...p };
      if (Math.hypot(p.x - home.x, p.y - home.y, p.z - home.z) > PANEL_MOVED_M) emit('move');
    }),
  );

  const menuOpen = (): boolean => app.world.scene.getObjectByName(MENU_NAME)?.visible === true;
  return () => offs.splice(0).forEach((f) => f());
}
