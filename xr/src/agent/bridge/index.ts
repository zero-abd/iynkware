/** The agent bridge: the one object a voice or text client uses (tools, call, context, observe, say) (stub). */
import type { FeatureModule } from '../../contracts/app';

export const bridgeModule: FeatureModule = {
  id: 'agent/bridge',
  mount: () => () => undefined,
};
