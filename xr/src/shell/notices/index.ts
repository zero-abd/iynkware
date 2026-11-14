/** Notices and guard states: update ready, storage full, hands not seen, shown from `app.shell.notices` (stub). */
import type { FeatureModule } from '../../contracts/app';

export const noticesModule: FeatureModule = {
  id: 'shell/notices',
  mount: () => () => undefined,
};
