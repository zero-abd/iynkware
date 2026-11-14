/** Pillar 3, Learn: lessons, checks and callouts as a spatial guide. */
import { composeModules } from '../compose';
import { lessonsModule } from './lessons';
import { calloutsModule } from './callouts';

export const learnModule = composeModules('learn', [lessonsModule, calloutsModule]);
