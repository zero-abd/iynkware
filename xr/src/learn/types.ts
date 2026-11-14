/**
 * The learn pillar's internal interfaces. Each slice implements one of them in its own folder and uses the others only
 * through them, so the slices are built in parallel. Not a shared contract: only `xr/src/learn/**` and its tests import
 * this file. Changing an interface here is its own learn PR that updates every implementation.
 *
 * Where each lives:
 *   content/   Catalogue, loadLesson, forkLesson          (catalogue of boards and benches, opening a template)
 *   progress.ts LearnProgress                            (iynk's learner records and the iynk:v1 done map)
 *   build/     BuildPlan                                  (build mode: start from the bare board, part by part)
 *   code/      CodeView, Chip                             (the code with its parameter chips)
 *   faults/    LessonFaults                               (break it and what if)
 *   session/   LessonSession, the launcher's open/close   (steps, real checks, completion, records)
 *   panel/     the spatial UI kit                         (paper panels, buttons, tabs, wrapped text)
 *   lessons/ callouts/ catalogue/ onboarding/            (the FeatureModules: guide panel, highlights, catalogue, first run)
 */
import type { LearnerRecord } from '@/project/guided/record';
import type { Lang, LocalizedText, ReadonlyValue } from '../contracts/common';
import type { LessonGuide, ProgressStore, Tone } from '../contracts/lesson';
import type { Descriptor, Op, Project } from '../contracts/project';
import type { BoardTarget } from '../contracts/space';
import type { Picked } from './text';

export type Component = Project['components'][number];

/** Something to light on the bench, with a short label drawn beside it ("+", "D13"). */
export interface Highlight {
  readonly target: BoardTarget;
  readonly tone: Tone;
  readonly label?: string;
}

/* ---------- catalogue (content/) ---------- */

/** iynk's template kinds: a board tour or lesson (`TemplateEntry`), a robotics bench or one of its tasks (`LabTemplateEntry`). */
export type TemplateKind = 'tour' | 'lesson' | 'bench' | 'task';

export interface CatalogueItem {
  readonly templateId: string;
  readonly kind: TemplateKind;
  readonly title: LocalizedText;
  /** Order within its board or bench. */
  readonly order: number;
  /** Board lessons: iynk's level (`intro`, `io`, `input`, ...); null otherwise. */
  readonly level: string | null;
  readonly stepCount: number;
  /** The board it runs on (`uno-r3`), or null for a bench with its own supply. */
  readonly board: string | null;
}

export interface CatalogueBoard {
  readonly id: string;
  readonly title: LocalizedText;
  /** The tour first, then the lessons by order. */
  readonly items: readonly CatalogueItem[];
}

export interface CatalogueBench {
  readonly id: string;
  readonly title: LocalizedText;
  readonly bench: CatalogueItem;
  readonly tasks: readonly CatalogueItem[];
}

export interface Catalogue {
  readonly boards: readonly CatalogueBoard[];
  readonly benches: readonly CatalogueBench[];
  item(templateId: string): CatalogueItem | undefined;
}

/* ---------- progress (progress.ts) ---------- */

export type ItemProgress = 'none' | 'started' | 'done';

/**
 * What `createProgressStore()` returns (it is also `XrApp.progress`): iynk's learner records (IndexedDB, the same
 * `progress` store and `learn:` rows as the 2D app) and the `iynk:v1` done map, kept in step.
 */
export interface LearnProgress extends ProgressStore {
  readonly ready: Promise<void>;
  record(projectId: string): LearnerRecord | undefined;
  /** iynk's `LearnStore.update`. A record that gains its `completion` also sets its template's iynk:v1 done key. */
  update(projectId: string, fn: (r: LearnerRecord | undefined) => LearnerRecord): void;
  /** Across every record of the template (`templateId ?? projectId`) and the template's iynk:v1 done key. */
  statusOf(templateId: string): ItemProgress;
  /** "4 of 9 lessons". */
  count(templateIds: readonly string[]): { done: number; total: number };
}

/* ---------- build mode (build/) ---------- */

export interface BuildStep {
  /** `part:<component id>` or `wire:<wire id>`, ids as in the template. */
  readonly id: string;
  readonly kind: 'part' | 'wire';
  /** The instruction in the six languages (learn's strings filled with refdes, holes and pins). */
  readonly text: LocalizedText;
  readonly targets: readonly Highlight[];
  /** True when the document has this step done; a part that works somewhere else counts. */
  done(doc: Project): boolean;
  /** What is wrong when the part or wire is there but wrong ("Turn it round: the long leg goes to row 14"); else null. */
  problem(doc: Project): LocalizedText | null;
  /** The ops that do this step on `doc` (Do it for me), net changes included; [] when it is done. One batch. */
  doIt(doc: Project): Op[];
}

export interface BuildPlan {
  /** The template without the steps' parts and wires, still valid for iynk's schema: what the bench starts from. */
  readonly start: Project;
  /** The parts to place, exactly as the template has them. */
  readonly kit: readonly Component[];
  readonly steps: readonly BuildStep[];
}

/** `buildPlan(template, describe)` in build/; null when the template has nothing to build on a breadboard. */
export type BuildPlanner = (template: Project, describe: (ref: string, version?: string) => Descriptor | undefined) => BuildPlan | null;

/* ---------- code and chips (code/) ---------- */

export type TokenKind = 'plain' | 'keyword' | 'type' | 'number' | 'string' | 'comment' | 'function' | 'chip';

export interface CodeSpan {
  readonly text: string;
  readonly kind: TokenKind;
  /** For a chip: the parameter id. */
  readonly chip?: string;
}

export interface CodeLine {
  readonly n: number;
  readonly spans: readonly CodeSpan[];
}

export interface Chip {
  /** Parameter id (`par_on`). */
  readonly param: string;
  /** The `{{p:<name>}}` slot name (`on`). */
  readonly name: string;
  readonly label: LocalizedText;
  readonly kind: 'number' | 'choice' | 'toggle';
  readonly value: string | number | boolean;
  /** A choice's options, or a number's stepper values (100, 250, 500, 1000, 2000 within its range). */
  readonly options: ReadonlyArray<{ readonly value: string | number | boolean; readonly label: LocalizedText }>;
  readonly unit?: string;
  /** In the code (a slot), or only on the circuit (`par_resistor` sets RES1's ohms). */
  readonly inCode: boolean;
}

export interface CodeView {
  readonly sourceId: string | null;
  readonly language: string;
  readonly lines: readonly CodeLine[];
  readonly chips: readonly Chip[];
}

/* ---------- faults (faults/) ---------- */

export interface LessonFault {
  /** The board catalogue's failure (`no-resistor`). */
  readonly failureId: string;
  /** The project fault it switches (`fault.set`). */
  readonly faultId: string;
  /** The lesson's own fault, or one more on this board. */
  readonly own: boolean;
  readonly title: Picked;
  readonly symptom: Picked;
  readonly explanation: Picked;
  readonly fix: Picked;
  readonly on: boolean;
}

export interface LessonFaults {
  readonly offers: readonly LessonFault[];
  /** Failures of the board the simulator does not model yet. */
  readonly unmapped: ReadonlyArray<{ readonly failureId: string; readonly title: Picked }>;
  /** The What if prompt: the lesson's own first fault, else the board's first; null when none. */
  readonly whatIf: LessonFault | null;
}

/* ---------- the session (session/) ---------- */

export type StepState = 'notStarted' | 'current' | 'done' | 'blocked';

export interface SessionStep {
  readonly index: number;
  readonly id: string;
  /** `text`: a lesson step; `part`, `wire`: a build step; `run`: build mode's last step; `assembly`: a bench build step. */
  readonly kind: 'text' | 'part' | 'wire' | 'run' | 'assembly';
  readonly title: LocalizedText | null;
  readonly text: LocalizedText;
  readonly state: StepState;
  /** A gate on the bench ticks it; otherwise Next marks it done. */
  readonly gated: boolean;
  readonly targets: readonly Highlight[];
  /** What is wrong right now, shown under the step. */
  readonly problem: LocalizedText | null;
  /** Do it for me can do it. */
  readonly canDo: boolean;
}

export interface SessionCheck {
  readonly testId: string;
  readonly checkId: string;
  /** Empty for a hidden check. */
  readonly label: LocalizedText;
  readonly kind: string;
  readonly state: 'notRun' | 'running' | 'pass' | 'fail';
  /** iynk's measurement ("1/2", "2.03 V") or why it could not be judged (`needs-analog`, `no-board`, ...). */
  readonly detail?: string;
  readonly hidden: boolean;
  /** A `code` check: it matches text, it does not prove the code runs. */
  readonly textCheck: boolean;
  /** The pin or part the check reads, where a finding is pinned. */
  readonly target?: BoardTarget;
}

/** iynk's reasons a lesson is not complete yet (`evaluateCompletion().open`). */
export type OpenReason = 'edit' | 'quiz' | 'checks' | 'fault' | 'steps' | 'goal' | 'diagnosis';

export interface SessionQuiz {
  readonly id: string;
  readonly afterStep: string | null;
  readonly questions: ReadonlyArray<{
    readonly id: string;
    readonly q: LocalizedText;
    readonly options: readonly LocalizedText[];
    readonly answer: number;
    readonly why: LocalizedText;
    /** The person's stored choice, or null. */
    readonly chosen: number | null;
  }>;
}

export interface LessonSessionState {
  readonly templateId: string;
  readonly projectId: string;
  readonly kind: TemplateKind;
  readonly build: boolean;
  readonly title: LocalizedText;
  readonly lede: LocalizedText | null;
  readonly lang: Lang;
  readonly steps: readonly SessionStep[];
  /** The step the panel shows: the current one, unless the person stepped back or ahead. */
  readonly viewIndex: number;
  readonly checks: {
    readonly status: 'idle' | 'running' | 'done' | 'limit';
    readonly progress: number;
    readonly rows: readonly SessionCheck[];
    readonly error: { readonly line: number; readonly message: string } | null;
  };
  /** iynk's completion rule; null when the template has no guided plan. */
  readonly completion: { readonly complete: boolean; readonly open: readonly OpenReason[] } | null;
  /** The learner record has its completion: done in both products. */
  readonly done: boolean;
  readonly quizzes: readonly SessionQuiz[];
  readonly hints: ReadonlyArray<{ readonly level: number; readonly text: LocalizedText }>;
  readonly hintsOpened: number;
  /** Project fault ids switched on (`simulation.faults[].enabled`). */
  readonly activeFaults: readonly string[];
  /** The kit still to place (build mode); empty otherwise. */
  readonly kit: readonly Component[];
}

export interface LessonSession {
  readonly state: ReadonlyValue<LessonSessionState>;
  /** The contract view (`XrApp.guide`). */
  readonly guide: LessonGuide;
  view(index: number): void;
  back(): void;
  /** Marks the viewed step done when no gate ticks it, then shows the next step. */
  next(): void;
  /** Does the step for the person (one undo). In onboarding this finishes the step, but the lesson does not count. */
  doIt(index: number): void;
  runChecks(): Promise<void>;
  cancelChecks(): void;
  answer(quizId: string, questionId: string, choice: number): void;
  openHint(level: number): void;
  setLang(lang: Lang): void;
  /** Back to the start document; progress is kept. */
  reset(): void;
  dispose(): void;
}
