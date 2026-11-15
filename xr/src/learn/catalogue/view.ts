/**
 * What the catalogue panel draws, as plain data: the list on the left (boards or robotics benches with how many of
 * their lessons or tasks are done) and the rows on the right for the picked one (tour or bench first, then the lessons
 * or tasks, with level, step count, status and the one open now). Both sides are paged to the room the panel has, with
 * no scrolling. Pure: the panel only draws this and the tests read it.
 */
import type { Lang, LocalizedText } from '../../contracts/common';
import { pick } from '../text';
import type { Catalogue, CatalogueItem, ItemProgress, LearnProgress } from '../types';

export type CatalogueTab = 'boards' | 'robotics';

export interface ViewInput {
  readonly catalogue: Catalogue;
  readonly progress: Pick<LearnProgress, 'statusOf' | 'count'>;
  readonly lang: Lang;
  readonly tab: CatalogueTab;
  /** The picked board or bench id; null or unknown picks the first. */
  readonly picked: string | null;
  readonly listPage: number;
  readonly page: number;
  /** How many list rows and item rows fit. */
  readonly listSize: number;
  readonly rowSize: number;
  /** The template open in the guide now, or null. */
  readonly currentId: string | null;
}

export interface ListRow {
  readonly id: string;
  readonly title: string;
  readonly fallback: boolean;
  /** Lessons done of lessons (boards) or tasks done of tasks (benches). */
  readonly done: number;
  readonly total: number;
  readonly picked: boolean;
}

export interface ItemRow {
  readonly templateId: string;
  readonly title: string;
  readonly fallback: boolean;
  readonly kind: CatalogueItem['kind'];
  readonly level: string | null;
  readonly stepCount: number;
  readonly status: ItemProgress;
  readonly current: boolean;
}

export interface Paged<T> {
  readonly rows: readonly T[];
  /** The page shown, zero based, after clamping. */
  readonly page: number;
  readonly pages: number;
}

export interface CatalogueView {
  readonly tab: CatalogueTab;
  readonly pickedId: string | null;
  readonly list: Paged<ListRow>;
  readonly items: Paged<ItemRow> & { readonly title: string };
  /** Any title shown is in English for another language: the panel says so. */
  readonly fallback: boolean;
}

/** The rows of page `page` (clamped) of `all`, `size` to a page (at least one). */
export function paged<T>(all: readonly T[], size: number, page: number): Paged<T> {
  const n = Math.max(1, Math.floor(size));
  const pages = Math.max(1, Math.ceil(all.length / n));
  const at = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  return { rows: all.slice(at * n, at * n + n), page: at, pages };
}

/** The page of `all` that holds the index of `id` in `ids`. */
export function pageOfIndex(index: number, size: number): number {
  return index < 0 ? 0 : Math.floor(index / Math.max(1, Math.floor(size)));
}

/** The lessons of a board or the tasks of a bench: what counts in "4 of 9 lessons". */
const countable = (items: readonly CatalogueItem[]) => items.filter((i) => i.kind === 'lesson' || i.kind === 'task');

/** The groups on one tab: id, title, the items to show, and the items that count. */
function groups(cat: Catalogue, tab: CatalogueTab) {
  if (tab === 'boards') return cat.boards.map((b) => ({ id: b.id, title: b.title as LocalizedText, items: b.items, counted: countable(b.items) }));
  return cat.benches.map((b) => ({ id: b.id, title: b.title as LocalizedText, items: [b.bench, ...b.tasks], counted: countable(b.tasks) }));
}

/** The board or bench that holds `templateId`, with its tab; null when the catalogue does not have it. */
export function homeOf(cat: Catalogue, templateId: string | null): { tab: CatalogueTab; id: string } | null {
  if (templateId === null) return null;
  for (const b of cat.boards) if (b.items.some((i) => i.templateId === templateId)) return { tab: 'boards', id: b.id };
  for (const b of cat.benches) if (b.bench.templateId === templateId || b.tasks.some((i) => i.templateId === templateId)) return { tab: 'robotics', id: b.id };
  return null;
}

/** "4 of 9 lessons" across every board: for the Home tile. */
export function lessonTotals(cat: Catalogue, progress: Pick<LearnProgress, 'count'>): { done: number; total: number } {
  return progress.count(cat.boards.flatMap((b) => countable(b.items).map((i) => i.templateId)));
}

/** The pages that show the picked board or bench in the list and `currentId` among its rows (0 when absent). */
export function focusPages(cat: Catalogue, tab: CatalogueTab, picked: string | null, currentId: string | null, listSize: number, rowSize: number): { listPage: number; page: number } {
  const all = groups(cat, tab);
  const at = Math.max(0, all.findIndex((g) => g.id === picked));
  const row = all[at]?.items.findIndex((i) => i.templateId === currentId) ?? -1;
  return { listPage: pageOfIndex(at, listSize), page: pageOfIndex(row, rowSize) };
}

export function buildView(i: ViewInput): CatalogueView {
  const all = groups(i.catalogue, i.tab);
  const found = all.find((g) => g.id === i.picked) ?? all[0];
  let fallback = false;
  const listRows: ListRow[] = all.map((g) => {
    const t = pick(g.title, i.lang);
    const c = i.progress.count(g.counted.map((x) => x.templateId));
    return { id: g.id, title: t.text, fallback: t.fallback, done: c.done, total: c.total, picked: g.id === found?.id };
  });
  const list = paged(listRows, i.listSize, i.listPage);
  const itemRows: ItemRow[] = (found?.items ?? []).map((it) => {
    const t = pick(it.title, i.lang);
    return {
      templateId: it.templateId,
      title: t.text,
      fallback: t.fallback,
      kind: it.kind,
      level: it.level,
      stepCount: it.stepCount,
      status: i.progress.statusOf(it.templateId),
      current: it.templateId === i.currentId,
    };
  });
  const items = paged(itemRows, i.rowSize, i.page);
  const heading = found ? pick(found.title, i.lang) : { text: '', fallback: false };
  // Only what is on screen counts for the notice.
  fallback = list.rows.some((r) => r.fallback) || items.rows.some((r) => r.fallback) || heading.fallback;
  return { tab: i.tab, pickedId: found?.id ?? null, list, items: { ...items, title: heading.text }, fallback };
}
