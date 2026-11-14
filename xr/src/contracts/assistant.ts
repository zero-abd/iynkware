/**
 * The co-builder seam: an actor that builds hardware alongside the person in the headset. It reads a compact snapshot
 * of the bench, proposes a plan of ordinary project ops (one step per part or wire, a short reason each), and each step
 * is shown as a ghost at the real anchors and performed only after the person accepts it: accept one, accept all,
 * reject, undo. Its edits are authored under its own actor id in the project session, so they are attributed and
 * undoable, and they go through the one project store and the same op builders the person's hands use. Nothing it
 * does bypasses them. Contract file: changes only in its own PR (label `contract-change`).
 *
 * Today the co-builder is scripted (no model): it builds a template step by step. A real AI partner implements
 * `CoBuilder` (snapshot in, plan out); voice sits in front of `CoBuildSession` (speech to accept, reject, undo, stop and
 * to `BuildGoal` `ask`, `PlanStep.reason` spoken back). docs/XR_ARCHITECTURE.md, "Co-builder".
 *
 * Implementation: `xr/src/assistant/` (scripted co-builder, session, presence, the "Build it with me" action).
 */
import type {
  Board,
  Component,
  ComponentDependency,
  Op,
  Placement,
  Project,
  WireColor,
  WireEnd,
} from '@/project/generated/types';
import type { ApplyResult } from '@/project/session';
import type { Lang, LocalizedText, ReadonlyValue, Unsubscribe } from './common';
import type { RunState } from './sim';
import type { BoardTarget } from './space';

// ---------------------------------------------------------------------------------------------------------------------
// Snapshot in: what a co-builder sees. Plain JSON (no Maps, no functions, no meshes), small enough to send to a model.

/**
 * A pin of a part or board, `<entity id>.<pin id>`: `brd_main.D13`, `cmp_led1.A`. A breadboard hole is a pin of its
 * breadboard (`cmp_bb.a10`), as the project's own rules have it.
 */
export type PinKey = string;

export interface SnapshotPart {
  readonly id: string;
  readonly refdes: string;
  readonly kind: 'board' | 'component';
  /** `core.led-5mm@1.0.0` */
  readonly def: string;
  /** Parameter values with `{param}` bindings resolved. Absent when the part sets none. */
  readonly params?: Readonly<Record<string, string | number | boolean | null>>;
  /** Where it is on the bench (the breadboard view); absent when it is in the project but not on the bench. */
  readonly at?: {
    readonly xMm: number;
    readonly yMm: number;
    readonly rotationDeg: number;
    /** Leg (pin id) to hole, for a part seated in the breadboard. */
    readonly legs?: Readonly<Record<string, string>>;
  };
}

export interface SnapshotNet {
  readonly id: string;
  readonly name?: string;
  readonly class?: 'signal' | 'power' | 'ground' | 'analog';
  readonly pins: readonly PinKey[];
}

export interface SnapshotWire {
  readonly id: string;
  /** A pin or hole end as a `PinKey`; a junction end as `junction:<id>`. */
  readonly from: string;
  readonly to: string;
  readonly net: string;
  readonly color?: WireColor;
}

export interface SnapshotSource {
  readonly id: string;
  readonly path: string;
  readonly language: string;
  /** The text, cut at a few thousand characters (`truncated` says so). */
  readonly text: string;
  readonly truncated: boolean;
}

export interface ProjectSummary {
  readonly id: string;
  readonly title: string;
  readonly revision: number;
  readonly parts: readonly SnapshotPart[];
  /** The breadboard parts are seated in, or null when the bench has none. */
  readonly surface: string | null;
  readonly nets: readonly SnapshotNet[];
  readonly wires: readonly SnapshotWire[];
  readonly sources: readonly SnapshotSource[];
}

export interface RunSummary {
  readonly state: RunState;
  /** Simulated time of the last frame, ms; null before the first frame. */
  readonly atMs: number | null;
}

export interface FindingSummary {
  /** The fault rule (`led-no-resistor`). */
  readonly rule: string;
  readonly severity: 'error' | 'warning' | 'note';
  /** Message key in the `faults` namespace and its arguments, so a model can say it in the person's language. */
  readonly key: string;
  readonly args: Readonly<Record<string, string | number>>;
  /** What it is about: `part:cmp_led1`, `pin:brd_main.D13`, `net:net_gnd`, `wire:wir_1`. */
  readonly targets: readonly string[];
}

export interface LessonSummary {
  readonly lessonId: string;
  readonly title: string;
  /** Index of the current step, from 0, and how many there are. */
  readonly step: number;
  readonly steps: number;
  /** The current step's text in the person's language. */
  readonly text: string;
  readonly done: boolean;
}

/** The bench as a co-builder sees it. Version 1; a field is only ever added, never changed in meaning. */
export interface BenchSnapshot {
  readonly v: 1;
  readonly lang: Lang;
  readonly project: ProjectSummary;
  /** Entity ids the person has selected. */
  readonly selection: readonly string[];
  readonly run: RunSummary;
  /** Problems the simulation posted at the last pause or run end. */
  readonly findings: readonly FindingSummary[];
  /** The open lesson, or null. */
  readonly lesson: LessonSummary | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Plan out: steps of ordinary ops.

/** What the person asked the co-builder for. */
export type BuildGoal =
  /** Build this project (a template) on the bench, from what is there now. */
  | { readonly kind: 'build'; readonly target: Project }
  /** A free request ("add a button on D2"), from voice or a later text field. A scripted co-builder plans nothing. */
  | { readonly kind: 'ask'; readonly text: string };

export interface BuildRequest {
  readonly goal: BuildGoal;
  /** Step keys the person rejected in this session. A plan never proposes them again, nor steps that need them. */
  readonly declined: readonly string[];
}

/** What a step does, for the presence's choreography: carry a part, draw a wire, or change something in place. */
export type PlanStepKind = 'place' | 'wire' | 'connect' | 'set';

export interface PlanStep {
  /** Stable across re-plans (`place:cmp_led1`, `wire:wir_1`); declines and the session's log refer to it. */
  readonly key: string;
  readonly kind: PlanStepKind;
  /**
   * Ordinary project ops, the ones the person's hands make for the same action (`BuildRecipes`). One step is one
   * `apply`, so one undo entry. Applied exactly as previewed.
   */
  readonly ops: readonly Op[];
  /** Why this step, in one short sentence in the snapshot's language, shown on the proposal card. */
  readonly reason: string;
  /** The undo label and ticker text, in the snapshot's language ("Place LED1", "Wire D13 to a10"). */
  readonly label: string;
  /** The part a `place` step brings from the shelf (entity id). */
  readonly part?: string;
  /** What the step touches, in the order the presence points at them: holes for legs, both ends of a wire. */
  readonly anchors: readonly BoardTarget[];
  /** Keys of steps that must be performed before this one. */
  readonly needs: readonly string[];
}

export interface BuildPlan {
  /** A proposal id (`prp_...`), recorded as the op envelope's `proposal` on the ops it leads to. */
  readonly id: string;
  /** The document revision it was planned against. The session plans again when the document moved on without it. */
  readonly baseRevision: number;
  /** One line for the card header, in the snapshot's language ("Let's build Blink an LED"). */
  readonly summary: string;
  /** In order. Empty when there is nothing left to do. */
  readonly steps: readonly PlanStep[];
  /** What it could not plan and why, in the snapshot's language. Shown, never dropped silently. */
  readonly unreachable: ReadonlyArray<{ readonly key: string; readonly why: string }>;
}

/**
 * The op builders the person's hands use (the 2D Studio's seat and wire rules, one code path for both apps). A
 * co-builder says what to do; these say how, in ops, against a given document. They never apply anything.
 */
export interface BuildRecipes {
  /**
   * Puts a board or component on the bench: its dependency when the project lacks it (`dependency`, else the built-in
   * part's), the entity when the project lacks it, its placement in `view`, the view's surface when the entity is a
   * breadboard and the view has none, and, when seated in holes (`placement.legs`), the net ops its legs make.
   */
  place(
    doc: Project,
    view: string,
    entity: { kind: 'board'; board: Board } | { kind: 'component'; component: Component },
    placement: Placement,
    opts?: { dependency?: ComponentDependency },
  ): Op[];
  /**
   * One wire between two ends, with the net ops it implies and the colour the Studio would give it unless `color`.
   * Throws a `RangeError` for ends the Studio cannot wire (a junction, or two holes on empty rows).
   */
  wire(doc: Project, view: string, from: WireEnd, to: WireEnd, opts?: { id?: string; color?: WireColor }): Op[];
}

/** What a co-builder gets for one proposal. */
export interface CoBuilderContext {
  readonly snapshot: BenchSnapshot;
  readonly request: BuildRequest;
  /** The whole document, read only, for a co-builder that runs on the device. A remote model is sent `snapshot` only. */
  readonly doc: Project;
  readonly recipes: BuildRecipes;
}

/** An actor that builds alongside the person: scripted today, an AI model (with voice) later. */
export interface CoBuilder {
  /** Actor id on its ops, an actor id as the project schema has them (`usr_cobuilder`); one per co-builder. */
  readonly actor: string;
  /** Recorded as the op envelope's `model` (`scripted@1`). */
  readonly model: string;
  readonly name: LocalizedText;
  /**
   * Snapshot in, plan out. May take time (a model call); the session shows the companion thinking meanwhile. Must not
   * change the document: only the session applies, and only accepted steps.
   */
  propose(ctx: CoBuilderContext): Promise<BuildPlan>;
}

// ---------------------------------------------------------------------------------------------------------------------
// The session: propose, ghost, accept, perform.

/**
 * `thinking`: waiting for a plan. `proposing`: the current step is ghosted on the bench and waits for the person.
 * `performing`: the companion is carrying or wiring it; the ops land when it arrives. `done`: nothing left to do.
 * `stopped`: the person stopped it. `failed`: the co-builder failed or a step was refused (`message` says why).
 */
export type CoBuildStatus = 'thinking' | 'proposing' | 'performing' | 'done' | 'stopped' | 'failed';

export interface CoBuildState {
  readonly status: CoBuildStatus;
  /** The co-builder's actor id. */
  readonly actor: string;
  readonly plan: BuildPlan | null;
  /** The step on the proposal card (proposed or being performed), or null. */
  readonly current: PlanStep | null;
  /** Steps the co-builder performed in this session, oldest first; `undo` takes back the last. */
  readonly performed: ReadonlyArray<{ readonly key: string; readonly label: string; readonly revision: number }>;
  readonly declined: readonly string[];
  /** Accept all is on: each following step is shown and then performed without asking. */
  readonly auto: boolean;
  /** Why it stopped or failed, in the person's language. */
  readonly message?: string;
}

/**
 * One "Build it with me" run. Every call is safe in any state: a call that does not fit the state does nothing. These
 * are the verbs a voice front-end maps speech to ("yes", "do the rest", "no", "undo that", "stop").
 */
export interface CoBuildSession {
  readonly state: ReadonlyValue<CoBuildState>;
  /** Performs the proposed step, then proposes the next. */
  accept(): Promise<void>;
  /** Performs the proposed step and every one after it, each shown before it is performed. Any other call ends it. */
  acceptAll(): Promise<void>;
  /** Skips the proposed step for the rest of the session and proposes the next one that does not need it. */
  reject(): Promise<void>;
  /**
   * Takes back the co-builder's last performed step (one undo of its own entry) and proposes it again. Also works once
   * the session is done.
   */
  undo(): Promise<void>;
  /** Ends the session; what was performed stays. */
  stop(): void;
  /** Resolves with the state the first time the session is done, stopped or failed. */
  readonly finished: Promise<CoBuildState>;
}

/**
 * The "Build it with me" action. Other pillars (the lesson's guided build, Home, the menu) call this; it is meant to sit
 * on `XrApp` (#107).
 */
export interface AssistantService {
  /**
   * Builds `target` (a project, or a template id) together with the person. `from: 'empty'` (the default) opens an
   * empty bench for it first: the target's code, checks and parameters, no part on the bench. `from: 'bench'` builds
   * on what is on the bench now (a lesson's build mode, after the person placed some parts). `builder` overrides the
   * default co-builder for this run; `auto` starts it in accept all. Ends a running session. Resolves once the first
   * step is proposed (with `auto`, as soon as the session starts).
   */
  buildWithMe(target: Project | string, opts?: { from?: 'empty' | 'bench'; builder?: CoBuilder; auto?: boolean }): Promise<CoBuildSession>;
  /** The running session (kept once done, so its last step can still be undone), or null once stopped. */
  readonly session: ReadonlyValue<CoBuildSession | null>;
  /** The snapshot a co-builder would be given now. */
  snapshot(): BenchSnapshot;
  /** Makes `builder` the default co-builder (a model-backed one later); the returned function restores the previous. */
  use(builder: CoBuilder): Unsubscribe;
}

// ---------------------------------------------------------------------------------------------------------------------
// What the co-builder needs from the project store.

/** The author of a co-builder's ops, as the op envelope records it (`kind: 'ai'`, with the model). */
export interface CoAuthor {
  /** `usr_...`, as the project schema has actor ids. */
  readonly actor: string;
  readonly kind: 'ai';
  readonly model?: string;
}

/**
 * Ops authored by one actor in the project session: its own undo stack, so undoing the co-builder never undoes the
 * person and the reverse. `DocChange.origin` is `ai` for them. Requested from `ProjectStore` as `as(author)` (#106);
 * `xr/src/assistant/actor.ts` adapts the plain store until then.
 */
export interface AuthoredChannel {
  readonly author: CoAuthor;
  /** One call is one undo entry of this actor. `proposal` (a plan id, `prp_...`) goes on each op's envelope. */
  apply(ops: Op | readonly Op[], opts?: { label?: string; proposal?: string }): ApplyResult;
  /** Reverts this actor's latest entry. Null when there is none. */
  undo(): ApplyResult | null;
  canUndo(): boolean;
}
