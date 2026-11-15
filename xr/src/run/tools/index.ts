/**
 * Tools on the bench: the multimeter and its probes, the scope probe and its screen, and the serial panel. The
 * probes share one list of pins and holes and one net lookup, built here.
 */
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { mountMeter } from './meter';
import { createAnchorIndex } from './probes/anchors';
import { createNetLookup } from './probes/netcache';
import { mountScope } from './scope';
import { mountSerial } from './serial';

export const toolsModule: FeatureModule = {
  id: 'run/tools',
  mount(app: XrApp): Unsubscribe {
    const anchors = createAnchorIndex(app);
    const nets = createNetLookup(app);
    const offs = [mountMeter(app, anchors, nets), mountScope(app, anchors, nets), mountSerial(app)];
    return () => {
      for (const off of offs) off();
      anchors.dispose();
    };
  },
};
