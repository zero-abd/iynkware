/** Lessons: the lesson session (steps, real checks, completion, the launcher) and the guide panel beside the bench. */
import type { FeatureModule } from '../../contracts/app';
import { attachLessons } from '../session';
import { mountGuidePanel } from './panel';

export const lessonsModule: FeatureModule = {
  id: 'learn/lessons',
  mount(app) {
    const offSession = attachLessons(app);
    const offPanel = mountGuidePanel(app);
    return () => {
      offPanel();
      offSession();
    };
  },
};
