/** Installable app in the headset: says when an update is ready, through `app.shell.notify`, and never reloads in a session (stub). */
import type { FeatureModule } from '../../contracts/app';

export const pwaModule: FeatureModule = {
  id: 'shell/pwa',
  mount: () => () => undefined,
};
