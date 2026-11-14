/**
 * Pillar 1, Bench (build): parts shelf, grab, snap legs into holes, wire pin to pin, take apart, undo and redo.
 * The bench space itself (bench/space.ts) is created by app.ts so every pillar has it; this module adds the building.
 */
import type { FeatureModule } from '../contracts/app';

export const benchModule: FeatureModule = {
  id: 'bench',
  mount: () => () => undefined,
};
