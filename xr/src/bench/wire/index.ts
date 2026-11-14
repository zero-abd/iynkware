/** Wiring: draw a jumper from a pin or hole to another with a pinch or the trigger (stub). */
import type { FeatureModule } from '../../contracts/app';

export const wireModule: FeatureModule = {
  id: 'bench/wire',
  mount: () => () => undefined,
};
