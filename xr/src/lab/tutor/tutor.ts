/**
 * The lab tutor: deterministic, no network. It watches the lab store and the experiment runner and says what to do
 * next (instruct), what went well (praise), what is going wrong (warn), what is dangerous (hazard) and, when the person
 * is stuck, a nudge (hint). Every event carries the item it is about and the whole text in six languages.
 *
 * Pacing (lab clock, so tests drive it):
 *   - a mistake is said when it starts; while it lasts it is said again every REPEAT_MS, never every frame;
 *   - an `escalate` mistake (gas on and unlit, an overloaded resistor) turns into a hazard once it has lasted
 *     ESCALATE_MS; a `hazard` one is a hazard at once; a hazard that clears gets "that is safe now";
 *   - in practice, a hint after HINT_MS on one step without finishing it, then every HINT_REPEAT_MS;
 *   - in an exam it is quiet: no instructions, praise, hints or warnings, only hazards (safety comes first).
 * Mistakes are looked at every CHECK_MS, not every frame. `tick` allocates nothing unless it says something.
 */
import type { Unsubscribe } from '../../contracts/common';
import { fill, type L6 } from '../text';
import { notesOf, refusalText, type Severity } from '../model/catalogue';
import type { LabStore } from '../model/store';
import type { Runner } from '../experiments/runner';
import { TUTOR } from './strings';

export type TutorKind = 'instruct' | 'praise' | 'warn' | 'hazard' | 'hint';

export interface TutorEvent {
  /** Increases by one per event. */
  readonly seq: number;
  readonly kind: TutorKind;
  /** The placed item it is about, or null (the experiment as a whole). */
  readonly equipmentId: string | null;
  readonly itemKind: string | null;
  readonly mistakeId?: string;
  readonly experimentId?: string;
  readonly stepId?: string;
  /** All six languages (a `LocalizedText`). */
  readonly text: L6;
  /** Lab clock, ms. */
  readonly at: number;
}

export interface Tutor {
  /** Call once a frame, after `store.step`. */
  tick(): void;
  subscribe(fn: (e: TutorEvent) => void): Unsubscribe;
  /** The last events, oldest first (at most RECENT). */
  readonly recent: readonly TutorEvent[];
  /** Mistakes holding now, per item, with when each started. */
  readonly active: ReadonlyMap<string, { readonly mistakeId: string; readonly since: number; readonly severity: Severity }>;
  dispose(): void;
}

export const CHECK_MS = 200;
export const REPEAT_MS = 12_000;
export const ESCALATE_MS = 5_000;
export const HINT_MS = 25_000;
export const HINT_REPEAT_MS = 40_000;
export const RECENT = 20;

interface Watch {
  mistakeId: string;
  severity: Severity;
  since: number;
  lastSaid: number;
  escalated: boolean;
  /** It was ever said as a hazard (so clearing it is worth a word). */
  hazard: boolean;
}

export function createTutor(store: LabStore, runner: Runner): Tutor {
  const fns = new Set<(e: TutorEvent) => void>();
  const recent: TutorEvent[] = [];
  const watches = new Map<string, Watch>();
  let seq = 0;
  let lastCheck = -Infinity;
  let lastHint = -Infinity;

  const exam = () => runner.state.value?.mode === 'exam' && !runner.state.value.done;
  const say = (e: Omit<TutorEvent, 'seq' | 'at' | 'experimentId'> & { experimentId?: string }) => {
    if (exam() && e.kind !== 'hazard') return;
    const run = runner.state.value;
    const ev: TutorEvent = { seq: ++seq, at: store.now, experimentId: run?.experiment.id, ...e };
    recent.push(ev);
    if (recent.length > RECENT) recent.shift();
    for (const fn of [...fns]) fn(ev);
  };

  const check = () => {
    const now = store.now;
    const items = store.items();
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const id = store.mistake(it.id);
      let w = watches.get(it.id);
      if (w && w.mistakeId !== id) {
        if (w.hazard && !id) say({ kind: 'praise', equipmentId: it.id, itemKind: it.kind, mistakeId: w.mistakeId, text: TUTOR.safeNow });
        watches.delete(it.id);
        w = undefined;
      }
      if (!id) continue;
      const note = notesOf(it.kind).mistakes[id];
      const severity: Severity = note?.severity ?? 'warn';
      const text = note?.say ?? TUTOR.stepDone;
      if (!w) {
        w = { mistakeId: id, severity, since: now, lastSaid: now, escalated: false, hazard: severity === 'hazard' };
        watches.set(it.id, w);
        say({ kind: severity === 'hazard' ? 'hazard' : 'warn', equipmentId: it.id, itemKind: it.kind, mistakeId: id, stepId: runner.state.value?.step?.id, text });
        continue;
      }
      if (severity === 'escalate' && !w.escalated && now - w.since >= ESCALATE_MS) {
        w.escalated = true;
        w.hazard = true;
        w.lastSaid = now;
        say({ kind: 'hazard', equipmentId: it.id, itemKind: it.kind, mistakeId: id, stepId: runner.state.value?.step?.id, text: fill(TUTOR.stillThere, { say: text }) });
      } else if (now - w.lastSaid >= REPEAT_MS) {
        w.lastSaid = now;
        const kind = w.hazard ? 'hazard' : 'warn';
        say({ kind, equipmentId: it.id, itemKind: it.kind, mistakeId: id, stepId: runner.state.value?.step?.id, text: fill(TUTOR.stillThere, { say: text }) });
      }
    }
    // Items that left the bench.
    if (watches.size > items.length) for (const id of [...watches.keys()]) if (!store.get(id)) watches.delete(id);
  };

  const hintCheck = () => {
    const run = runner.state.value;
    if (!run || run.done || run.mode === 'exam' || !run.step) return;
    const now = store.now;
    if (now - run.stepSince < HINT_MS || now - lastHint < HINT_REPEAT_MS) return;
    lastHint = now;
    const focus = run.step.focus ? store.byKind(run.step.focus) : undefined;
    say({ kind: 'hint', equipmentId: focus?.id ?? null, itemKind: focus?.kind ?? null, stepId: run.step.id, text: run.step.hint });
  };

  const offRunner = runner.subscribe((e) => {
    if (e.type === 'start' && e.run.mode === 'exam') {
      // Said before the exam goes quiet: the only words of the run.
      const ev: TutorEvent = { seq: ++seq, kind: 'instruct', equipmentId: null, itemKind: null, experimentId: e.run.experiment.id, text: TUTOR.examStart, at: store.now };
      recent.push(ev);
      for (const fn of [...fns]) fn(ev);
    }
    if (e.type === 'start') {
      watches.clear();
      lastHint = -Infinity;
    }
    if (e.type === 'step') {
      const focus = e.step.focus ? store.byKind(e.step.focus) : undefined;
      say({ kind: 'instruct', equipmentId: focus?.id ?? null, itemKind: focus?.kind ?? null, stepId: e.step.id, text: e.step.text });
    }
    if (e.type === 'done') say({ kind: 'praise', equipmentId: null, itemKind: null, stepId: e.step.id, text: TUTOR.stepDone });
    if (e.type === 'finish') {
      const ev: TutorEvent = {
        seq: ++seq,
        kind: 'praise',
        equipmentId: null,
        itemKind: null,
        experimentId: e.result.experimentId,
        text: fill(e.result.mode === 'exam' ? TUTOR.examFinished : TUTOR.finished, { score: e.result.score }),
        at: store.now,
      };
      recent.push(ev);
      for (const fn of [...fns]) fn(ev);
    }
  });

  const offStore = store.subscribe((c) => {
    if (c.type === 'refuse') {
      const it = store.get(c.id);
      say({ kind: 'warn', equipmentId: c.id, itemKind: it?.kind ?? null, stepId: runner.state.value?.step?.id, text: refusalText(c.reason) });
    }
    // A cleared bench (another lab, an experiment starting, leaving) starts the conversation over.
    if (c.type === 'clear') {
      watches.clear();
      recent.length = 0;
    }
    // An action is a moment to look at once, so a mistake it causes is said without waiting for the next check.
    if (c.type === 'apply') lastCheck = -Infinity;
  });

  return {
    tick() {
      if (store.now - lastCheck < CHECK_MS) return;
      lastCheck = store.now;
      check();
      hintCheck();
    },
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    recent,
    active: watches,
    dispose() {
      offRunner();
      offStore();
      fns.clear();
    },
  };
}
