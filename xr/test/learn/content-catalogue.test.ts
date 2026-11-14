/** Learn content: the catalogue against iynk's own index, loading and forking a template as the Studio does. */
import { START_LABEL } from '@/studio/fork';
import { LAB_TEMPLATES, TEMPLATES } from '@content/projects';
import { describe, expect, it } from 'vitest';
import { LANGS } from '../../src/contracts/common';
import { LEARN_ACTOR, catalogue, forkLesson, loadTemplate, templateIdOf } from '../../src/learn/content';

describe('catalogue', () => {
  const cat = catalogue();

  it('has every board of the index with its tour first and lessons by order', () => {
    const boards = [...new Set(TEMPLATES.map((t) => t.board))];
    expect(cat.boards.map((b) => b.id)).toEqual(boards);
    expect(cat.boards.reduce((n, b) => n + b.items.length, 0)).toBe(TEMPLATES.length);
    for (const b of cat.boards) {
      expect(b.items.length).toBeGreaterThan(1);
      expect(b.items[0]!.kind).toBe('tour');
      const lessons = b.items.slice(1);
      expect(lessons.every((i) => i.kind === 'lesson')).toBe(true);
      expect(lessons.map((i) => i.order)).toEqual([...lessons.map((i) => i.order)].sort((x, y) => x - y));
    }
  });

  it('has every robotics bench with its tasks', () => {
    const benches = LAB_TEMPLATES.filter((t) => t.lab === 'robotics' && t.kind === 'bench');
    expect(cat.benches.map((b) => b.bench.templateId)).toEqual(benches.map((b) => b.id));
    for (const b of cat.benches) {
      const tasks = LAB_TEMPLATES.filter((t) => t.lab === 'robotics' && t.kind === 'task' && t.bench === b.id);
      expect(b.tasks.map((t) => t.templateId).sort()).toEqual(tasks.map((t) => t.id).sort());
    }
    expect(cat.benches.some((b) => b.tasks.length > 0)).toBe(true);
    expect(cat.item(LAB_TEMPLATES.find((t) => t.kind === 'craft')?.id ?? 'none')).toBeUndefined();
  });

  it('has Uno Blink with its title in six languages', () => {
    const blink = cat.item('prj_uno-r3-blink');
    expect(blink).toMatchObject({ kind: 'lesson', board: 'uno-r3', level: 'io', stepCount: 4 });
    for (const lang of LANGS) expect(blink!.title[lang]?.trim()).toBeTruthy();
    expect(blink!.title.de).toBe('Eine LED blinken lassen');
    expect(cat.boards.find((b) => b.id === 'uno-r3')!.title.en).toBe('Arduino Uno R3');
  });
});

describe('templates', () => {
  it('loads a template and forks it with a Start checkpoint, keeping where it came from', async () => {
    const t = (await loadTemplate('prj_uno-r3-blink'))!;
    expect(t.id).toBe('prj_uno-r3-blink');
    expect(templateIdOf(t)).toBe(t.id);
    const fork = forkLesson(t);
    expect(fork.id).not.toBe(t.id);
    expect(fork.id).toMatch(/^prj_/);
    expect(fork.revision).toBe(0);
    expect(fork.access.owners).toEqual([LEARN_ACTOR]);
    expect(fork.history.checkpoints.map((c) => c.label)).toEqual([START_LABEL]);
    expect(templateIdOf(fork)).toBe(t.id);
    expect(t.access.owners).not.toEqual([LEARN_ACTOR]);
  });

  it('forks a bench task too, and knows nothing of an unknown id', async () => {
    const task = LAB_TEMPLATES.find((e) => e.kind === 'task')!;
    const t = (await loadTemplate(task.id))!;
    expect(templateIdOf(forkLesson(t))).toBe(task.id);
    expect(await loadTemplate('prj_nothing-here')).toBeUndefined();
    expect(templateIdOf({ ...t, id: 'prj_mine' })).toBeNull();
  });
});
