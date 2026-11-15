/**
 * Pillar 9, Agent: what lets an AI assistant you talk to act in the headset. `tools` (what it can do, as function
 * declarations, and the executor onto the app's seams), `bubbles` (its words near the person, and callouts with leader
 * lines from items), `coach` (what the person is doing, as compact observations) and `bridge` (the one object a voice
 * client plugs into), and `voice` (Gemini Live push-to-talk in the app, on that bridge). Mounted last: it reads every other pillar through `XrApp`.
 */
import { composeModules } from '../compose';
import { toolsModule } from './tools';
import { bubblesModule } from './bubbles';
import { coachModule } from './coach';
import { bridgeModule } from './bridge';
import { voiceModule } from './voice';

export const agentModule = composeModules('agent', [toolsModule, bubblesModule, coachModule, bridgeModule, voiceModule]);
