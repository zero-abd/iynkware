/**
 * Callouts: the project's own `guide.callouts` as labels on their parts, in the person's language (canvas text, so
 * Devanagari and Chinese draw with the browser's fonts).
 */
import { pickText } from '../../contracts/common';
import type { FeatureModule } from '../../contracts/app';
import { calloutTargets } from '../guide';

export const calloutsModule: FeatureModule = {
  id: 'learn/callouts',
  mount(app) {
    const draw = () => {
      app.overlay.clear('guide');
      for (const c of calloutTargets(app.project.doc)) {
        app.overlay.show({ owner: 'guide', target: c.target, tone: 'info', style: 'label', text: pickText(c.text, app.settings.lang.value) });
      }
    };
    const offs = [app.bench.onLayout(draw), app.settings.lang.subscribe(draw)];
    draw();
    return () => {
      offs.forEach((off) => off());
      app.overlay.clear('guide');
    };
  },
};
