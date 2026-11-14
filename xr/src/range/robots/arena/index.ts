/** The robot arena: physics robots on the floor, driven by their running programs through the sim's mech frames (issue #126). */
import type { FeatureModule } from '../../../contracts/app';

export const arenaModule: FeatureModule = {
  id: 'range/robots/arena',
  mount: () => () => undefined,
};
