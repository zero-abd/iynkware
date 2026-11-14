/** The crash freeze, card and slow-motion replay with its timeline (issue #124). */
import type { FeatureModule } from '../../../contracts/app';

export const crashModule: FeatureModule = {
  id: 'range/flight/crash',
  mount: () => () => undefined,
};
