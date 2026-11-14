/** Robot arena: drive the robot templates on the floor. Sub-modules, each its own issue. */
import { composeModules } from '../../compose';
import { arenaModule } from './arena';

export const robotsModule = composeModules('range/robots', [arenaModule]);
