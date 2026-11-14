/** Hand flight: gimbal stick rings, the Arm hold plate, guide flight (issue #123). */
import type { FeatureModule } from '../../../contracts/app';

export const handsModule: FeatureModule = {
  id: 'range/flight/hands',
  mount: () => () => undefined,
};
