/** The bench itself: move, raise and lower it, seated or standing, recentre (stub). */
import type { FeatureModule } from '../../contracts/app';

export const poseModule: FeatureModule = {
  id: 'bench/pose',
  mount: () => () => undefined,
};
