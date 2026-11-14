/** The drone bench: assembly in build order, wiring, bench tests and the design panel (issue #121). */
import type { FeatureModule } from '../../../contracts/app';

export const benchModule: FeatureModule = {
  id: 'range/flight/bench',
  mount: () => () => undefined,
};
