/**
 * Pillar 8, Lab: training labs beyond circuits (chemistry, physics, bench instruments). Equipment the person places and
 * works by hand, guided experiments with checks, and a tutor that says what to do next and what went wrong. `model`
 * first: the items' own state, which `items` draws and `experiments` and `tutor` read.
 */
import { composeModules } from '../compose';
import { modelModule } from './model';
import { itemsModule } from './items';
import { experimentsModule } from './experiments';
import { dataModule } from './data';
import { elementsModule } from './elements';

export const labModule = composeModules('lab', [modelModule, itemsModule, experimentsModule, dataModule, elementsModule]);
