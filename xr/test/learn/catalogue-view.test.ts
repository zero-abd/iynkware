/** The catalogue panel's view model over a small fixture and over iynk's real index; its strings; the placement. */
import type { TemplateEntry } from '@/project/guided/plan';
import type { LabTemplateEntry } from '@content/projects';
import { Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { LANGS } from '../../src/contracts/common';
import { catalogue as realCatalogue, buildCatalogue } from '../../src/learn/content/catalogue';
import { CATALOGUE_PLACE, catalogueSpot } from '../../src/learn/catalogue/panel';
import { CATALOGUE_STRINGS } from '../../src/learn/catalogue/strings';
import { buildView, focusPages, homeOf, lessonTotals, paged, type ViewInput } from '../../src/learn/catalogue/view';
import { tableProblems } from '../../src/learn/text';
import type { ItemProgress } from '../../src/learn/types';

const tpl = (id: string, board: string, kind: 'tour' | 'lesson', order: number, title: Record<string, string>, level: TemplateEntry['level'] = null): TemplateEntry =>
  ({ id, title, board, kind, order, level, stepCount: 4 + order, language: 'arduino-cpp', catalogue: { lab: 'board', id: board, child: null }, load: () => Promise.reject(new Error('no')) }) as TemplateEntry;
const lab = (id: string, kind: 'bench' | 'task', bench: string | null, order: number, title: Record<string, string>): LabTemplateEntry =>
  ({ id, title, lab: 'robotics', kind, bench, board: null, order, stepCount: 3, catalogue: { lab: 'robotics', id: kind === 'bench' ? id.replace('prj_', '') : 'x', child: null }, load: () => Promise.reject(new Error('no')) }) as LabTemplateEntry;

const templates = [
  tpl('a-l2', 'a', 'lesson', 2, { en: 'Second', de: 'Zweite' }, 'io'),
  tpl('a-tour', 'a', 'tour', 0, { en: 'Board A', de: 'Brett A' }),
  tpl('a-l1', 'a', 'lesson', 1, { en: 'First', de: 'Erste' }, 'intro'),
  tpl('b-tour', 'b', 'tour', 0, { en: 'Board B' }),
  tpl('b-l1', 'b', 'lesson', 1, { en: 'Only', de: 'Einzige' }, 'analog'),
];
const labs = [lab('prj_bench', 'bench', null, 0, { en: 'The bench', de: 'Die Werkbank' }), lab('prj_t1', 'task', 'bench', 1, { en: 'Task one', de: 'Aufgabe eins' }), lab('prj_t2', 'task', 'bench', 2, { en: 'Task two', de: 'Aufgabe zwei' })];
const cat = buildCatalogue(templates, labs);

const status = (m: Record<string, ItemProgress>) => ({
  statusOf: (id: string): ItemProgress => m[id] ?? 'none',
  count: (ids: readonly string[]) => ({ done: ids.filter((i) => m[i] === 'done').length, total: ids.length }),
});
const input = (o: Partial<ViewInput> = {}): ViewInput => ({ catalogue: cat, progress: status({}), lang: 'en', tab: 'boards', picked: null, listPage: 0, page: 0, listSize: 5, rowSize: 5, currentId: null, ...o });

describe('catalogue view', () => {
  it('lists boards with lessons done of lessons (not tours) and rows tour first', () => {
    const v = buildView(input({ progress: status({ 'a-l1': 'done', 'a-tour': 'done', 'a-l2': 'started' }) }));
    expect(v.list.rows.map((r) => [r.id, r.done, r.total, r.picked])).toEqual([
      ['a', 1, 2, true],
      ['b', 0, 1, false],
    ]);
    expect(v.items.rows.map((r) => [r.templateId, r.status, r.kind])).toEqual([
      ['a-tour', 'done', 'tour'],
      ['a-l1', 'done', 'lesson'],
      ['a-l2', 'started', 'lesson'],
    ]);
    expect(v.items.rows.map((r) => r.level)).toEqual([null, 'intro', 'io']);
    expect(v.items.rows[1]!.stepCount).toBe(5);
  });

  it('picks the given board, the first when it is unknown, and marks the open lesson', () => {
    expect(buildView(input({ picked: 'b', currentId: 'b-l1' })).items.rows.map((r) => [r.templateId, r.current])).toEqual([
      ['b-tour', false],
      ['b-l1', true],
    ]);
    expect(buildView(input({ picked: 'nope' })).pickedId).toBe('a');
  });

  it('shows robotics benches with the bench first and tasks counted', () => {
    const v = buildView(input({ tab: 'robotics', progress: status({ 'prj_t1': 'done', prj_bench: 'started' }) }));
    expect(v.list.rows.map((r) => [r.id, r.done, r.total])).toEqual([['bench', 1, 2]]);
    expect(v.items.rows.map((r) => [r.templateId, r.kind, r.status])).toEqual([
      ['prj_bench', 'bench', 'started'],
      ['prj_t1', 'task', 'done'],
      ['prj_t2', 'task', 'none'],
    ]);
  });

  it('pages both sides, clamps the page and never shows an empty page', () => {
    const v = buildView(input({ rowSize: 2, page: 1 }));
    expect(v.items.rows.map((r) => r.templateId)).toEqual(['a-l2']);
    expect([v.items.page, v.items.pages]).toEqual([1, 2]);
    expect(buildView(input({ rowSize: 2, page: 9 })).items.page).toBe(1);
    expect(buildView(input({ rowSize: 2, page: -3 })).items.page).toBe(0);
    const l = buildView(input({ listSize: 1, listPage: 1 }));
    expect(l.list.rows.map((r) => r.id)).toEqual(['b']);
    expect(paged([], 3, 0)).toEqual({ rows: [], page: 0, pages: 1 });
  });

  it('uses the language and says when a title fell back to English', () => {
    const de = buildView(input({ lang: 'de' }));
    expect(de.items.rows.map((r) => r.title)).toEqual(['Brett A', 'Erste', 'Zweite']);
    // The list shows board B too, whose title is English only: that counts, since it is on screen.
    expect(de.fallback).toBe(true);
    expect(buildView(input({ lang: 'de', listSize: 1 })).fallback).toBe(false);
    const b = buildView(input({ lang: 'de', picked: 'b' }));
    expect(b.items.rows.map((r) => [r.title, r.fallback])).toEqual([
      ['Board B', true],
      ['Einzige', false],
    ]);
    expect(b.fallback).toBe(true);
    expect(buildView(input({ lang: 'en', picked: 'b' })).fallback).toBe(false);
  });

  it('finds the home of a template and the pages that hold the pick', () => {
    expect(homeOf(cat, 'b-l1')).toEqual({ tab: 'boards', id: 'b' });
    expect(homeOf(cat, 'prj_t2')).toEqual({ tab: 'robotics', id: 'bench' });
    expect(homeOf(cat, 'zzz')).toBeNull();
    expect(homeOf(cat, null)).toBeNull();
    expect(focusPages(cat, 'boards', 'b', null, 1, 2)).toEqual({ listPage: 1, page: 0 });
    expect(focusPages(cat, 'boards', 'a', 'a-l2', 1, 2)).toEqual({ listPage: 0, page: 1 });
  });

  it('counts the lessons for the Home tile without tours', () => {
    expect(lessonTotals(cat, status({ 'a-l1': 'done', 'b-tour': 'done' }))).toEqual({ done: 1, total: 3 });
  });
});

describe('catalogue over iynk\'s index', () => {
  const real = realCatalogue();
  const progress = status({});

  it('has boards and benches, each shown in full across its pages', () => {
    expect(real.boards.length).toBeGreaterThan(0);
    expect(real.benches.length).toBeGreaterThan(0);
    for (const tab of ['boards', 'robotics'] as const) {
      const ids = (tab === 'boards' ? real.boards : real.benches).map((g) => g.id);
      const seen: string[] = [];
      for (let p = 0; p < 40; p++) {
        const v = buildView({ catalogue: real, progress, lang: 'zh', tab, picked: null, listPage: p, page: 0, listSize: 4, rowSize: 4, currentId: null });
        seen.push(...v.list.rows.map((r) => r.id));
        if (p >= v.list.pages - 1) break;
      }
      expect(seen).toEqual(ids);
      for (const id of ids) {
        const first = buildView({ catalogue: real, progress, lang: 'en', tab, picked: id, listPage: 0, page: 0, listSize: 4, rowSize: 4, currentId: null });
        const rows: string[] = [];
        for (let p = 0; p < first.items.pages; p++) rows.push(...buildView({ catalogue: real, progress, lang: 'en', tab, picked: id, listPage: 0, page: p, listSize: 4, rowSize: 4, currentId: null }).items.rows.map((r) => r.templateId));
        const group = tab === 'boards' ? real.boards.find((g) => g.id === id)!.items : [real.benches.find((g) => g.id === id)!.bench, ...real.benches.find((g) => g.id === id)!.tasks];
        expect(rows).toEqual(group.map((i) => i.templateId));
        expect(first.items.rows.every((r) => r.title !== '')).toBe(true);
      }
    }
  });

  it('puts the tour first on the first page of every board', () => {
    for (const b of real.boards) {
      const v = buildView({ catalogue: real, progress, lang: 'en', tab: 'boards', picked: b.id, listPage: 0, page: 0, listSize: 4, rowSize: 4, currentId: null });
      expect(v.items.rows[0]!.kind).toBe('tour');
    }
  });
});

describe('catalogue strings and placement', () => {
  it('has every string in the six languages with the same placeholders', () => {
    expect(tableProblems(CATALOGUE_STRINGS)).toEqual([]);
    for (const l of LANGS) expect(CATALOGUE_STRINGS[l]['level.io']).not.toBe('');
  });

  it('places the panel 1.30 m straight ahead and 8 degrees below the head', () => {
    const head = new Vector3(1, 1.6, 2);
    const out = catalogueSpot(head, new Vector3(0, -0.3, -1).normalize(), new Vector3());
    expect(out.x).toBeCloseTo(1, 5);
    expect(out.z).toBeCloseTo(2 - 1.3 * Math.cos((8 * Math.PI) / 180), 5);
    expect(out.y).toBeCloseTo(1.6 - 1.3 * Math.sin((8 * Math.PI) / 180), 5);
    expect(Math.hypot(out.x - 1, out.y - 1.6, out.z - 2)).toBeCloseTo(CATALOGUE_PLACE.distanceM, 5);
    // Beside an open guide: turned 20 degrees to the right, the same distance away.
    const beside = catalogueSpot(head, new Vector3(0, 0, -1), new Vector3(), -20);
    expect(beside.x - 1).toBeCloseTo(1.3 * Math.cos((8 * Math.PI) / 180) * Math.sin((20 * Math.PI) / 180), 5);
    expect(Math.hypot(beside.x - 1, beside.y - 1.6, beside.z - 2)).toBeCloseTo(1.3, 5);
    // Looking straight down: still in front along -Z, not at the head.
    expect(catalogueSpot(head, new Vector3(0, -1, 0), new Vector3()).z).toBeLessThan(2);
  });
});
