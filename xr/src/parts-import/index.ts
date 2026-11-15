/** Pillar 10, Parts import: bring a part pack (`.iynkpack`) into the headset and place the part on the bench (issue #216). */
import { composeModules } from '../compose';
import { panelModule } from './panel';

export const partsImportModule = composeModules('parts-import', [panelModule]);
