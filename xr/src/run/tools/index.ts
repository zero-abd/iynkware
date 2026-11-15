/** Tools on the bench: the multimeter and its probes, then the scope probe and screen and the serial panel. */
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { mountMeter } from './meter';

export const toolsModule: FeatureModule = {
  id: 'run/tools',
  mount(app: XrApp): Unsubscribe {
    const offs = [mountMeter(app)];
    return () => {
      for (const off of offs) off();
    };
  },
};
