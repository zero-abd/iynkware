/** Pillar 5, Range: drones and robots. */
import { composeModules } from '../compose';
import { activateModule } from './activate';
import { flightModule } from './flight';
import { robotsModule } from './robots';

export const rangeModule = composeModules('range', [activateModule, flightModule, robotsModule]);
