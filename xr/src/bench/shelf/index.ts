/** Parts shelf: pick a part from the shelf and seat it in the breadboard or on the bench (stub). */
import type { FeatureModule } from '../../contracts/app';

export const shelfModule: FeatureModule = {
  id: 'bench/shelf',
  mount: () => () => undefined,
};
