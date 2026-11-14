/** Pillar 4, Scale and insight. */
import { composeModules } from '../compose';
import { zoomModule } from './zoom';
import { insightModule } from './insight';
import { probeModule } from './probe';

export const scaleModule = composeModules('scale', [zoomModule, insightModule, probeModule]);
