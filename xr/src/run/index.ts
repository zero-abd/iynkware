/** Pillar 2, Run and stress. Views first, so the controls find them when they build views. */
import { composeModules } from '../compose';
import { viewsModule } from './views';
import { controlsModule } from './controls';
import { inputsModule } from './inputs';
import { toolsModule } from './tools';
import { findingsModule } from './findings';
import { faultsModule } from './faults';
import { codeViewModule } from './code-view';

export const runModule = composeModules('run', [viewsModule, controlsModule, inputsModule, toolsModule, findingsModule, faultsModule, codeViewModule]);
