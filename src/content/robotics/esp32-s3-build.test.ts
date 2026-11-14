import { describe, expect, it } from 'vitest';
import { buildFigure, loadFigure } from '../../../figures/engine/testkit.mjs';
import bench from './esp32-s3-build';

describe('esp32-s3-build bench', () => {
  it('reaches assembled by pressing each build step once, so the later steps unlock', async () => {
    const page = await loadFigure(buildFigure('robotics/esp32-s3-build'), { path: '/figures/robotics/esp32-s3-build.html', query: 'view=power' });
    const doc = page.win.document;
    const report = () => page.bench.report() as { build: string };
    const press = (id: string, choice?: string) => {
      const button = [...doc.querySelectorAll<HTMLElement>('.act[data-id]')].find((e) => e.dataset.id === id);
      if (!button) throw new Error(`no button ${id}`);
      button.click();
      if (choice === undefined) return;
      const chip = [...button.closest('.stepwrap')!.querySelectorAll<HTMLElement>('.chip')].find((e) => e.dataset.id === choice);
      if (!chip) throw new Error(`no choice ${choice} in ${id}`);
      chip.click();
    };
    for (const id of ['strip', 'pick-place', 'reflow', 'headers', 'solder']) {
      const step = bench.steps.find((s) => s.id === id)!;
      const { action } = step;
      if (action?.type === 'set') page.bench.accept(action.state);
      else if (action?.type === 'press') press(action.id, action.choice);
      page.bench.advance(15);
      if (id === 'headers' || id === 'solder') expect(report().build, id).toBe(step.done.build);
    }
    page.close();
  });
});
