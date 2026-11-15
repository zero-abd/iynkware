/** Flight range: build a drone on the bench and fly it in the room. Sub-modules, each its own issue. */
import { composeModules } from '../../compose';
import { benchModule } from './bench';
import { crashModule } from './crash';
import { designModule } from './design';
import { deskModule } from './desk';
import { handsModule } from './hands';
import { roomModule } from './room';
import { screenModule } from './screen';

export const flightModule = composeModules('range/flight', [benchModule, designModule, roomModule, crashModule, handsModule, screenModule, deskModule]);
