/**
 * The look kit (the Art lead's folder): iynk's palette, ink, light, motion and effects for every pillar. This module is
 * mounted first (features.ts) and owns what belongs to no pillar: the stage around the bench and the shared motion
 * runner. Pillars import the kit's pieces from `xr/src/look/*`; they never copy colours or easings.
 */
import type { FeatureModule } from '../contracts/app';

export const lookModule: FeatureModule = {
  id: 'look',
  mount: () => () => undefined,
};
