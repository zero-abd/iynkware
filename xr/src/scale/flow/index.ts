/** Flow: current along wires and traces and node voltages, from the running simulation's analog readouts (stub). */
import type { FeatureModule } from '../../contracts/app';

export const flowModule: FeatureModule = {
  id: 'scale/flow',
  mount: () => () => undefined,
};
