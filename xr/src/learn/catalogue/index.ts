/**
 * Catalogue: boards with their lessons and robotics benches with their tasks, with progress. Shows the panel while
 * `app.lessons`' catalogue value is set, puts the Lessons tile on Home and the Lessons row in the menu.
 */
import type { FeatureModule } from '../../contracts/app';
import { LANGS, type LocalizedText, type Unsubscribe } from '../../contracts/common';
import { catalogue } from '../content/catalogue';
import { lessonSlot } from '../launcher';
import { learnProgress } from '../progress';
import type { Lang } from '../../contracts/common';
import { createCataloguePanel } from './panel';
import { t, type CatalogueKey } from './strings';
import { lessonTotals } from './view';

const all = (key: CatalogueKey, vars?: Record<string, string | number>): LocalizedText =>
  Object.fromEntries(LANGS.map((l: Lang) => [l, t(l, key, vars)])) as LocalizedText;

export const catalogueModule: FeatureModule = {
  id: 'learn/catalogue',
  mount(app) {
    const slot = lessonSlot(app);
    const progress = learnProgress(app);
    let shown: Unsubscribe | null = null;
    const show = (lab: 'board' | 'robotics' | 'all' | null) => {
      shown?.();
      shown = lab ? createCataloguePanel(app, lab) : null;
    };
    const offSlot = slot.catalogue.subscribe(show);

    // Home tile and menu row. Adding again with the same id replaces, so a progress change re-adds the tile.
    let offEntry: Unsubscribe | null = null;
    const addEntry = () => {
      const c = lessonTotals(catalogue(), progress);
      offEntry = app.shell.addEntry({
        id: 'learn/lessons',
        slot: 'lessons',
        title: all('title'),
        detail: Object.fromEntries(LANGS.map((l) => [l, t(l, 'lessonsCount', { done: c.done, total: c.total })])) as LocalizedText,
        open: () => app.lessons.showCatalogue(),
      });
    };
    addEntry();
    const offProgress = progress.subscribe(addEntry);
    const offMenu = app.shell.addMenuItem({ id: 'learn/lessons', group: 'tools', label: all('title'), run: () => app.lessons.showCatalogue() });

    // `?lessons` opens it on mount.
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('lessons')) app.lessons.showCatalogue();

    return () => {
      offSlot();
      offProgress();
      offMenu();
      offEntry?.();
      show(null);
    };
  },
};
