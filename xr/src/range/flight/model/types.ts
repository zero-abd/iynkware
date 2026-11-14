/** Types of the drone bench model: a craft's bench rules, the bench state, its actions and what it says. */
import type { DesignPick } from '@/content/schema';
import type { FlightReadiness } from '@/lib/dronelab/figure';

export interface BenchPart {
  readonly id: string;
  /** English short name (translated through `src/i18n/figures/<lang>.json`). */
  readonly short: string;
  /** Parts that must be on first. */
  readonly after: readonly string[];
  /** Fits two ways round: orientation 1 is the wrong way. */
  readonly polar: boolean;
  /** Mistake code when fitted the wrong way (else the engine's default for FC, XT60, PROPS). */
  readonly mistake?: string;
  /** Strip order: higher comes off first. */
  readonly z: number;
}

export type EngineTest = 'smoke' | 'motors' | 'calibrate' | 'plug';

export interface BenchCraft {
  readonly id: string;
  readonly parts: readonly BenchPart[];
  /** The engine tests this craft has, with the parts each needs on. */
  readonly tests: Readonly<Partial<Record<EngineTest, readonly string[]>>>;
  readonly motors: ReadonlyArray<{ readonly id: string; readonly dir: 'CW' | 'CCW' }>;
  /** Battery picks that are LiHV (4.35 V a cell when full; the rest 4.2 V). */
  readonly hvBatts?: readonly string[];
  /** The craft's own English wording of engine messages and log lines, by key. */
  readonly messages?: Readonly<Record<string, string>>;
  readonly logs?: Readonly<Record<string, string>>;
}

/** Phase leads of one motor: two swapped make it spin the wrong way. */
export type PhaseLeads = 'straight' | 'crossed';

/**
 * The bench, as plain JSON (it is stored in the project document). Parts on the bench with their orientation (0 the
 * right way, 1 the wrong way), the battery, the capacitor fault, the test passes, and the motor wiring.
 */
export interface BenchState {
  readonly placed: Readonly<Record<string, 0 | 1>>;
  readonly plugged: boolean;
  /** The part that failed (the XT60 capacitor popped), else null. */
  readonly fault: string | null;
  readonly smokeOk: boolean;
  readonly motorOk: boolean;
  readonly accOk: boolean;
  /** How many times the motor wires went on (the figure picks the wrong motor from it). */
  readonly wireJobs: number;
  /** Motors whose phase leads are crossed. */
  readonly crossed: readonly string[];
  /** Motors reversed in the ESC configurator. */
  readonly escReversed: readonly string[];
  /** The motor the last motor test found spinning the wrong way. */
  readonly wrongMotor: string | null;
}

/** A value in a message: text, a number, or a part (its short name, lower-cased where the figure lower-cases it). */
export type MessageVar = string | number | { readonly part: string; readonly lower?: boolean };

/**
 * What the bench says or logs, as data: `key` is a figure engine `MSG` key (`kind: 'say'`) or `LOG` key (`kind: 'log'`);
 * the English text is the craft's own wording or the engine's, translated through `src/i18n/figures/<lang>.json`.
 */
export interface BenchMessage {
  readonly kind: 'say' | 'log';
  readonly key: string;
  readonly vars?: Readonly<Record<string, MessageVar>>;
}

export type BenchAction =
  | { readonly type: 'add'; readonly part: string; readonly orient?: 0 | 1 }
  | { readonly type: 'remove'; readonly part: string }
  /** Build it for me. */
  | { readonly type: 'build' }
  | { readonly type: 'strip' }
  /** The battery: toggle, or plug in and unplug. */
  | { readonly type: 'plug' }
  | { readonly type: 'plugIn' }
  | { readonly type: 'unplug' }
  | { readonly type: 'smoke' }
  | { readonly type: 'motors' }
  | { readonly type: 'calibrate' }
  /** The guide's step: the first `n` parts on the right way round, the rest off. */
  | { readonly type: 'step'; readonly n: number }
  /** Cross (or uncross) one motor's phase leads. */
  | { readonly type: 'cross'; readonly motor: string };

export interface BenchResult {
  readonly state: BenchState;
  /** What the bench says (the last one wins on screen) and logs, in order. */
  readonly messages: readonly BenchMessage[];
}

/** The figure's `report` (docs/FIGURES-DRONE.md 10.2), so `armingRules` and `canArm` read it unchanged. */
export interface BenchReport {
  readonly craft: string;
  readonly fitted: number;
  readonly total: number;
  readonly placed: Readonly<Record<string, 0 | 1>>;
  readonly next: string | null;
  readonly built: boolean;
  readonly plugged: boolean;
  readonly powered: boolean;
  readonly fault: string | null;
  readonly smokeOk: boolean;
  readonly motorOk: boolean;
  readonly accOk: boolean;
  readonly wrongMotor: string | null;
  /** Motors that would spin the wrong way now (crossed leads not undone in the ESC). */
  readonly wrongMotors: readonly string[];
  readonly flight: FlightReadiness;
}

export type { DesignPick };
