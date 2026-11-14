/** Pillar 1, Bench (build). The bench space itself (bench/space.ts) is made by app.ts so every pillar has it. */
import { composeModules } from '../compose';
import { shelfModule } from './shelf';
import { wireModule } from './wire';
import { editModule } from './edit';
import { poseModule } from './pose';

export const benchModule = composeModules('bench', [shelfModule, wireModule, editModule, poseModule]);
