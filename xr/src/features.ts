/**
 * Every pillar's module, mounted in this order. Each pillar owns its folder and edits only its module there; this list
 * changes only when a pillar is added.
 */
import type { FeatureModule } from './contracts/app';
import { agentModule } from './agent';
import { assistantModule } from './assistant';
import { benchModule } from './bench';
import { labModule } from './lab';
import { learnModule } from './learn';
import { lookModule } from './look';
import { rangeModule } from './range';
import { runModule } from './run';
import { scaleModule } from './scale';
import { shellModule } from './shell';

/** `lookModule` first: the stage, the figure light and the motion runner exist before any pillar draws. */
export const FEATURES: readonly FeatureModule[] = [lookModule, shellModule, benchModule, runModule, learnModule, assistantModule, scaleModule, rangeModule, labModule, agentModule];
