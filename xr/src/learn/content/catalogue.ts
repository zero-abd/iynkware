/**
 * The catalogue the headset shows: iynk's own template index (`content/projects`), boards with their tour and lessons
 * (`TEMPLATES`) and robotics benches with their tasks (`LAB_TEMPLATES`). The index is metadata only (titles in six
 * languages, order, level, step count); each template file stays behind its own dynamic import until it is opened.
 * Drone crafts are not lessons and are left out.
 */
import type { TemplateEntry } from '@/project/guided/plan';
import { LAB_TEMPLATES, TEMPLATES, type LabTemplateEntry } from '@content/projects';
import type { LocalizedText } from '../../contracts/common';
import type { Catalogue, CatalogueBench, CatalogueBoard, CatalogueItem } from '../types';

const boardItem = (e: TemplateEntry): CatalogueItem => ({
  templateId: e.id,
  kind: e.kind,
  title: e.title as LocalizedText,
  order: e.order,
  level: e.level,
  stepCount: e.stepCount,
  board: e.board,
});

const labItem = (e: LabTemplateEntry, kind: 'bench' | 'task'): CatalogueItem => ({
  templateId: e.id,
  kind,
  title: e.title as LocalizedText,
  order: e.order,
  level: null,
  stepCount: e.stepCount,
  board: e.board,
});

/** Tour first, then by order. */
const byPlace = (a: CatalogueItem, b: CatalogueItem) => Number(b.kind === 'tour') - Number(a.kind === 'tour') || a.order - b.order;

/** Built from the given index; `catalogue()` is this over iynk's, made once. Exported for tests. */
export function buildCatalogue(templates: readonly TemplateEntry[], labs: readonly LabTemplateEntry[]): Catalogue {
  const byId = new Map<string, CatalogueItem>();
  const boardItems = new Map<string, CatalogueItem[]>();
  for (const e of templates) {
    const item = boardItem(e);
    byId.set(item.templateId, item);
    const list = boardItems.get(e.board) ?? [];
    list.push(item);
    boardItems.set(e.board, list);
  }
  const boards: CatalogueBoard[] = [...boardItems].map(([id, items]) => {
    const sorted = items.sort(byPlace);
    const tour = sorted.find((i) => i.kind === 'tour');
    return { id, title: tour?.title ?? { en: id }, items: sorted };
  });

  const robotics = labs.filter((e) => e.lab === 'robotics');
  const benches: CatalogueBench[] = robotics
    .filter((e) => e.kind === 'bench')
    .map((e) => {
      const bench = labItem(e, 'bench');
      byId.set(bench.templateId, bench);
      const tasks = robotics
        .filter((t) => t.kind === 'task' && t.bench === e.catalogue.id)
        .map((t) => labItem(t, 'task'))
        .sort(byPlace);
      for (const t of tasks) byId.set(t.templateId, t);
      return { id: e.catalogue.id, title: bench.title, bench, tasks };
    });

  return { boards, benches, item: (templateId) => byId.get(templateId) };
}

let made: Catalogue | null = null;

/** Boards with their tour and lessons, robotics benches with their tasks, from iynk's index. */
export function catalogue(): Catalogue {
  made ??= buildCatalogue(TEMPLATES, LAB_TEMPLATES);
  return made;
}
