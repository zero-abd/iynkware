/** Space: passthrough or the paper room (an opaque dome inside the same session), and hand occlusion (stub). */
import type { FeatureModule } from '../../contracts/app';

export const spaceModule: FeatureModule = {
  id: 'scale/space',
  mount: () => () => undefined,
};
