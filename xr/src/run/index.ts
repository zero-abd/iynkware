/** Pillar 2, Run and stress. Views first, so the controls find them when they build views. */
import { composeModules } from '../compose';
import { viewsModule } from './views';
import { controlsModule } from './controls';
import { inputsModule } from './inputs';

export const runModule = composeModules('run', [viewsModule, controlsModule, inputsModule]);
