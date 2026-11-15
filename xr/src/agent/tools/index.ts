/** Agent tools: function declarations and the executor that maps each call onto the app's own seams (stub). */
import type { FeatureModule } from '../../contracts/app';

export const toolsModule: FeatureModule = {
  id: 'agent/tools',
  mount: () => () => undefined,
};
