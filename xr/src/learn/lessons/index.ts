/** Lessons: the step panel and its checks, from the template lesson data (stub). */
import type { FeatureModule } from '../../contracts/app';
import { attachLessons } from '../session';

export const lessonsModule: FeatureModule = {
  id: 'learn/lessons',
  mount: (app) => attachLessons(app),
};
