/** Pillar 5, Range: drones and robots. */
import { composeModules } from '../compose';
import { flightModule } from './flight';
import { robotsModule } from './robots';

export const rangeModule = composeModules('range', [flightModule, robotsModule]);
