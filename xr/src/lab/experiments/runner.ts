/**
 * The experiment runner: lays the kit out in the lab store, follows the store, and advances through the steps as each
 * one's predicate holds (several in one go when they already hold). It notes every mistake as it starts and every
 * refused action, with the lab clock's time and the step it happened in, and builds the result sheet when the last
 * step is done or `finish()` is called. Practice and exam run the same steps; the tutor is what changes (it is quiet
 * in an exam, and hints are not offered), and the sheet's score counts hints only in practice.
 *
 *   const runner = createRunner(store);
 *   runner.start(FLAME_TEST, { mode: 'exam', seed: 42 });
 *   runner.subscribe((e) => ...);                // start, step, done, mistake, refused, answer, finish, stop
 *   runner.state.value?.stepIndex
 */
import type { ReadonlyValue, Unsubscribe } from '../../contracts/common';
import { value } from '../../ui/value';
import type { LabChange, LabStore } from '../model/store';
import type { Prim } from '../model/types';
import { notesOf } from '../model/catalogue';
import type { CheckResult, ExpCtx, Experiment, LogEntry, Mode, ResultSheet, Step } from './types';

export interface RunState {
  readonly experiment: Experiment;
  readonly mode: Mode;
  readonly seed: number;
  readonly startedAt: number;
  /** The step to do now; `steps.length` once all are done. */
  readonly stepIndex: number;
  readonly step: Step | null;
  /** When the current step began (lab clock), for the tutor's pacing. */
  readonly stepSince: number;
  readonly done: boolean;
  readonly result: ResultSheet | null;
}

export type RunEvent =
  | { readonly type: 'start'; readonly run: RunState }
  | { readonly type: 'step'; readonly run: RunState; readonly step: Step }
  | { readonly type: 'done'; readonly run: RunState; readonly step: Step }
  | { readonly type: 'mistake'; readonly run: RunState; readonly entry: Extract<LogEntry, { type: 'mistake' }> }
  | { readonly type: 'refused'; readonly run: RunState; readonly entry: Extract<LogEntry, { type: 'refused' }> }
  | { readonly type: 'answer'; readonly run: RunState; readonly entry: Extract<LogEntry, { type: 'answer' }> }
  | { readonly type: 'finish'; readonly run: RunState; readonly result: ResultSheet }
  | { readonly type: 'stop' };

export interface Runner {
  readonly state: ReadonlyValue<RunState | null>;
  /** Clears the store, lays out the kit and begins at the first step. */
  start(experiment: Experiment, opts?: { mode?: Mode; seed?: number }): RunState;
  /** Ends the run now (marks what is there) and returns the sheet. Null when nothing runs. */
  finish(): ResultSheet | null;
  /** Leaves the run without a sheet (the store keeps its items). */
  stop(): void;
  /** Practice: notes a hint was asked for and returns the current step's hint. Null in an exam. */
  hint(): Step['hint'] | null;
  /** The context the predicates read, for the tutor and tests. */
  readonly ctx: ExpCtx | null;
  /** The run's log so far. */
  readonly log: readonly LogEntry[];
  subscribe(fn: (e: RunEvent) => void): Unsubscribe;
  dispose(): void;
}

/** Points off per safety mistake (severity hazard or escalate), per refused action, per hint in practice. */
export const MISTAKE_PENALTY = 5;
export const REFUSAL_PENALTY = 2;
export const HINT_PENALTY = 3;

/** The score of a sheet: pure, so the panel, the tests and a teacher's tool agree. */
export function scoreOf(checks: readonly CheckResult[], mistakes: number, refusals: number, hints: number, mode: Mode): number {
  if (checks.length === 0) return 0;
  const base = (100 * checks.filter((c) => c.pass).length) / checks.length;
  const penalty = MISTAKE_PENALTY * mistakes + REFUSAL_PENALTY * refusals + (mode === 'practice' ? HINT_PENALTY * hints : 0);
  return Math.max(0, Math.round(base - penalty));
}

export function createRunner(store: LabStore): Runner {
  const state = value<RunState | null>(null);
  const fns = new Set<(e: RunEvent) => void>();
  const emit = (e: RunEvent) => {
    for (const fn of [...fns]) fn(e);
  };
  let log: LogEntry[] = [];
  let seen = new Set<string>();
  /** The mistake each item has now, by item id. */
  let active = new Map<string, string | null>();
  let ctx: ExpCtx | null = null;
  let hints = 0;
  let evaluating = false;

  const makeCtx = (mode: Mode, seed: number): ExpCtx => ({
    store,
    mode,
    seed,
    item(kind) {
      const it = store.byKind(kind);
      if (!it) return null;
      return { state: it.state, report: store.report(it.id)! };
    },
    answer: (key) => store.answers[key],
    ever: (id) => seen.has(id),
  });

  const sheet = (run: RunState, at: number): ResultSheet => {
    const c = ctx!;
    const checks: CheckResult[] = run.experiment.checks.map((k) => ({ id: k.id, label: k.label, pass: k.pass(c), detail: k.detail?.(c) }));
    // Every mistake is logged; the safety ones (hazard, escalate) cost points, the rest are marked by the checks.
    const mistakes = log.filter((l) => l.type === 'mistake' && l.severity !== 'warn').length;
    const refusals = log.filter((l) => l.type === 'refused').length;
    return {
      experimentId: run.experiment.id,
      mode: run.mode,
      seed: run.seed,
      startedAt: run.startedAt,
      endedAt: at,
      completed: run.stepIndex >= run.experiment.steps.length,
      stepsDone: Math.min(run.stepIndex, run.experiment.steps.length),
      stepsTotal: run.experiment.steps.length,
      checks,
      mistakes,
      refusals,
      hints,
      score: scoreOf(checks, mistakes, refusals, hints, run.mode),
      log: [...log],
    };
  };

  const end = (run: RunState): ResultSheet => {
    const result = sheet(run, store.now);
    const next: RunState = { ...run, done: true, result };
    state.set(next);
    emit({ type: 'finish', run: next, result });
    return result;
  };

  /** Mistakes that started since the last look, logged; returns nothing. */
  const watchMistakes = (run: RunState) => {
    for (const it of store.items()) {
      const now = store.mistake(it.id);
      const before = active.get(it.id) ?? null;
      if (now === before) continue;
      active.set(it.id, now);
      if (!now) continue;
      seen.add(now);
      const severity = notesOf(it.kind).mistakes[now]?.severity ?? 'warn';
      const entry = { at: store.now, type: 'mistake' as const, itemId: it.id, itemKind: it.kind, mistakeId: now, severity, stepId: run.step?.id ?? null };
      log.push(entry);
      emit({ type: 'mistake', run, entry });
    }
  };

  const advance = () => {
    let run: RunState | null = state.value;
    if (!run || run.done || !ctx || evaluating) return;
    evaluating = true;
    try {
      watchMistakes(run);
      const steps = run.experiment.steps;
      while (run.stepIndex < steps.length && steps[run.stepIndex]!.done(ctx)) {
        const finished = steps[run.stepIndex]!;
        const index: number = run.stepIndex + 1;
        log.push({ at: store.now, type: 'step', stepId: finished.id });
        run = { ...run, stepIndex: index, step: steps[index] ?? null, stepSince: store.now };
        state.set(run);
        emit({ type: 'done', run, step: finished });
        if (run.step) emit({ type: 'step', run, step: run.step });
      }
      if (run.stepIndex >= steps.length) end(run);
    } finally {
      evaluating = false;
    }
  };

  const onChange = (c: LabChange) => {
    const run = state.value;
    if (!run || run.done) return;
    if (c.type === 'refuse') {
      const it = store.get(c.id);
      const entry = { at: c.at, type: 'refused' as const, itemId: c.id, itemKind: it?.kind ?? '', action: c.action.type, reason: c.reason, stepId: run.step?.id ?? null };
      log.push(entry);
      emit({ type: 'refused', run, entry });
      return;
    }
    if (c.type === 'answer' && ctx) {
      const q = run.experiment.steps.find((s) => s.ask?.key === c.key)?.ask;
      const correct = q ? q.correct(ctx) === c.value : null;
      const entry = { at: c.at, type: 'answer' as const, key: c.key, value: c.value, correct, stepId: run.step?.id ?? null };
      log.push(entry);
      emit({ type: 'answer', run, entry });
    }
    if (c.type === 'clear') return;
    advance();
  };
  const offStore = store.subscribe(onChange);

  const runner: Runner = {
    state,
    get ctx() {
      return ctx;
    },
    get log() {
      return log;
    },
    start(experiment, opts = {}) {
      const mode = opts.mode ?? 'practice';
      const seed = opts.seed ?? 1 + Math.floor(Math.random() * 1e6);
      state.set(null);
      log = [];
      seen = new Set();
      active = new Map();
      hints = 0;
      store.clear();
      store.setLab(experiment.lab);
      for (const k of experiment.kit) {
        const params = typeof k.params === 'function' ? k.params(seed) : k.params;
        store.place(k.kind, { x: k.x, z: k.z, yaw: k.yaw ?? 0 }, { params, seed });
      }
      ctx = makeCtx(mode, seed);
      for (const it of store.items()) active.set(it.id, store.mistake(it.id));
      const run: RunState = { experiment, mode, seed, startedAt: store.now, stepIndex: 0, step: experiment.steps[0] ?? null, stepSince: store.now, done: false, result: null };
      state.set(run);
      emit({ type: 'start', run });
      if (run.step) emit({ type: 'step', run, step: run.step });
      advance();
      return state.value!;
    },
    finish() {
      const run = state.value;
      if (!run) return null;
      if (run.done) return run.result;
      return end(run);
    },
    stop() {
      if (!state.value) return;
      state.set(null);
      ctx = null;
      emit({ type: 'stop' });
    },
    hint() {
      const run = state.value;
      if (!run || run.done || run.mode === 'exam' || !run.step) return null;
      hints++;
      log.push({ at: store.now, type: 'hint', stepId: run.step.id });
      return run.step.hint;
    },
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    dispose() {
      offStore();
      fns.clear();
    },
  };
  return runner;
}

/** An answer for `key` the person picked, through the store (so the tutor and the log see it). */
export const answer = (store: LabStore, key: string, v: Prim): void => store.answer(key, v);
