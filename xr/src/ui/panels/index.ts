/**
 * Movable panels: the grip bar under every floating panel, where the person puts each one, and Tidy up. Shared code
 * the panel kits use (`shell/kit/panel.ts`, `learn/kit/panel.ts`, `run/tools/panel.ts`, `lab/kit/panel.ts`) and the
 * few panels built by hand call once; no panel needs code of its own to be moved.
 *
 *   drag.ts      the maths: hold by ray or by hand, 0.3 to 2 m from the eyes, never under the bench top
 *   store.ts     one place per panel id in the bench's frame, in localStorage (`iynk:xr:panels:v1`)
 *   registry.ts  the late pass that puts moved panels where they were left, notes each pillar's own place, tidies
 *   grip.ts      the inked grip bar, its hover and held looks, its input, and `movable(app, ...)`
 *   open.ts      `openable`: a panel or tool that starts closed and opens from its menu row (the calm layout)
 *   copy.ts      Tidy up and the menu rows of the calm layout, in six languages
 *   ring.ts      `placeInRing`: a panel in its slot of the bench's panel ring (`bench/core/ring.ts`)
 *
 * This module adds "Tidy up" to the menu: every panel goes back to where its pillar puts it.
 */
import type { FeatureModule } from '../../contracts/app';
import { PANELS_COPY } from './copy';
import { panelPlacesOf, tidyPanels } from './grip';

export { movable, onTidy, panelPlacesOf, tidyPanels, type Movable, type MovableOptions } from './grip';
export { REACH } from './drag';
export { openable, openState, type Openable, type OpenableOptions } from './open';
export { PANELS_COPY } from './copy';
export { PLACES_KEY } from './store';
export { placeInRing } from './ring';

export const panelsModule: FeatureModule = {
  id: 'ui/panels',
  mount(app) {
    panelPlacesOf(app);
    return app.shell.addMenuItem({ id: 'ui/tidy', group: 'view', label: PANELS_COPY.tidy, run: () => tidyPanels(app) });
  },
};
