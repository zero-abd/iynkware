/**
 * The run cluster's state machine (docs/XR_DESIGN.md 6.1), pure so it is tested in node. Inputs are the bridge's run
 * states, presses on the four plates, the clock (`tick`), the session's visibility, document edits and the bridge's
 * diagnostics; `next` returns the new state and the effects for the driver (`index.ts`) to carry out in order. `viewOf`
 * says what each plate shows.
 *
 *   stopped    bridge unloaded, idle, done      Run                         Run or Step loads first
 *   compiling  while load runs, >= 600 ms       ring filling, "Compiling"   then uploading
 *   uploading  600 ms after compiling          ring filling, "Uploading"   then running (Run) or paused (Step)
 *   running    bridge running                  Pause
 *   paused     bridge paused                   Run (+ "Away")              Run resumes without loading again
 *   faulted    bridge halted, limit, error     Run + the reason badge      Run loads again
 *
 * Our own commands move the phase at once (the bridge confirms later, and an echo of what we asked is a no-op); a
 * bridge state we did not ask for (the model halting, another caller pausing) moves it when it arrives.
 */
import { classifyOp } from '@/project/opImpact';
import type { DocChange } from '../../contracts/project';
import type { RunState } from '../../contracts/sim';

export type Phase = 'stopped' | 'compiling' | 'uploading' | 'running' | 'paused' | 'faulted';
export type Control = 'reset' | 'step' | 'run' | 'speed';
/** Why the run is not running: `away` on a pause, the rest on `faulted`. */
export type Reason = 'away' | 'no-code' | 'refused' | 'limit' | 'halted' | 'contention' | 'stuck';
/** `world.visibilityState` values (IWSDK `VisibilityState`). */
export type Visibility = 'non-immersive' | 'hidden' | 'visible' | 'visible-blurred';
/** What a document change means for a run: `circuit` reloads it, `code` needs a restart, `none` is layout only. */
export type EditKind = 'circuit' | 'code' | 'none';
export type RunCueName = 'run-start' | 'run-stop';

/** Speed steps, simulated seconds per wall second. */
export const SPEEDS = [0.1, 0.25, 0.5, 1, 2] as const;
export const SPEED_LABELS = ['x1/10', 'x1/4', 'x1/2', 'x1', 'x2'] as const;
export const REAL_TIME = 3;
/** The least time each of compiling and uploading shows (6.1, as the lesson runner). */
export const COMPILE_MS = 600;
export const UPLOAD_MS = 600;
/** Step: 10 ms of simulated time. */
export const STEP_MS = 10;
/** Frames come at least every 250 simulated ms (the heartbeat); the clock runs ahead of the last frame by at most that. */
export const HEARTBEAT_S = 0.25;

export interface ClusterState {
  readonly phase: Phase;
  /** When the phase began, ms (the compiling and uploading rings). */
  readonly since: number;
  /** What the end of uploading leads to. */
  readonly then: 'run' | 'step';
  /** Id of the latest load; a `loaded` with any other id is late and ignored. */
  readonly loadId: number;
  /** Compiling: the latest load resolved ok. */
  readonly loaded: boolean;
  /** A circuit edit reloads a running or paused run in place; its load is in flight. */
  readonly reloading: boolean;
  readonly reason: Reason | null;
  /** A code edit while a program is loaded: Run carries "Restart to apply" until the next Reset or load. */
  readonly restart: boolean;
  /** Index into `SPEEDS`; kept through Reset and loads. */
  readonly speed: number;
  readonly visibility: Visibility;
  /** The kind of the last run diagnostic since the last load (`output-contention`, `no-time-progress`, ...). */
  readonly diagnostic: string | null;
}

export type Effect =
  | { readonly t: 'load'; readonly id: number }
  | { readonly t: 'run' }
  | { readonly t: 'pause' }
  | { readonly t: 'step'; readonly ms: number }
  | { readonly t: 'stop' }
  | { readonly t: 'speed'; readonly x: number }
  | { readonly t: 'cue'; readonly cue: RunCueName };

export type ClusterEvent =
  | { readonly t: 'press'; readonly control: Control }
  | { readonly t: 'bridge'; readonly state: RunState }
  | { readonly t: 'loaded'; readonly id: number; readonly ok: boolean; readonly reason?: Reason }
  | { readonly t: 'tick' }
  | { readonly t: 'visibility'; readonly state: Visibility }
  | { readonly t: 'edit'; readonly kind: EditKind; readonly origin: DocChange['origin'] }
  | { readonly t: 'diagnostic'; readonly kind: string };

export interface Step {
  readonly state: ClusterState;
  readonly effects: readonly Effect[];
}

const NONE: readonly Effect[] = [];
const START: Effect = { t: 'cue', cue: 'run-start' };
const STOP_CUE: Effect = { t: 'cue', cue: 'run-stop' };

/** The phase a bridge state shows when nothing of ours is in flight. */
export function phaseOf(state: RunState): Phase {
  switch (state) {
    case 'running':
      return 'running';
    case 'paused':
      return 'paused';
    case 'halted':
    case 'limit':
    case 'error':
      return 'faulted';
    default:
      return 'stopped';
  }
}

export function initialState(bridge: RunState = 'unloaded', now = 0): ClusterState {
  const phase = phaseOf(bridge);
  return {
    phase,
    since: now,
    then: 'run',
    loadId: 0,
    loaded: false,
    reloading: false,
    reason: phase === 'faulted' ? haltReason(bridge, null) : null,
    restart: false,
    speed: REAL_TIME,
    visibility: 'non-immersive',
    diagnostic: null,
  };
}

const away = (v: Visibility) => v === 'visible-blurred' || v === 'hidden';
const busy = (p: Phase) => p === 'compiling' || p === 'uploading';

/** Why a load was refused, from its diagnostics. */
export function loadReason(diagnostics: ReadonlyArray<{ id: string }>): Reason {
  return diagnostics.some((d) => d.id === 'no-firmware') ? 'no-code' : 'refused';
}

/** Why a run ended badly: the last diagnostic names it when it can, else the bridge state. */
export function haltReason(state: RunState, diagnostic: string | null): Reason {
  if (state === 'error') return 'refused';
  if (diagnostic === 'output-contention') return 'contention';
  if (diagnostic === 'no-time-progress') return 'stuck';
  return state === 'limit' ? 'limit' : 'halted';
}

/** Parts, wires, nets and parameters are the circuit; sources are code; placements and the rest are neither. */
export function editKind(change: Pick<DocChange, 'touched' | 'ops'>): EditKind {
  const t = change.touched;
  if (t.components.size || t.nets.size || t.wires.size) return 'circuit';
  let code = t.sources.size > 0;
  for (const op of change.ops) {
    const impact = classifyOp(op);
    if (impact === 'param' || impact === 'structural') return 'circuit';
    if (impact === 'source') code = true;
  }
  return code ? 'code' : 'none';
}

function startLoad(s: ClusterState, then: 'run' | 'step', now: number): Step {
  const id = s.loadId + 1;
  return {
    state: { ...s, phase: 'compiling', since: now, then, loadId: id, loaded: false, reloading: false, reason: null, restart: false, diagnostic: null },
    effects: [{ t: 'load', id }],
  };
}

function reset(s: ClusterState, now: number): Step {
  return {
    state: { ...s, phase: 'stopped', since: now, loaded: false, reloading: false, reason: null, restart: false },
    effects: s.phase === 'running' ? [STOP_CUE, { t: 'stop' }] : [{ t: 'stop' }],
  };
}

function press(s: ClusterState, control: Control, now: number): Step {
  switch (control) {
    case 'speed': {
      const speed = (s.speed + 1) % SPEEDS.length;
      return { state: { ...s, speed }, effects: [{ t: 'speed', x: SPEEDS[speed]! }] };
    }
    case 'reset':
      return reset(s, now);
    case 'run':
      switch (s.phase) {
        case 'stopped':
        case 'faulted':
          return startLoad(s, 'run', now);
        case 'running':
          return { state: { ...s, phase: 'paused', since: now, reason: null }, effects: [STOP_CUE, { t: 'pause' }] };
        case 'paused':
          return { state: { ...s, phase: 'running', since: now, reason: null }, effects: [START, { t: 'run' }] };
        default:
          // A press while compiling or uploading does nothing: the run is on its way.
          return { state: s, effects: NONE };
      }
    case 'step':
      switch (s.phase) {
        case 'stopped':
        case 'faulted':
          return startLoad(s, 'step', now);
        case 'running':
          return { state: { ...s, phase: 'paused', since: now, reason: null }, effects: [STOP_CUE, { t: 'pause' }, { t: 'step', ms: STEP_MS }] };
        case 'paused':
          return { state: s.reason ? { ...s, reason: null } : s, effects: [{ t: 'step', ms: STEP_MS }] };
        default:
          return { state: s, effects: NONE };
      }
  }
}

function bridge(s: ClusterState, b: RunState, now: number): Step {
  // While compiling or uploading the load in flight decides; during a live reload so does its `loaded`.
  if (busy(s.phase)) return { state: s, effects: NONE };
  if (s.reloading && (b === 'idle' || b === 'unloaded' || b === 'error')) return { state: s, effects: NONE };
  const was = s.phase;
  switch (b) {
    case 'running':
      if (was === 'running') break;
      return { state: { ...s, phase: 'running', since: now, reason: null }, effects: [START] };
    case 'paused':
      // Only a pause we did not ask for (main.ts on the system overlay, the model stopping on a short) moves us.
      if (was !== 'running') break;
      return { state: { ...s, phase: 'paused', since: now, reason: away(s.visibility) ? 'away' : null }, effects: [STOP_CUE] };
    case 'halted':
    case 'limit':
    case 'error': {
      const reason = haltReason(b, s.diagnostic);
      if (was === 'faulted' && s.reason === reason) break;
      return { state: { ...s, phase: 'faulted', since: now, reloading: false, reason }, effects: was === 'running' ? [STOP_CUE] : NONE };
    }
    default:
      if (was === 'stopped') break;
      return { state: { ...s, phase: 'stopped', since: now, reason: null }, effects: was === 'running' ? [STOP_CUE] : NONE };
  }
  return { state: s, effects: NONE };
}

function loaded(s: ClusterState, e: Extract<ClusterEvent, { t: 'loaded' }>, now: number): Step {
  if (e.id !== s.loadId) return { state: s, effects: NONE };
  if (s.phase === 'compiling') {
    if (!e.ok) return { state: { ...s, phase: 'faulted', since: now, loaded: false, reason: e.reason ?? 'refused' }, effects: NONE };
    const ready = { ...s, loaded: true };
    return now - s.since >= COMPILE_MS ? { state: { ...ready, phase: 'uploading', since: now }, effects: NONE } : { state: ready, effects: NONE };
  }
  if (!s.reloading) return { state: s, effects: NONE };
  if (!e.ok) {
    return {
      state: { ...s, phase: 'faulted', since: now, reloading: false, reason: e.reason ?? 'refused' },
      effects: s.phase === 'running' ? [STOP_CUE] : NONE,
    };
  }
  // The reloaded circuit starts its program again: running resumes at once, paused waits at t = 0 for Run.
  return { state: { ...s, reloading: false, restart: false }, effects: s.phase === 'running' ? [{ t: 'run' }] : NONE };
}

function tick(s: ClusterState, now: number): Step {
  if (s.phase === 'compiling' && s.loaded && now - s.since >= COMPILE_MS) return { state: { ...s, phase: 'uploading', since: now }, effects: NONE };
  if (s.phase !== 'uploading' || now - s.since < UPLOAD_MS) return { state: s, effects: NONE };
  // Loaded and uploaded while the system overlay was up: wait, paused, for the person.
  if (away(s.visibility)) return { state: { ...s, phase: 'paused', since: now, reason: 'away' }, effects: NONE };
  if (s.then === 'step') return { state: { ...s, phase: 'paused', since: now }, effects: [{ t: 'step', ms: STEP_MS }] };
  return { state: { ...s, phase: 'running', since: now }, effects: [START, { t: 'run' }] };
}

function edit(s: ClusterState, kind: EditKind, origin: DocChange['origin'], now: number): Step {
  const live = s.phase === 'running' || s.phase === 'paused';
  if (origin === 'load') {
    // Another document was opened: the run belongs to the old one.
    return live || busy(s.phase) ? reset(s, now) : { state: s, effects: NONE };
  }
  if (kind === 'code') return (live || busy(s.phase)) && !s.restart ? { state: { ...s, restart: true }, effects: NONE } : { state: s, effects: NONE };
  if (kind !== 'circuit') return { state: s, effects: NONE };
  const id = s.loadId + 1;
  if (live) return { state: { ...s, reloading: true, loadId: id, diagnostic: null }, effects: [{ t: 'load', id }] };
  if (busy(s.phase)) {
    // The load in flight has the old circuit: compile again (the ring keeps filling from where it was).
    return { state: { ...s, phase: 'compiling', since: s.phase === 'compiling' ? s.since : now, loaded: false, loadId: id }, effects: [{ t: 'load', id }] };
  }
  return { state: s, effects: NONE };
}

export function next(s: ClusterState, e: ClusterEvent, now: number): Step {
  switch (e.t) {
    case 'press':
      return press(s, e.control, now);
    case 'bridge':
      return bridge(s, e.state, now);
    case 'loaded':
      return loaded(s, e, now);
    case 'tick':
      return tick(s, now);
    case 'visibility': {
      if (e.state === s.visibility) return { state: s, effects: NONE };
      const seen = { ...s, visibility: e.state };
      if (away(e.state) && s.phase === 'running') {
        return { state: { ...seen, phase: 'paused', since: now, reason: 'away' }, effects: [STOP_CUE, { t: 'pause' }] };
      }
      return { state: seen, effects: NONE };
    }
    case 'edit':
      return edit(s, e.kind, e.origin, now);
    case 'diagnostic':
      return e.kind === s.diagnostic ? { state: s, effects: NONE } : { state: { ...s, diagnostic: e.kind }, effects: NONE };
  }
}

/** When the driver should send the next `tick` (ms), or null when nothing waits on the clock. */
export function dueAt(s: ClusterState): number | null {
  if (s.phase === 'compiling') return s.loaded ? s.since + COMPILE_MS : null;
  if (s.phase === 'uploading') return s.since + UPLOAD_MS;
  return null;
}

/** The Run plate's ring, 0..1, or null when it shows none. Compiling holds at 0.9 until the load answers. */
export function progressOf(s: ClusterState, now: number): number | null {
  if (s.phase === 'compiling') return Math.min(s.loaded ? 1 : 0.9, Math.max(0, (now - s.since) / COMPILE_MS));
  if (s.phase === 'uploading') return Math.min(1, Math.max(0, (now - s.since) / UPLOAD_MS));
  return null;
}

export type RunLabel = 'run' | 'pause' | 'compiling' | 'uploading';
export type BadgeKey = Reason | 'restart';
export type BadgeTone = 'warn' | 'bad' | 'info';

export interface ClusterView {
  readonly phase: Phase;
  readonly run: { readonly icon: 'run' | 'pause'; readonly label: RunLabel; readonly badge: BadgeKey | null; readonly tone: BadgeTone | null };
  /** Step waits while a load is on its way. */
  readonly stepDisabled: boolean;
  readonly speedLabel: string;
  /** The ring round each running board: crawling, still in ink, or gone. */
  readonly ring: 'crawl' | 'still' | 'none';
}

export function badgeOf(s: ClusterState): { badge: BadgeKey | null; tone: BadgeTone | null } {
  if (s.phase === 'faulted' && s.reason) return { badge: s.reason, tone: s.reason === 'limit' ? 'warn' : 'bad' };
  if (s.phase === 'paused' && s.reason === 'away') return { badge: 'away', tone: 'info' };
  if (s.restart) return { badge: 'restart', tone: 'warn' };
  return { badge: null, tone: null };
}

export function viewOf(s: ClusterState): ClusterView {
  const { badge, tone } = badgeOf(s);
  const label: RunLabel = s.phase === 'running' ? 'pause' : s.phase === 'compiling' ? 'compiling' : s.phase === 'uploading' ? 'uploading' : 'run';
  return {
    phase: s.phase,
    run: { icon: s.phase === 'running' ? 'pause' : 'run', label, badge, tone },
    stepDisabled: busy(s.phase),
    speedLabel: SPEED_LABELS[s.speed]!,
    ring: s.phase === 'running' ? 'crawl' : s.phase === 'paused' ? 'still' : 'none',
  };
}

/**
 * Simulated seconds for the clock: the last frame's time, run on at the current speed while running, but never more
 * than one heartbeat past it (the next frame is due by then), so it never shows a time the run has not reached by far.
 */
export function clockSeconds(frameNs: number, msSinceFrame: number, speed: number, running: boolean): number {
  const at = frameNs / 1e9;
  if (!running || !(msSinceFrame > 0)) return at;
  return at + Math.min((msSinceFrame / 1000) * speed, HEARTBEAT_S);
}

/** `t 12.34 s  x1/4`; the speed is always shown, `x1` included. */
export function clockText(seconds: number, speed: number): string {
  const cs = Math.floor(Math.max(0, seconds) * 100 + 1e-6);
  return `t ${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')} s  ${SPEED_LABELS[speed] ?? SPEED_LABELS[REAL_TIME]}`;
}
