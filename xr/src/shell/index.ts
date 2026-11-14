/** Pillar 6, Shell: spatial home menu, settings, mode switch (MR, VR), recentre. The 2D launcher lives in the Next app. */
import type { FeatureModule } from '../contracts/app';

export const shellModule: FeatureModule = {
  id: 'shell',
  mount: () => () => undefined,
};
