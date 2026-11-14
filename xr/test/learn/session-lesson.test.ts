/**
 * The lesson session over a headless app double: the real project store and progress store (memory rows), a fake
 * simulation that only records calls and states, and iynk's real check runner inline (Node has no Worker).
 */
import { sha256Hex } from '@/core/sha256';
import { memoryLearnKv } from '@/local/progress';
import { emptyRecord, withAnswer, withCompletion, withEdited, withLastRun, type LearnerRecord } from '@/project/guided/record';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XrApp } from '../../src/contracts/app';
import type { Lang } from '../../src/contracts/common';
import type { Op, Project } from '../../src/contracts/project';
import type { RunState } from '../../src/contracts/sim';
import { forkLesson, loadTemplate, templateIdOf } from '../../src/learn/content';
import { createLessonSlot, lessonSlot } from '../../src/learn/launcher';
import { createProgressStore } from '../../src/learn/progress';
import { attachLessons, createLessonSession, EVAL_DELAY_MS } from '../../src/learn/session';
import type { LessonSession } from '../../src/learn/types';
import { createProjectStore } from '../../src/project/store';
import { value } from '../../src/ui/value';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, String(v));
  removeItem = (k: string) => void this.m.delete(k);
}
const g = globalThis as unknown as { localStorage?: MemoryStorage };

function fakeSim() {
  let state: RunState = 'unloaded';
  const fns = new Set<(s: RunState) => void>();
  const set = (s: RunState) => {
    state = s;
    for (const fn of [...fns]) fn(s);
  };
  const calls: string[] = [];
  return {
    calls,
    get state() {
      return state;
    },
    async load(doc: Project) {
      calls.push(`load:${doc.id}`);
      set('idle');
      return { ok: true, diagnostics: [] };
    },
    async stop() {
      calls.push('stop');
      if (state !== 'unloaded') set('idle');
    },
    async run() {
      calls.push('run');
      set('running');
    },
    onState(fn: (s: RunState) => void) {
      fns.add(fn);
      return () => void fns.delete(fn);
    },
  };
}

function rig(doc: Project) {
  const lessons = createLessonSlot();
  const sim = fakeSim();
  const lang = value<Lang>('en');
  const progress = createProgressStore({ kv: memoryLearnKv() });
  const app = { project: createProjectStore(doc), sim, settings: { lang }, progress, lessons, guide: lessons.guide } as unknown as XrApp;
  return { app, sim, lang, progress };
}

let blink: Project;
beforeAll(async () => {
  blink = (await loadTemplate('prj_uno-r3-blink'))!;
});
beforeEach(() => {
  g.localStorage = new MemoryStorage();
});
afterEach(() => {
  vi.useRealTimers();
  delete g.localStorage;
});

/** A session on a fresh fork of Blink, with the stored records loaded. */
async function blinkSession(template = blink) {
  const r = rig(forkLesson(template));
  const session = createLessonSession(r.app, { templateId: 'prj_uno-r3-blink', template });
  await r.progress.ready;
  await Promise.resolve();
  return { ...r, session };
}

/** Replaces the first `from` in the firmware source with `to`, as one undo step. */
function editSource(app: XrApp, from: string, to: string) {
  const src = app.project.doc.sources.find((s) => s.role === 'firmware')!;
  const pos = src.content.indexOf(from);
  if (pos < 0) throw new Error(`no ${from} in the source`);
  const op: Op = { k: 'source.edit', id: src.id, baseSeq: app.project.doc.revision, pos, del: from.length, ins: to };
  const done = app.project.apply(op);
  if (!done.ok) throw new Error(JSON.stringify(done));
}

const settle = (ms = EVAL_DELAY_MS + 10) => new Promise((r) => setTimeout(r, ms));

describe('lesson session', () => {
  it('shows Blink: four text steps, the first current, its checks, quiz, hints and what is still open', async () => {
    const { session, app } = await blinkSession();
    const s = session.state.value;
    expect(s).toMatchObject({ templateId: 'prj_uno-r3-blink', projectId: app.project.doc.id, kind: 'lesson', build: false, lang: 'en', viewIndex: 0, done: false, hintsOpened: 0, activeFaults: [], kit: [] });
    expect(s.title.de).toBe('Eine LED blinken lassen');
    expect(s.lede?.en).toMatch(/^Your first circuit/);
    expect(s.steps.map((x) => [x.kind, x.state, x.gated])).toEqual([
      ['text', 'current', false],
      ['text', 'notStarted', false],
      ['text', 'notStarted', false],
      ['text', 'notStarted', false],
    ]);
    expect(s.steps[0]!.targets.length).toBeGreaterThan(0);
    expect(s.checks.status).toBe('idle');
    expect(s.checks.rows.map((r) => [r.checkId, r.kind, r.state, r.textCheck])).toEqual([
      ['c1', 'runs', 'notRun', false],
      ['c2', 'pin-toggles', 'notRun', false],
      ['c3', 'code', 'notRun', true],
    ]);
    expect(s.checks.rows[1]!.target).toEqual({ kind: 'pin', part: 'brd_main', pin: 'D13' });
    expect(s.completion).toEqual({ complete: false, open: ['edit', 'quiz', 'checks'] });
    expect(s.quizzes[0]!.questions).toHaveLength(2);
    expect(s.hints.map((h) => h.level)).toEqual([1, 2, 3]);
    expect(session.guide.state).toMatchObject({ lessonId: 'board:uno-r3/blink', current: 0, done: false });
    expect(session.guide.state.steps.map((x) => x.status)).toEqual(['current', 'locked', 'locked', 'locked']);
    expect(session.guide.state.callouts.length).toBeGreaterThan(0);
    session.dispose();
  });

  it('marks an ungated step with Next, steps back and ahead, and follows the current step again', async () => {
    const { session, progress, app } = await blinkSession();
    session.next();
    let s = session.state.value;
    expect(s.steps.map((x) => x.state)).toEqual(['done', 'current', 'notStarted', 'notStarted']);
    expect(s.viewIndex).toBe(1);
    expect(progress.record(app.project.doc.id)?.steps['0']?.by).toBe('manual');
    session.back();
    expect(session.state.value.viewIndex).toBe(0);
    session.next();
    expect(session.state.value.viewIndex).toBe(1);
    session.view(3);
    session.next();
    s = session.state.value;
    expect(s.steps[3]!.state).toBe('done');
    expect(s.viewIndex).toBe(3);
    session.view(1);
    session.next();
    s = session.state.value;
    expect(s.steps.map((x) => x.state)).toEqual(['done', 'done', 'current', 'done']);
    expect(s.viewIndex).toBe(2);
    session.dispose();
  });

  it('holds a gated step that ticks, then moves on no sooner than 800 ms after the last change', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const plan = { ...(blink.ext as Record<string, unknown>)['x-iynk-guided'] as object, gates: [{ step: 0, kind: 'edit', source: 'src_sketch' }] };
    const gated = { ...blink, ext: { ...blink.ext, 'x-iynk-guided': plan } } as Project;
    const { session, app } = await blinkSession(gated);
    expect(session.state.value.steps[0]).toMatchObject({ gated: true, state: 'current' });
    session.next();
    expect(session.state.value.steps[0]!.state).toBe('current');
    session.view(0);
    editSource(app, 'delay(500);  // how long it stays on', 'delay(200);  // how long it stays on');
    await vi.advanceTimersByTimeAsync(EVAL_DELAY_MS);
    expect(session.state.value.steps[0]!.state).toBe('done');
    expect(session.state.value.viewIndex).toBe(0);
    await vi.advanceTimersByTimeAsync(300);
    editSource(app, 'delay(200);', 'delay(250);');
    await vi.advanceTimersByTimeAsync(799);
    expect(session.state.value.viewIndex).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.state.value.viewIndex).toBe(1);
    session.dispose();
  });

  it('runs the checks when the bench starts running, and they pass on the template code', async () => {
    const { session, sim } = await blinkSession();
    await sim.run();
    expect(session.state.value.checks.status).toBe('running');
    expect(session.state.value.checks.rows.every((r) => r.state === 'running')).toBe(true);
    await session.runChecks();
    const c = session.state.value.checks;
    expect(c.status).toBe('done');
    expect(c.error).toBeNull();
    expect(c.rows.map((r) => r.state)).toEqual(['pass', 'pass', 'pass']);
    expect(session.guide.state.checks.results.map((r) => r.pass)).toEqual([true, true, true]);
    expect(session.state.value.completion?.open).toEqual(['edit', 'quiz']);
    session.dispose();
  });

  it('stops a check run on cancel', async () => {
    const { session } = await blinkSession();
    const run = session.runChecks();
    expect(session.state.value.checks.status).toBe('running');
    session.cancelChecks();
    await run;
    await settle(50);
    expect(session.state.value.checks).toMatchObject({ status: 'idle', progress: 0, error: null });
    expect(session.state.value.checks.rows.every((r) => r.state === 'notRun')).toBe(true);
    session.dispose();
  });

  it('fails the checks with a reason when the code is broken', async () => {
    const { session, app } = await blinkSession();
    editSource(app, 'digitalWrite(LED_PIN, LOW);', '');
    await session.runChecks();
    const rows = session.state.value.checks.rows;
    expect(rows.map((r) => [r.checkId, r.state])).toEqual([
      ['c1', 'pass'],
      ['c2', 'fail'],
      ['c3', 'fail'],
    ]);
    expect(rows[1]!.detail).toBeTruthy();
    editSource(app, 'void loop() {', 'void loop() { int x = ;');
    await session.runChecks();
    expect(session.state.value.checks.error?.line).toBeGreaterThan(0);
    session.dispose();
  });

  it('is done only when the checks pass with no fault on, and stamps the record as iynk does', async () => {
    const { session, app, progress } = await blinkSession();
    const fault = { id: 'flt_test', cause_id: 'reverse-polarity', symptom_ids: [], kind: 'reversed-part', target: { component: 'cmp_led1' }, enabled: true } as unknown;
    const on = app.project.apply({ k: 'fault.set', fault } as Op);
    expect(on.ok).toBe(true);
    editSource(app, 'delay(500);  // how long it stays on', 'delay(200);  // how long it stays on');
    session.answer('blink-quiz', 'q1', 1);
    session.answer('blink-quiz', 'q2', 0);
    await session.runChecks();
    await settle();
    let s = session.state.value;
    expect(s.activeFaults).toEqual(['flt_test']);
    expect(s.completion).toEqual({ complete: false, open: ['fault'] });
    expect(s.done).toBe(false);

    app.project.apply({ k: 'fault.remove', id: 'flt_test' } as Op);
    await settle();
    s = session.state.value;
    expect(s.completion).toEqual({ complete: true, open: [] });
    expect(s.done).toBe(true);
    expect(session.guide.state.done).toBe(true);
    expect(progress.statusOf('prj_uno-r3-blink')).toBe('done');
    expect(JSON.parse(g.localStorage!.getItem('iynk:v1')!).done['board:uno-r3:lesson:blink']).toBe(true);

    // The same record built with iynk's own record functions, in the Studio's order, at the stamps it got.
    const got = progress.record(app.project.doc.id)!;
    const quiz = app.project.doc.guide!.quizzes![0]!;
    let want: LearnerRecord = emptyRecord(got.projectId, got.startedAt, 'prj_uno-r3-blink');
    want = withAnswer(want, 'blink-quiz', 'q1', 1, quiz.questions[0]!.answer === 1, 2);
    want = withAnswer(want, 'blink-quiz', 'q2', 0, quiz.questions[1]!.answer === 0, 2);
    want = withLastRun(want, got.lastRun!);
    want = withEdited(want, got.editedAt!);
    const source = app.project.doc.sources.find((x) => x.role === 'firmware')!.content;
    want = withCompletion(
      want,
      { gates: { checks: true, edit: true, quiz: true, goal: null }, tier: got.lastRun!.tier, sourceSha256: sha256Hex(source), hintsMax: 0, engineVersions: { dmath: '1' }, legacy: false },
      got.completion!.at,
    );
    expect(got).toEqual(want);
    expect(got.lastRun!.tests).toEqual({ main: { c1: true, c2: true, c3: true } });
    session.dispose();
  });

  it('does not count a lesson finished with Do it for me, and reset goes back to the start document', async () => {
    const { session, app, progress, sim } = await blinkSession();
    const start = app.project.doc;
    session.doIt(0);
    expect(session.state.value.steps[0]!.state).toBe('done');
    expect(progress.record(start.id)?.picks).toBe(1);
    editSource(app, 'delay(500);  // how long it stays on', 'delay(200);  // how long it stays on');
    session.answer('blink-quiz', 'q1', 1);
    await session.runChecks();
    await settle();
    expect(session.state.value.completion?.complete).toBe(true);
    expect(session.state.value.done).toBe(false);

    session.reset();
    await settle(20);
    expect(app.project.doc).toBe(start);
    expect(sim.calls.slice(-2)).toEqual(['stop', `load:${start.id}`]);
    expect(progress.record(start.id)?.picks).toBe(0);
    expect(progress.record(start.id)?.steps['0']).toBeDefined();
    session.dispose();
  });

  it('follows the app language and opens hints', async () => {
    const { session, lang, progress, app } = await blinkSession();
    lang.set('de');
    expect(session.state.value.lang).toBe('de');
    expect(session.guide.state.lang).toBe('de');
    session.openHint(2);
    expect(session.state.value.hintsOpened).toBe(2);
    expect(progress.record(app.project.doc.id)?.hintsMax).toBe(2);
    session.dispose();
  });
});

describe('lesson launcher', () => {
  it('forks the open template with its guide, opens and closes lessons', async () => {
    const { app, sim } = rig(blink);
    const slot = lessonSlot(app);
    const detach = attachLessons(app);
    await vi.waitFor(() => expect(slot.session.value).not.toBeNull());
    const fork = app.project.doc;
    expect(fork.id).not.toBe(blink.id);
    expect(templateIdOf(fork)).toBe('prj_uno-r3-blink');
    expect(slot.guide.value?.state.lessonId).toBe('board:uno-r3/blink');
    expect(sim.calls).toEqual(['stop', `load:${fork.id}`]);

    await app.lessons.open('prj_uno-r3-button');
    const button = app.project.doc;
    expect(templateIdOf(button)).toBe('prj_uno-r3-button');
    expect(slot.session.value?.state.value.templateId).toBe('prj_uno-r3-button');
    expect(app.lessons.last.value?.templateId).toBe('prj_uno-r3-button');
    expect(sim.calls.slice(-1)).toEqual([`load:${button.id}`]);

    app.lessons.close();
    expect(slot.session.value).toBeNull();
    expect(slot.guide.value).toBeNull();
    expect(app.project.doc).toBe(button);
    await expect(app.lessons.open('prj_nothing')).rejects.toThrow(/No lesson/);
    detach();
  });

  it('keeps a fork that is already open as it is', async () => {
    const fork = forkLesson(blink);
    const { app, sim } = rig(fork);
    const detach = attachLessons(app);
    const slot = lessonSlot(app);
    await vi.waitFor(() => expect(slot.session.value).not.toBeNull());
    expect(app.project.doc).toBe(fork);
    expect(slot.session.value?.state.value.projectId).toBe(fork.id);
    expect(sim.calls).toEqual([]);
    detach();
    expect(slot.session.value).toBeNull();
  });
});
