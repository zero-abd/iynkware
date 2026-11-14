// @vitest-environment node
// Every board's assembly panel against its built figure: each build step has a Do it, and the Do it commands, run in the
// panel's order on the board as it first loads (powered), get as far as the by-hand test steps allow.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BoardContent, BuildStep } from '@/content/schema';
import { stateMatches } from '@/lib/interp';
import { buildFigure, loadFigure } from '../../../figures/engine/testkit.mjs';

const ids = readdirSync(join(process.cwd(), 'src/content/boards'))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => f.slice(0, -3));

describe.each(ids)('%s assembly', (id) => {
  it('gives every build step a Do it, and the steps complete in order from them', async () => {
    const board = ((await import(`../../content/boards/${id}.ts`)) as { default: BoardContent }).default;
    const page = await loadFigure(buildFigure(`boards/${board.id}`), { path: board.figure.page.split('?')[0], query: 'view=power' });
    const B = page.bench;
    const press = (step: BuildStep) => {
      const action = step.action;
      if (action?.type !== 'press') return;
      const button = [...page.win.document.querySelectorAll<HTMLElement>('.act[data-id]')].find((e) => e.dataset.id === action.id)!;
      const wrap = button.closest('.stepwrap');
      if (action.choice === undefined || !wrap?.classList.contains('open')) button.click();
      if (action.choice !== undefined) [...wrap!.querySelectorAll<HTMLElement>('.chip')].find((e) => e.dataset.id === action.choice)!.click();
    };
    for (const step of board.assembly) {
      if (!step.action) {
        // a step the learner does by hand in the figure, which says exactly what to press
        expect(step.kind, `${step.id} is by hand`).not.toBe('build');
        continue;
      }
      if (step.action.type === 'set') B.accept(step.action.state);
      else press(step);
      // a figure button lets go of its control on a timer
      await new Promise((r) => setTimeout(r, 300));
      // a break step starts a fault or a hold the learner finishes by hand
      if (step.kind === 'break') continue;
      let done = false;
      for (let i = 0; i < 60 && !done; i++) {
        B.advance(0.5);
        done = stateMatches(B.report(), step.done);
      }
      const r = B.report();
      expect(done, `${step.id}: ${JSON.stringify({ build: r.build, status: r.status, mode: r.mode, missing: r.missing })}`).toBe(true);
    }
    page.close();
  }, 120_000);
});
