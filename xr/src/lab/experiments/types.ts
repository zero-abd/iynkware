/**
 * An experiment: a lab's guided procedure over the lab store. Its kit is laid out on the bench when it starts; each
 * step is a predicate over the store that the runner checks after every change, advancing on its own when it holds;
 * a step may ask a question (an answer the person picks). The checks are read at the end and make the result sheet.
 * Every string is an `L6` (six languages). Pure data and predicates: no three.js.
 */
import type { L6 } from '../text';
import type { LabStore } from '../model/store';
import type { ItemState, LabId, Prim, Report } from '../model/types';

export type Mode = 'practice' | 'exam';

/** What steps and checks read. */
export interface ExpCtx {
  readonly store: LabStore;
  readonly mode: Mode;
  /** The seed the kit was laid out with (what the unknown is). */
  readonly seed: number;
  /** The first item of a kind: its state and report, or null when it is not on the bench. */
  item(kind: string): { readonly state: Readonly<ItemState>; readonly report: Report } | null;
  answer(key: string): Prim | undefined;
  /** Whether a mistake has held at any time since the start. */
  ever(mistakeId: string): boolean;
}

export interface KitItem {
  readonly kind: string;
  /** Millimetres on the bench table (x right, z towards the person) and degrees about up. */
  readonly x: number;
  readonly z: number;
  readonly yaw?: number;
  readonly params?: Readonly<Record<string, Prim>> | ((seed: number) => Readonly<Record<string, Prim>>);
}

export interface Choice {
  readonly value: Prim;
  readonly label: L6;
}

export interface Question {
  /** The store's answer key (`salt`, `ohms`). */
  readonly key: string;
  readonly choices: readonly Choice[];
  /** The right answer for this run (the seeded unknown). */
  correct(ctx: ExpCtx): Prim;
}

export interface Step {
  readonly id: string;
  /** What to do (the tutor's instruction). */
  readonly text: L6;
  /** A nudge after a while without progress (practice only). */
  readonly hint: L6;
  /** The item the step is about (where the tutor's callout goes). */
  readonly focus?: string;
  readonly ask?: Question;
  done(ctx: ExpCtx): boolean;
}

export interface Check {
  readonly id: string;
  readonly label: L6;
  pass(ctx: ExpCtx): boolean;
  /** The numbers behind the result, for the sheet. */
  detail?(ctx: ExpCtx): L6;
}

export interface Experiment {
  readonly id: string;
  readonly lab: LabId;
  readonly title: L6;
  readonly goal: L6;
  readonly kit: readonly KitItem[];
  readonly steps: readonly Step[];
  readonly checks: readonly Check[];
  readonly hazards: readonly L6[];
}

/** One line of the run's log. */
export type LogEntry =
  | { readonly at: number; readonly type: 'step'; readonly stepId: string }
  | { readonly at: number; readonly type: 'mistake'; readonly itemId: string; readonly itemKind: string; readonly mistakeId: string; readonly severity: 'warn' | 'hazard' | 'escalate'; readonly stepId: string | null }
  | { readonly at: number; readonly type: 'refused'; readonly itemId: string; readonly itemKind: string; readonly action: string; readonly reason: string; readonly stepId: string | null }
  | { readonly at: number; readonly type: 'answer'; readonly key: string; readonly value: Prim; readonly correct: boolean | null; readonly stepId: string | null }
  | { readonly at: number; readonly type: 'hint'; readonly stepId: string };

export interface CheckResult {
  readonly id: string;
  readonly label: L6;
  readonly pass: boolean;
  readonly detail?: L6;
}

/** The end of a run: what an exam is marked on. Plain data. */
export interface ResultSheet {
  readonly experimentId: string;
  readonly mode: Mode;
  readonly seed: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly completed: boolean;
  readonly stepsDone: number;
  readonly stepsTotal: number;
  readonly checks: readonly CheckResult[];
  /** Safety mistakes (hazard or escalate) that cost points; every mistake is in `log`. */
  readonly mistakes: number;
  readonly refusals: number;
  readonly hints: number;
  /** 0 to 100: the checks passed, less 5 a safety mistake and 2 a refused action, less 3 a hint in practice. */
  readonly score: number;
  readonly log: readonly LogEntry[];
}
