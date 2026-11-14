/**
 * The lesson session: one open lesson over `app.project` (the forked document is already open there). Steps and
 * completion come from iynk's guided engine, checks from iynk's lesson check runner, records are stamped the way the
 * Studio's guide stamps them (useGuide.ts, GuideMount.tsx). Headless: panels and highlights read `state` and `guide`.
 */
import { sha256Hex } from '@/core/sha256';
import { toGuideRun } from '@/project/guided/engine';
import { chainStart, stateHash } from '@/project/hash';
import { emptyRecord, withAnswer, withCompletion, withEdited, withHintLevel, withLastRun, withStep, type LearnerRecord, type LessonRun } from '@/project/guided/record';
import { checkRows } from '@/studio/guide/checks-model';
import { forkTemplate, START_LABEL, withStartCheckpoint } from '@/studio/fork';
import { DMATH_VERSION } from '@/sim/core/dmath';
import { LAB_TEMPLATES, TEMPLATES } from '@content/projects';
import type { XrApp } from '../../contracts/app';
import type { Lang, LocalizedText, Unsubscribe } from '../../contracts/common';
import type { GuideCheck, LessonGuide, LessonGuideState, StepStatus } from '../../contracts/lesson';
import type { Project } from '../../contracts/project';
import type { BoardTarget } from '../../contracts/space';
import { value } from '../../ui/value';
import { catalogue, LEARN_ACTOR } from '../content';
import { calloutTargets } from '../guide';
import { learnProgress } from '../progress';
import type { LessonSession, LessonSessionState, SessionCheck, SessionQuiz, SessionStep, TemplateKind } from '../types';
import { activeFaults, evaluateLesson, guideDeps, hintLevels, localized, readValidPlan, stepList, type Evaluated } from './evaluate';

/** The substance hash costs the most, so a burst of ops is judged once (useGuide.ts `EVAL_DELAY_MS`). */
export const EVAL_DELAY_MS = 200;
/** Design spec 7.1: a gate's tick shows for 400 ms, and the view moves on no sooner than 800 ms after the last change. */
export const TICK_MS = 400;
export const SETTLE_MS = 800;
/** The Studio's engine versions (GuideMount.tsx). */
const ENGINE_VERSIONS = { dmath: String(DMATH_VERSION) };

const now = () => new Date().toISOString();

const GUIDE_KIND: Record<string, TemplateKind> = { lesson: 'lesson', tour: 'tour', bench: 'bench', challenge: 'task', craft: 'bench' };

/** `board:uno-r3/blink`, `robotics:l298n/soft-start`, from iynk's index. */
function lessonIdOf(templateId: string): string {
  const entry = TEMPLATES.find((t) => t.id === templateId) ?? LAB_TEMPLATES.find((t) => t.id === templateId);
  if (!entry) return `project:${templateId}`;
  const { lab, id, child } = entry.catalogue;
  return child ? `${lab}:${id}/${child}` : `${lab}:${id}`;
}

/** The fork as it was made: the template forked again under the document's own id and creation time. */
function startOf(doc: Project, template: Project): Project {
  const startRevision = doc.history.checkpoints.find((c) => c.label === START_LABEL)?.revision ?? 0;
  if (doc.revision === startRevision) return doc;
  const deps = { newId: () => doc.id, now: () => doc.meta.createdAt, actor: LEARN_ACTOR, genesis: chainStart, stateHash };
  return withStartCheckpoint(forkTemplate(template, 'lesson', deps), deps);
}

/** The pin or part a check reads, for pinning a finding. */
function checkTarget(doc: Project, check: Project['tests'][number]['checks'][number]): BoardTarget | undefined {
  if (!('pin' in check) || typeof check.pin !== 'string') return undefined;
  const board = doc.boards.find((b) => b.id === check.board || b.refdes === check.board) ?? doc.boards[0];
  return board ? { kind: 'pin', part: board.id, pin: check.pin } : undefined;
}

/** The firmware source (useGuide.ts `entrySource`). */
function entrySource(doc: Project): string {
  const entry = doc.boards.find((b) => b.firmware)?.firmware?.entry;
  const source = doc.sources.find((s) => s.id === entry) ?? doc.sources.find((s) => s.role === 'firmware');
  return source?.content ?? '';
}

const STATUS: Record<SessionStep['state'], StepStatus> = { notStarted: 'locked', current: 'current', blocked: 'current', done: 'done' };

export function createLessonSession(app: XrApp, opts: { templateId: string; template: Project }): LessonSession {
  const { templateId, template } = opts;
  const progress = learnProgress(app);
  const describe = (ref: string, version?: string) => app.project.describe(ref, version);
  const first = app.project.doc;
  const projectId = first.id;
  const start = startOf(first, template);
  const item = catalogue().item(templateId);
  const kind: TemplateKind = item?.kind ?? GUIDE_KIND[first.guide?.kind ?? 'lesson'] ?? 'lesson';
  const lessonId = lessonIdOf(templateId);

  let doc = first;
  let plan = readValidPlan(doc);
  let list = stepList(doc, plan, describe);
  const deps = guideDeps(() => doc);
  let lang: Lang = app.settings.lang.value;
  let evaluated: Evaluated = { steps: [], flips: [], completion: null };
  /** The step the person chose to look at; null while the view follows the current step. */
  let picked: number | null = null;
  /** A step a gate just ticked, kept in view until `holdTimer` lets the view move on. */
  let hold: number | null = null;
  let holdTicked = 0;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let evalTimer: ReturnType<typeof setTimeout> | undefined;
  let lastChangeAt = Date.now();
  let lessonRun: LessonRun | null = null;
  let checks: LessonSessionState['checks'] = { status: 'idle', progress: 0, rows: [], error: null };
  let running: { token: number; promise: Promise<void>; cancel(): void } | null = null;
  let token = 0;
  let recordsReady = false;
  let disposed = false;

  const record = () => progress.record(projectId);
  const base = (r: LearnerRecord | undefined, at: string) => r ?? emptyRecord(projectId, at, templateId);
  const currentIndex = (steps: readonly SessionStep[]) => {
    const i = steps.findIndex((s) => s.state === 'current' || s.state === 'blocked');
    return i >= 0 ? i : Math.max(steps.length - 1, 0);
  };

  function rowsOf(d: Project): SessionCheck[] {
    const verdicts = new Map((lessonRun?.tests ?? []).flatMap((t) => t.verdicts.map((v) => [`${v.testId}/${v.checkId}`, v] as const)));
    const checksById = new Map(d.tests.flatMap((t) => t.checks.map((c) => [`${t.id}/${c.id}`, c] as const)));
    return checkRows(d, lessonRun, lang).map((row): SessionCheck => {
      const check = checksById.get(`${row.testId}/${row.checkId}`)!;
      const detail = verdicts.get(`${row.testId}/${row.checkId}`)?.detail;
      const target = checkTarget(d, check);
      return {
        testId: row.testId,
        checkId: row.checkId,
        label: row.hidden ? {} : localized(check.label),
        kind: row.kind,
        state: checks.status === 'running' ? 'running' : row.state,
        hidden: row.hidden,
        textCheck: row.textCheck,
        ...(detail === undefined ? {} : { detail }),
        ...(target ? { target } : {}),
      };
    });
  }

  function quizzesOf(d: Project, r: LearnerRecord | undefined): SessionQuiz[] {
    return (d.guide?.quizzes ?? []).map((q) => ({
      id: q.id,
      afterStep: q.afterStep ?? null,
      questions: q.questions.map((x) => ({
        id: x.id,
        q: localized(x.q),
        options: x.options.map((o) => localized(o)),
        answer: x.answer,
        why: localized(x.why),
        chosen: r?.quiz[q.id]?.answers[x.id] ?? null,
      })),
    }));
  }

  function build(): LessonSessionState {
    const r = record();
    const steps: SessionStep[] = list.map((s, i) => ({ ...s, state: evaluated.steps[i]?.state ?? 'notStarted' }));
    const last = Math.max(steps.length - 1, 0);
    const viewIndex = Math.min(Math.max(picked ?? hold ?? currentIndex(steps), 0), last);
    const c = evaluated.completion;
    return {
      templateId,
      projectId,
      kind,
      build: false,
      title: localized(doc.guide?.title ?? doc.meta.title),
      lede: doc.guide?.lede === undefined ? null : localized(doc.guide.lede),
      lang,
      steps,
      viewIndex,
      checks: { ...checks, rows: rowsOf(doc) },
      completion: c ? { complete: c.complete, open: c.open } : null,
      done: r?.completion !== undefined,
      quizzes: quizzesOf(doc, r),
      hints: hintLevels(doc.guide?.hints ?? []),
      hintsOpened: r?.hintsMax ?? 0,
      activeFaults: activeFaults(doc),
      kit: [],
    };
  }

  const state = value<LessonSessionState>(build());
  const publish = () => {
    if (!disposed) state.set(build());
  };

  /** Writes what the evaluation found to the learner record, as useGuide.ts does after its delay. */
  function stamp(next: Evaluated) {
    if (!recordsReady || plan === null) return;
    const r = record();
    const done = next.flips;
    const edited = next.completion?.editFlip === true;
    // A lesson Do it for me helped with (`picks`) does not count.
    const finished = next.completion?.complete === true && r?.completion === undefined && (r?.picks ?? 0) === 0;
    if (done.length === 0 && !edited && !finished) return;
    const at = now();
    const gates = next.completion?.gates;
    progress.update(projectId, (cur) => {
      let out = base(cur, at);
      for (const i of done) out = withStep(out, i, 'gate', at);
      if (edited) out = withEdited(out, at);
      if (finished && gates && out.completion === undefined && out.picks === 0) {
        out = withCompletion(
          out,
          {
            gates: { checks: gates.checks, edit: gates.edit, quiz: gates.quiz, goal: gates.goal },
            tier: lessonRun?.tier ?? 'T0',
            sourceSha256: sha256Hex(entrySource(doc)),
            hintsMax: out.hintsMax,
            engineVersions: ENGINE_VERSIONS,
            legacy: false,
          },
          at,
        );
      }
      return out;
    });
  }

  /** Keeps a step a gate just ticked in view: at least TICK_MS, and SETTLE_MS after the last document change. */
  function scheduleRelease() {
    clearTimeout(holdTimer);
    const wait = Math.max(holdTicked + TICK_MS, lastChangeAt + SETTLE_MS) - Date.now();
    holdTimer = setTimeout(() => {
      hold = null;
      publish();
    }, Math.max(wait, 0));
  }

  let busy = false;
  let again = false;
  /** Evaluates now; a record write it causes comes back here and runs once more. */
  function refresh() {
    if (disposed) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        const before = state.value;
        const shown = before.viewIndex;
        const following = picked === null && hold === null;
        evaluated = evaluateLesson(doc, plan, record(), toGuideRun(lessonRun), deps, LEARN_ACTOR);
        if (following && list[shown]?.gated && evaluated.flips.includes(shown) && before.steps[shown]?.state !== 'done') {
          hold = shown;
          holdTicked = Date.now();
          scheduleRelease();
        }
        stamp(evaluated);
        publish();
      } while (again);
    } finally {
      busy = false;
    }
  }

  const offs: Unsubscribe[] = [];

  function markManual(index: number, extra?: (r: LearnerRecord) => LearnerRecord) {
    const at = now();
    progress.update(projectId, (cur) => {
      const out = withStep(base(cur, at), index, 'manual', at);
      return extra ? extra(out) : out;
    });
  }

  const session: LessonSession = {
    state,
    guide: null as unknown as LessonGuide,
    view(index) {
      const steps = state.value.steps;
      const i = Math.min(Math.max(index, 0), Math.max(steps.length - 1, 0));
      picked = i === currentIndex(steps) ? null : i;
      hold = null;
      clearTimeout(holdTimer);
      publish();
    },
    back() {
      session.view(state.value.viewIndex - 1);
    },
    next() {
      const { steps, viewIndex } = state.value;
      const step = steps[viewIndex];
      if (step && step.state !== 'done' && !step.gated) markManual(viewIndex);
      refresh();
      session.view(viewIndex + 1);
    },
    doIt(index) {
      const step = state.value.steps[index];
      if (!step) return;
      // Build steps arrive with build mode (the assistant's "Build it with me"); a text step has nothing to do on the
      // bench, so this only finishes it. `picks` counts the help, and a lesson helped this way is not stamped complete.
      markManual(index, (r) => ({ ...r, picks: r.picks + 1 }));
      refresh();
    },
    runChecks() {
      if (running) return running.promise;
      const current = doc;
      if (current.tests.length === 0) return Promise.resolve();
      const mine = ++token;
      let cancel: () => void = () => undefined;
      checks = { status: 'running', progress: 0, rows: [], error: null };
      publish();
      const promise = (async () => {
        const { startLessonChecks } = await import('./checks-run');
        if (mine !== token || disposed) return;
        let shown = 0;
        const handle = startLessonChecks(current, (f) => {
          if (mine !== token || f - shown < 0.05) return;
          shown = f;
          checks = { ...checks, progress: f };
          publish();
        });
        cancel = handle.cancel;
        const result = await handle.result;
        if (mine !== token || disposed) return;
        lessonRun = result;
        const failed = result.tests.find((t) => t.error !== null && !t.limit);
        checks = { status: result.tests.some((t) => t.limit) ? 'limit' : 'done', progress: 1, rows: [], error: failed?.error ?? null };
        const lastRun = toGuideRun(result);
        if (lastRun) progress.update(projectId, (cur) => withLastRun(base(cur, lastRun.at), lastRun));
        refresh();
      })().finally(() => {
        if (running?.token === mine) running = null;
      });
      running = { token: mine, promise, cancel: () => cancel() };
      return promise;
    },
    cancelChecks() {
      const was = running;
      token++;
      running = null;
      was?.cancel();
      checks = { status: 'idle', progress: 0, rows: [], error: null };
      publish();
    },
    answer(quizId, questionId, choice) {
      const quiz = doc.guide?.quizzes?.find((q) => q.id === quizId);
      const question = quiz?.questions.find((q) => q.id === questionId);
      if (!quiz || !question) return;
      const at = now();
      progress.update(projectId, (cur) => withAnswer(base(cur, at), quizId, questionId, choice, choice === question.answer, quiz.questions.length));
    },
    openHint(level) {
      if (level !== 1 && level !== 2 && level !== 3) return;
      const at = now();
      progress.update(projectId, (cur) => withHintLevel(base(cur, at), level));
    },
    setLang(l) {
      if (l === lang) return;
      lang = l;
      publish();
    },
    reset() {
      session.cancelChecks();
      picked = null;
      hold = null;
      clearTimeout(holdTimer);
      lessonRun = null;
      // Back at the start nothing Do it for me did is left in the document, so the lesson can count again.
      if ((record()?.picks ?? 0) > 0) progress.update(projectId, (cur) => ({ ...base(cur, now()), picks: 0 }));
      void (async () => {
        await app.sim.stop().catch(() => undefined);
        if (disposed) return;
        app.project.open(start);
        await app.sim.load(start).catch(() => undefined);
      })();
    },
    dispose() {
      if (disposed) return;
      session.cancelChecks();
      disposed = true;
      clearTimeout(holdTimer);
      clearTimeout(evalTimer);
      for (const off of offs.splice(0)) off();
    },
  };
  (session as { guide: LessonGuide }).guide = guideOf(session, lessonId, () => doc);

  offs.push(
    app.project.subscribe(() => {
      if (app.project.doc.id !== projectId) return;
      doc = app.project.doc;
      lastChangeAt = Date.now();
      plan = readValidPlan(doc);
      list = stepList(doc, plan, describe);
      if (hold !== null) scheduleRelease();
      clearTimeout(evalTimer);
      evalTimer = setTimeout(refresh, EVAL_DELAY_MS);
    }),
  );
  offs.push(progress.subscribe(() => refresh()));
  offs.push(app.settings.lang.subscribe((l) => session.setLang(l)));
  // Checks run when the bench starts running (not on a resume from pause).
  let simState = app.sim.state;
  offs.push(
    app.sim.onState((s) => {
      if (s === 'running' && simState !== 'running' && simState !== 'paused') void session.runChecks();
      simState = s;
    }),
  );
  void progress.ready.then(() => {
    recordsReady = true;
    refresh();
  });
  refresh();
  return session;
}

/** The contract view (`XrApp.guide`) over the session's state. */
function guideOf(session: LessonSession, lessonId: string, doc: () => Project): LessonGuide {
  let from: LessonSessionState | null = null;
  let made: LessonGuideState | null = null;
  const map = (s: LessonSessionState): LessonGuideState => {
    if (s === from && made) return made;
    const results: GuideCheck[] = s.checks.rows.map((r) => ({
      id: `${r.testId}/${r.checkId}`,
      label: r.label,
      pass: r.state === 'pass' ? true : r.state === 'fail' ? false : null,
      ...(r.detail === undefined ? {} : { detail: { en: r.detail } as LocalizedText }),
    }));
    from = s;
    made = {
      lessonId,
      title: s.title,
      lang: s.lang,
      steps: s.steps.map((st) => ({ id: st.id, text: st.text, status: STATUS[st.state], highlights: st.targets.map((h) => ({ target: h.target, tone: h.tone })) })),
      current: s.viewIndex,
      callouts: calloutTargets(doc()),
      checks: { status: s.checks.status === 'limit' ? 'done' : s.checks.status, results },
      done: s.done,
      kit: s.kit,
    };
    return made;
  };
  return {
    get state() {
      return map(session.state.value);
    },
    subscribe: (fn) => session.state.subscribe((s) => fn(map(s))),
    next: () => session.next(),
    back: () => session.back(),
    runChecks: () => session.runChecks(),
    setLang: (l) => session.setLang(l),
  };
}
