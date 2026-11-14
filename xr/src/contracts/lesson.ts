/**
 * The lesson guide: iynk's lessons, bench tasks and checks as a spatial guide. The state is plain data so the guide
 * panel, the highlights on anchors and the AI partner seam all read the same thing. Pass and fail come from iynk's real
 * checks (`lessonJobFor` and `runChecks`), never from the headset. Contract file: changes only in its own PR (label
 * `contract-change`).
 *
 * Implementation: `xr/src/learn/guide.ts` (`createLessonGuide`); `createFakeGuide` in the same folder for others.
 */
import type { Project } from '@/project/generated/types';
import type { BoardTarget } from './space';
import type { Lang, LocalizedText, ReadonlyValue, Unsubscribe } from './common';

export type StepStatus = 'locked' | 'current' | 'done';
export type Tone = 'info' | 'do' | 'warn' | 'pass' | 'fail';

export interface GuideStep {
  readonly id: string;
  readonly text: LocalizedText;
  readonly status: StepStatus;
  /** What to light up on the bench for this step. */
  readonly highlights: ReadonlyArray<{ target: BoardTarget; tone: Tone }>;
}

export interface GuideCheck {
  readonly id: string;
  readonly label: LocalizedText;
  /** null until the check has run. */
  readonly pass: boolean | null;
  readonly detail?: LocalizedText;
}

export interface LessonGuideState {
  /** `board:uno-r3/blink`, `robotics:l298n/soft-start`, `drone:quad5`. */
  readonly lessonId: string;
  readonly title: LocalizedText;
  readonly lang: Lang;
  readonly steps: readonly GuideStep[];
  readonly current: number;
  /** The project's own callouts (`guide.callouts`), anchored to parts by designator. */
  readonly callouts: ReadonlyArray<{ target: BoardTarget; text: LocalizedText }>;
  readonly checks: { readonly status: 'idle' | 'running' | 'done'; readonly results: readonly GuideCheck[] };
  /** All checks passed with no fault injected; progress has been stored. */
  readonly done: boolean;
  /**
   * The parts the shelf offers while this lesson is open: in a build lesson, the parts still to place, exactly as the
   * template has them (id, refdes, definition, params), so a part taken from the shelf is the lesson's own part.
   * Absent or empty: the shelf is as usual.
   */
  readonly kit?: ReadonlyArray<Project['components'][number]>;
}

export interface LessonGuide {
  readonly state: LessonGuideState;
  subscribe(fn: (state: LessonGuideState) => void): Unsubscribe;
  next(): void;
  back(): void;
  /** Runs the lesson's checks in a worker against the current document. */
  runChecks(): Promise<void>;
  setLang(lang: Lang): void;
}

/** A lab of the catalogue the launcher can show: board lessons, or robotics benches and their tasks. */
export type CatalogueLab = 'board' | 'robotics';

/**
 * Opens lessons and the catalogue. Implemented by the learn pillar (`xr/src/learn/launcher.ts`); Home, the menu and
 * onboarding call it, so no pillar opens a lesson by hand.
 */
export interface LessonLauncher {
  /** Shows the catalogue panel (boards with their lessons, robotics benches with their tasks, with progress). */
  showCatalogue(lab?: CatalogueLab): void;
  /** Hides the catalogue panel. */
  hideCatalogue(): void;
  /**
   * Opens a template (`prj_uno-r3-blink`, `prj_robotics-l298n-soft-start`) as a lesson: forks it as the Studio does,
   * puts it on the bench through `ProjectStore.open`, and sets `XrApp.guide`. With `build`, the bench starts from the
   * board and breadboard alone and the guide leads the build part by part (lessons with a breadboard circuit only).
   */
  open(templateId: string, opts?: { build?: boolean }): Promise<void>;
  /** Closes the open lesson's guide; the project stays on the bench. */
  close(): void;
  /** The lesson last opened, for Home's Continue; null before any. */
  readonly last: ReadonlyValue<{ templateId: string; title: LocalizedText } | null>;
}

/** Progress shared with the 2D site: `localStorage["iynk:v1"]`, same keys as `src/lib/progress/keys.ts`. */
export interface ProgressStore {
  isDone(key: string): boolean;
  markDone(key: string): void;
  /** Forgets every lesson's progress here (the `done`, `quiz` and `best` maps) and keeps the 2D site's settings. */
  reset(): void;
  subscribe(fn: () => void): Unsubscribe;
}
