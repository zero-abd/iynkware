/**
 * Every pillar's module, mounted in this order. Each pillar owns its folder and edits only its module there; this list
 * changes only when a pillar is added.
 */
import type { FeatureModule } from './contracts/app';
import { benchModule } from './bench';
import { learnModule } from './learn';
import { rangeModule } from './range';
import { runModule } from './run';
import { scaleModule } from './scale';
import { shellModule } from './shell';

export const FEATURES: readonly FeatureModule[] = [shellModule, benchModule, runModule, learnModule, scaleModule, rangeModule];
