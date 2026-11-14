/** Fly in the room: the course mapped into the flight volume, the craft, controller sticks (issue #122). */
import type { FeatureModule } from '../../../contracts/app';

export const roomModule: FeatureModule = {
  id: 'range/flight/room',
  mount: () => () => undefined,
};
