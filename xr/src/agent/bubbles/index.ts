/**
 * Agent bubbles: the speech bubble near the person (speech.ts) and callouts with leader lines from items
 * (callouts.ts), drawn from the hub's conversation and callout list (model.ts).
 */
import type { FeatureModule } from '../../contracts/app';
import { agentOf } from '../hub';
import { mountCallouts } from './callouts';
import { mountSpeech } from './speech';

export const bubblesModule: FeatureModule = {
  id: 'agent/bubbles',
  mount(app) {
    const hub = agentOf(app.world);
    const offSpeech = mountSpeech(app, hub.conversation, (text) => void hub.bridge?.ask(text));
    const offCallouts = mountCallouts(app, hub.callouts);
    return () => {
      offSpeech();
      offCallouts();
    };
  },
};
