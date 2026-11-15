/**
 * Agent tools: function declarations (`declarations.json`) and the executor that maps each call onto the app's own
 * seams (`catalog.ts`). This module builds the tool host from the app and puts the tools in the agent hub.
 */
import type { FeatureModule } from '../../contracts/app';
import { labOf } from '../../lab/context';
import { agentOf } from '../hub';
import { createTools, type ToolHost } from './catalog';

export const toolsModule: FeatureModule = {
  id: 'agent/tools',
  mount(app) {
    const hub = agentOf(app.world);
    const host: ToolHost = {
      lang: () => app.settings.lang.value,
      assistant: app.assistant,
      project: app.project,
      guide: () => app.guide.value?.state ?? null,
      lab: () => labOf(app.world),
      callouts: hub.callouts,
      conversation: hub.conversation,
      observations: (n) => hub.coach.recent(n),
      locate: (t) => app.bench.worldOf(t),
      pose: () => hub.pose?.() ?? null,
    };
    hub.host = host;
    hub.tools = createTools(host);
    return () => {
      hub.tools = null;
      hub.host = null;
    };
  },
};
