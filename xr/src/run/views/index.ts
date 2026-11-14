/** Part views: registers a view per part ref (and a fallback per readout kind). Each view is one file here. */
import type { FeatureModule } from '../../contracts/app';
import { ledView } from './led';

export const viewsModule: FeatureModule = {
  id: 'run/views',
  mount(app) {
    app.views.register({ ref: 'core.led-5mm' }, ledView);
    app.views.register({ kind: 'led' }, ledView);
    return () => undefined;
  },
};
