/** Room size: the board on the floor at room size, entered and left by a fade, with teleport and the near-eye fade (stub). */
import type { FeatureModule } from '../../contracts/app';

export const roomModule: FeatureModule = {
  id: 'scale/room',
  mount: () => () => undefined,
};
