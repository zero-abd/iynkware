/**
 * The co-builder (contracts/assistant.ts): "Build it with me". `app.ts` builds the service (`app.assistant`); this
 * module gives it a body on the bench: the companion and its ghosts become the service's presence, the proposal card
 * stands beside the work, and "Build it with me" is both a pill on an empty bench and a row in the Bench menu.
 *
 *   await app.assistant.buildWithMe('prj_uno-r3-blink');        // any pillar: a guided build of a template
 *
 * The folder, one line each:
 *   copy.ts      the strings, six languages
 *   snapshot.ts  the bench as a co-builder sees it (plain JSON)
 *   planner.ts   the scripted co-builder: a template to steps of ops, each with a reason
 *   recipes.ts   op builders a co-builder plans with (place a part, run a wire)
 *   empty.ts     the empty bench a build starts from
 *   actor.ts     the co-builder's own authored channel into the project store (`ProjectStore.as`)
 *   session.ts   one build: propose, ghost, accept, perform; reject, undo, stop
 *   service.ts   "Build it with me": one session at a time
 *   presence/    the companion, ghosts, carrying and drawing on the bench
 *   card.ts      the proposal card and the bench entry; plate.ts its buttons
 */
import type { FeatureModule } from '../contracts/app';
import type { Project } from '../contracts/project';
import { createCard } from './card';
import { localized } from './copy';
import { createBenchPresence } from './presence';
import { attachPresence } from './service';
import { benchView } from './snapshot';
import { value } from '../ui/value';
import { rangeOf } from '../range/activate';

/** Built when the bench has nothing on it to rebuild. */
export const DEFAULT_TEMPLATE = 'prj_uno-r3-blink';

/** What "Build it with me" builds: the open project from an empty bench, or Uno Blink when the bench is empty. */
export function menuTarget(doc: Project): Project | string {
  return (benchView(doc)?.placements?.length ?? 0) > 0 ? doc : DEFAULT_TEMPLATE;
}

export const assistantModule: FeatureModule = {
  id: 'assistant',
  mount(app) {
    const presence = createBenchPresence(app);
    const detach = attachPresence(app.assistant, presence);
    const start = () => {
      void app.assistant.buildWithMe(menuTarget(app.project.doc)).catch((err) => console.warn('[assistant] build with me', err));
    };
    // The calm layout: the pill offers itself only on an empty bench, where there is nothing else to do; the menu row
    // is always there.
    // The LED circuit's helper does not apply to the drone: no pill, no menu row, no steps.
    const onDrone = () => rangeOf(app).value?.kind === 'drone' || app.shell.place.value === 'range';
    const bare = () => !onDrone() && (benchView(app.project.doc)?.placements?.length ?? 0) === 0;
    const offerPill = value(bare());
    const row = { id: 'assistant/build-with-me', group: 'bench', label: localized('menu'), run: start } as const;
    let offMenu: (() => void) | null = null;
    const sync = () => {
      offerPill.set(bare());
      if (onDrone()) {
        app.assistant.session.value?.stop();
        offMenu?.();
        offMenu = null;
      } else if (!offMenu) offMenu = app.shell.addMenuItem(row);
    };
    const offs = [app.project.subscribe(sync), rangeOf(app).subscribe(sync), app.shell.place.subscribe(sync)];
    const card = createCard(app, app.assistant.session, start, offerPill);
    sync();
    return () => {
      offMenu?.();
      for (const off of offs) off();
      app.assistant.session.value?.stop();
      detach();
      card.dispose();
      presence.dispose();
    };
  },
};
