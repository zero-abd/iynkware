/** FPV and chase on a world-locked screen at 15 Hz (issue #125). */
import type { FeatureModule } from '../../../contracts/app';

export const screenModule: FeatureModule = {
  id: 'range/flight/screen',
  mount: () => () => undefined,
};
