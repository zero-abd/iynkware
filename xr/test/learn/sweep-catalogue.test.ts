/**
 * Every catalogue item (each board's tour and lessons, each robotics bench and task) opened through the launcher on the
 * headless app double: the template loads and forks, the steps show with the first current, every highlight lands on a
 * part or pin of the forked document, and the lesson's own checks run and pass on the finished template.
 *
 * Check timeout: each item's checks get CHECK_TIMEOUT_MS (a check that has not answered by then is reported, not hung);
 * the whole file is allowed TOTAL_MS. Items that fail for a cause outside learn's adapters are in KNOWN_FAILURES.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Project } from '../../src/contracts/project';
import { catalogue } from '../../src/learn/content';
import { lessonSlot } from '../../src/learn/launcher';
import { attachLessons, EVAL_DELAY_MS } from '../../src/learn/session';
import { rig, MemoryStorage } from './app-double';
import { loadTemplate } from '../../src/learn/content';
import type { BoardTarget } from '../../src/contracts/space';
import type { XrApp } from '../../src/contracts/app';

const CHECK_TIMEOUT_MS = 20_000;
const TOTAL_MS = 240_000;

/** templateId -> why it fails for a cause outside learn's adapters. Never skipped silently: the item still opens. */
const PIN_CHECKS = 'iynk src/components/studio/checkJob.ts: pin checks on a Verilog board are "unsupported-language", so every check but "runs" fails';
const PARAM_NAMES = "iynk content: the project parameter's id (par_hz) is passed to the Verilog module by src/components/studio/lessonJob.ts, which has no such parameter";
const KNOWN_FAILURES: Record<string, string> = {
  'prj_microbit-v2-touch-tune': 'iynk content: the logo input has no pins (null), so the touch script never reaches the program and check c3 sees 0 of 1',
  'prj_basys3-gates': PIN_CHECKS,
  'prj_basys3-pwm': PIN_CHECKS,
  'prj_de10-lite-switches': PIN_CHECKS,
  'prj_de10-lite-counter': PIN_CHECKS,
  'prj_de10-lite-pwm': PIN_CHECKS,
  'prj_de10-lite-hex': PIN_CHECKS,
  'prj_basys3-blink': PARAM_NAMES,
  'prj_basys3-counter': PARAM_NAMES,
  'prj_basys3-display': PARAM_NAMES,
  'prj_de10-lite-blink': PARAM_NAMES,
};

const g = globalThis as unknown as { localStorage?: MemoryStorage };
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => void unhandled.push(e);

function targetProblem(app: XrApp, t: BoardTarget): string | null {
  const doc = app.project.doc;
  if (t.kind !== 'part' && t.kind !== 'pin') return null;
  const board = doc.boards.find((b) => b.id === t.part);
  const comp = doc.components.find((c) => c.id === t.part);
  const part = board ?? comp;
  if (!part) return `part ${t.part} is not in the document`;
  if (t.kind === 'pin') {
    const pins = app.project.describe(part.definition.ref, part.definition.version)?.pins ?? [];
    if (!pins.some((p) => p.id === t.pin)) return `pin ${t.pin} is not on ${part.refdes}`;
  }
  return null;
}

const items = [...catalogue().boards.flatMap((b) => b.items), ...catalogue().benches.flatMap((b) => [b.bench, ...b.tasks])];

describe('catalogue sweep', () => {
  let app: XrApp;
  let detach: () => void;
  let first: Project;
  beforeAll(async () => {
    g.localStorage = new MemoryStorage();
    process.on('unhandledRejection', onUnhandled);
    first = (await loadTemplate('prj_uno-r3-blink'))!;
    const r = rig(first);
    app = r.app;
    detach = attachLessons(app);
  });
  afterAll(() => {
    detach();
    process.off('unhandledRejection', onUnhandled);
    delete g.localStorage;
    expect(unhandled).toEqual([]);
  });

  it('has the catalogue it should', () => {
    expect(items.length).toBeGreaterThan(90);
  });

  it.each(items.map((i) => [i.templateId, i] as const))(
    '%s opens and works through the guide',
    async (templateId) => {
      const known = KNOWN_FAILURES[templateId];
      try {
        const template = await loadTemplate(templateId);
        expect(template, 'template loads').toBeDefined();
        await app.lessons.open(templateId);
        const slot = lessonSlot(app);
        const session = slot.session.value!;
        expect(session, 'session').not.toBeNull();
        expect(templateId).toBe(session.state.value.templateId);
        expect(app.project.doc.id).not.toBe(template!.id);

        const s = session.state.value;
        if (s.steps.length > 0) {
          expect(s.steps[0]!.state).toBe('current');
          expect(session.guide.state.steps.length).toBe(s.steps.length);
        }
        const bad: string[] = [];
        for (const step of s.steps) for (const h of step.targets) {
          const p = targetProblem(app, h.target);
          if (p) bad.push(`step ${step.index}: ${p}`);
        }
        expect(bad, 'highlights resolve').toEqual([]);

        if (s.checks.rows.length > 0) {
          // A task's template keeps its reference solution out of the fork (iynk's `x-iynk-solution`): the finished
          // template is the fork with that solution as its firmware.
          const solution = (template!.ext as Record<string, unknown> | undefined)?.['x-iynk-solution'];
          if (typeof solution === 'string') {
            const src = app.project.doc.sources.find((x) => x.role === 'firmware')!;
            const done = app.project.apply({ k: 'source.edit', id: src.id, baseSeq: app.project.doc.revision, pos: 0, del: src.content.length, ins: solution });
            expect(done.ok, 'solution applies').toBe(true);
          }
          await Promise.race([
            session.runChecks(),
            new Promise((_, rej) => setTimeout(() => rej(new Error(`checks took over ${CHECK_TIMEOUT_MS} ms`)), CHECK_TIMEOUT_MS)),
          ]);
          const c = session.state.value.checks;
          expect(c.error ? `line ${c.error.line}: ${c.error.message}` : null, 'check run error').toBeNull();
          const fails = c.rows.filter((r) => r.state !== 'pass').map((r) => `${r.checkId}:${r.state}:${r.detail ?? ''}`);
          expect(fails.join('; '), 'checks pass on the template').toBe('');
          for (const q of session.state.value.quizzes) q.questions.forEach((x) => session.answer(q.id, x.id, x.answer));
          // Then a code change (the edit gate), and the checks again.
          const fw = app.project.doc.sources.find((x) => x.role === 'firmware')!;
          if (app.project.apply({ k: 'source.edit', id: fw.id, baseSeq: app.project.doc.revision, pos: fw.content.length, del: 0, ins: /python/i.test(app.project.doc.boards[0]?.firmware?.language ?? '') ? '\npass\n' : '\n;\n' }).ok) {
            await session.runChecks();
            expect(session.state.value.checks.rows.filter((r) => r.state !== 'pass').map((r) => r.checkId).join(), 'checks after the edit').toBe('');
          }
          await new Promise((r) => setTimeout(r, EVAL_DELAY_MS + 20));
          const end = session.state.value;
          // A template with no valid guided plan has no completion to reach (its steps are ticked by hand).
          if (end.completion !== null) expect({ open: end.completion.open, done: end.done }, 'reaches done').toEqual({ open: [], done: true });
        }
      } catch (err) {
        if (known) return;
        throw err;
      }
      if (known) throw new Error(`${templateId} is listed as a known failure (${known}) but now passes: remove it`);
    },
    CHECK_TIMEOUT_MS + 15_000,
  );
});
