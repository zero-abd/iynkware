/**
 * Pillar 4, Scale and insight. The scale service itself (`./service.ts`, `app.scale`) is made by app.ts so every
 * pillar can drive it; these sub-modules realise it. `./kit` is shared by them and is not a sub-module.
 */
import { composeModules } from '../compose';
import { spaceModule } from './space';
import { zoomModule } from './zoom';
import { roomModule } from './room';
import { insightModule } from './insight';
import { flowModule } from './flow';
import { probeModule } from './probe';
import { controlsModule } from './controls';

export const scaleModule = composeModules('scale', [
  spaceModule,
  zoomModule,
  roomModule,
  insightModule,
  flowModule,
  probeModule,
  controlsModule,
]);
