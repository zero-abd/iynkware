/**
 * The first-flight hint (issue #314): a look-kit callout on the craft on its pad that says how to arm and what each
 * stick does, in the controller's words or the hands', until the craft first leaves the pad on a visit to the Range.
 * It reads `flightSceneOf` and the runner; it never touches the flight. In the headset only: the flat screen's keys
 * have their own line (`../desk`).
 */
import type { FeatureModule, XrApp } from '../../../contracts/app';
import { createCallout, fadeIn, langOf, onLookFrame, panelClose, type Callout } from '../../shared';
import type { Out3 } from '../core';
import { flightSceneOf, type FlightScene } from '../scene';
import { FirstFlightHint, hintInput, hintKey } from './logic';
import { HINT_STRINGS as S } from './strings';

/** The card stands this far below the eyes (metres), and never lower than this above the pad. */
const BELOW_EYES_M = 0.55;
const MIN_LIFT_M = 0.35;

interface Session {
  dispose(): void;
}

function start(app: XrApp, scene: FlightScene): Session {
  const { head, map, runner } = scene;
  const pad: Out3 = [0, 0, 0];
  map.toRoom(runner.frame.x, runner.frame.y, runner.frame.z, pad);
  const lift = Math.max(MIN_LIFT_M, head.y - BELOW_EYES_M - pad[1]);
  const distance = Math.hypot(pad[0] - head.x, pad[2] - head.z, head.y - pad[1] - lift);

  const hint = new FirstFlightHint();
  let key = hintKey('arm', hintInput(app.input.sources.value));
  const text = () => S.t(langOf(app), key);
  const callout: Callout = createCallout(text(), { distance, tone: 'do', lift, shape: 'card' });
  callout.group.name = 'range-hint';
  callout.group.position.set(pad[0], pad[1], pad[2]);
  callout.group.rotation.y = Math.atan2(-head.heading.fx, -head.heading.fz);
  scene.root.add(callout.group);
  const label = callout.group.getObjectByName('look:callout-label') as { material: { opacity: number } } | undefined;
  const setOpacity = (a: number) => {
    if (label) label.material.opacity = a;
  };
  setOpacity(0);
  fadeIn(app.world, setOpacity, { ms: 300 });

  let shown = true;
  let disposed = false;
  const off: Array<() => void> = [];
  off.push(app.settings.lang.subscribe(() => shown && callout.set(text())));
  off.push(
    onLookFrame(app.world, () => {
      if (!shown) return;
      const step = hint.step(runner.frame.armed, runner.frame.airborne);
      if (step === null) {
        shown = false;
        panelClose(app.world, callout.group, setOpacity);
        return;
      }
      // on the flat screen the keys fly it and the desk says which (`../desk`)
      callout.group.visible = app.mode.value !== 'flat';
      const next = hintKey(step, hintInput(app.input.sources.value));
      if (next === key) return;
      key = next;
      callout.set(text());
    }),
  );

  // for scripts and tests: the line shown now, or null once it has gone
  scene.root.userData.hint = () => (shown && app.mode.value !== 'flat' ? text() : null);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      delete scene.root.userData.hint;
      for (const d of off.splice(0).reverse()) d();
      callout.dispose();
    },
  };
}

export const hintModule: FeatureModule = {
  id: 'range/flight/hint',
  mount(app) {
    let session: Session | null = null;
    let current: FlightScene | null = null;
    const sync = (scene: FlightScene | null) => {
      if (scene === current) return;
      current = scene;
      session?.dispose();
      session = scene && !scene.here ? start(app, scene) : null;
    };
    const unsubscribe = flightSceneOf(app).subscribe(sync);
    sync(flightSceneOf(app).value);
    return () => {
      unsubscribe();
      session?.dispose();
      session = null;
    };
  },
};
