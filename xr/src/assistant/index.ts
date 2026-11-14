/**
 * The co-builder (contracts/assistant.ts): "Build it with me". Mounts the companion and its proposal card on the
 * bench, puts "Build it with me" in the Bench menu and on the bench itself, and runs the service (`service.ts`) with
 * the scripted co-builder until a model-backed one is `use`d.
 *
 *   import { assistantOf } from '../assistant';
 *   await assistantOf(app)?.buildWithMe('prj_uno-r3-blink');      // until #107 puts it on XrApp as `app.assistant`
 *
 * The folder, one line each:
 *   copy.ts      the strings, six languages
 *   snapshot.ts  the bench as a co-builder sees it (plain JSON)
 *   planner.ts   the scripted co-builder: a template to steps of ops, each with a reason
 *   recipes.ts   op builders a co-builder plans with (place a part, run a wire)
 *   empty.ts     the empty bench a build starts from
 *   actor.ts     the co-builder's own authored channel into the project store (#106 adapter)
 *   session.ts   one build: propose, ghost, accept, perform; reject, undo, stop
 *   service.ts   "Build it with me": one session at a time
 *   presence/    the companion, ghosts, carrying and drawing on the bench
 *   card.ts      the proposal card and the bench entry
 */
import type { FeatureModule, XrApp } from '../contracts/app';
import type { Project } from '../contracts/project';
import { createCard } from './card';
import { localized } from './copy';
import { createBenchPresence } from './presence';
import { createAssistantService, type AssistantServiceImpl } from './service';
import { benchView } from './snapshot';

/** Built when the bench has nothing on it to rebuild. */
export const DEFAULT_TEMPLATE = 'prj_uno-r3-blink';

/** What "Build it with me" builds: the open project from an empty bench, or Uno Blink when the bench is empty. */
export function menuTarget(doc: Project): Project | string {
  return (benchView(doc)?.placements?.length ?? 0) > 0 ? doc : DEFAULT_TEMPLATE;
}

const services = new WeakMap<object, AssistantServiceImpl>();

/** The mounted assistant service of an app, until #107 puts it on `XrApp`. */
export function assistantOf(app: Pick<XrApp, 'world'>): AssistantServiceImpl | undefined {
  return services.get(app.world);
}

export const assistantModule: FeatureModule = {
  id: 'assistant',
  mount(app) {
    const presence = createBenchPresence(app);
    const service = createAssistantService({
      project: app.project,
      templates: app.templates,
      sim: app.sim,
      lang: () => app.settings.lang.value,
      guide: () => app.guide.value?.state ?? null,
      presence,
    });
    services.set(app.world, service);
    const start = () => {
      void service.buildWithMe(menuTarget(app.project.doc)).catch((err) => console.warn('[assistant] build with me', err));
    };
    const card = createCard(app, service.session, start);
    const offMenu = app.shell.addMenuItem({ id: 'assistant/build-with-me', group: 'bench', label: localized('menu'), run: start });
    return () => {
      offMenu();
      service.dispose();
      card.dispose();
      presence.dispose();
      services.delete(app.world);
    };
  },
};
