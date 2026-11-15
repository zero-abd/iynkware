/**
 * The tools rack: where each tool lies on the bench for this posture and hand (`runLayout`, the kit's one source), and a
 * way to hear when that changes. A tool asks for its slot and places itself; nothing here draws.
 */
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { runLayout, type RunLayout } from '../kit/layout';

/** The run layout for the person's posture and dominant hand now. */
export function layoutNow(app: Pick<XrApp, 'settings'>): RunLayout {
  const xr = app.settings.xr.value;
  return runLayout(xr.posture, xr.dominantHand);
}

/** Calls `fn` with the layout now and again whenever posture or hand changes it. */
export function followLayout(app: Pick<XrApp, 'settings'>, fn: (layout: RunLayout) => void): Unsubscribe {
  let key = '';
  const run = () => {
    const xr = app.settings.xr.value;
    const next = `${xr.posture}/${xr.dominantHand}`;
    if (next === key) return;
    key = next;
    fn(runLayout(xr.posture, xr.dominantHand));
  };
  run();
  return app.settings.xr.subscribe(run);
}
