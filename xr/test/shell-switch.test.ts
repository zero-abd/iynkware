import { describe, expect, test } from 'vitest';
import { LAB_TEMPLATES, TEMPLATES } from '@content/projects';
import { BLINK, FEATURED, leaveLab, openDrone, openLesson, templateTitle } from '../src/shell/switch';
import { createLabContext, setLabOf } from '../src/lab/context';
import { value } from '../src/ui/value';
import type { XrApp } from '../src/contracts/app';

const ids = new Set([...TEMPLATES, ...LAB_TEMPLATES].map((t) => t.id));

describe('shell switch', () => {
  test('Blink and every featured template exist', () => {
    expect(ids.has(BLINK)).toBe(true);
    for (const id of FEATURED) expect(ids.has(id), id).toBe(true);
  });

  test('template titles come from the gallery, in the language when present', () => {
    expect(templateTitle(BLINK, 'en')).not.toBe(BLINK);
    expect(templateTitle(BLINK, 'de').length).toBeGreaterThan(0);
    expect(templateTitle('prj_nope', 'en')).toBe('prj_nope');
  });
});

describe('switching leaves an open lab', () => {
  const appWith = () => {
    const world = {};
    const lab = createLabContext(() => 'en');
    setLabOf(world, lab);
    const offered = value<string[]>(['bench', 'range']);
    const app = {
      world,
      shell: { place: value('bench'), offered, entries: value([{ slot: 'range', open: () => undefined }]), closeHome: () => undefined, go: () => true, notify: () => undefined },
      lessons: { close: () => undefined, open: async () => undefined },
    } as unknown as XrApp;
    return { app, lab };
  };

  test('after four labs, the Drones tile clears the last lab and its items', async () => {
    const { app, lab } = appWith();
    for (const l of ['physics', 'chemistry', 'electrical', 'signals'] as const) lab.open(l);
    expect(lab.store.items().length).toBeGreaterThan(0);
    expect(await openDrone(app, 'bench')).toBe(true);
    expect(lab.store.lab).toBe(null);
    expect(lab.store.items()).toEqual([]);
  });

  test('a lesson and Continue clear it too', async () => {
    const { app, lab } = appWith();
    lab.open('chemistry');
    expect(await openLesson(app, BLINK)).toBe(true);
    expect(lab.store.items()).toEqual([]);
    lab.open('physics');
    leaveLab(app);
    expect(lab.store.lab).toBe(null);
  });
});
