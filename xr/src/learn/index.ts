/**
 * Pillar 3, Learn: lessons, checks and callouts as a spatial guide. `lessons` first: it plugs the session into
 * `app.lessons`, which the catalogue and onboarding then use.
 */
import { composeModules } from '../compose';
import { lessonsModule } from './lessons';
import { calloutsModule } from './callouts';
import { catalogueModule } from './catalogue';
import { onboardingModule } from './onboarding';

export const learnModule = composeModules('learn', [lessonsModule, calloutsModule, catalogueModule, onboardingModule]);
