/**
 * Runs one flight in the room: iynk's deterministic flight session, ticked once per render frame, with the room's
 * rules on top (XR_DESIGN 8.3): A arms only with the sticks centred, an impact freezes the craft for 300 ms where it
 * hit, then the crash card and its replay; the field edge is the room's net and counts as a crash called `net`.
 */
import {
  createSession,
  MAX_FRAME,
  type BlockReason,
  type CalcOutputs,
  type Course,
  type CraftFaults,
  type FlightCraft,
  type FlightEvent,
  type FlightSession,
  type Sticks,
} from '@/lib/flight';
import { crashWindow, netWindow, type ReplayWindow } from './replay';
import { centreSticks, climbModeFor, sticksCentred } from './sticks';

/** The impact freeze, seconds: the sim is not ticked and the craft stays where it hit. */
export const FREEZE_S = 0.3;

/**
 * `disarmed` and `armed` follow the flight model; `frozen` is the impact freeze; `crashed` lasts until a reset or the
 * replay; `replay` while the crash replay is open.
 */
export type RunnerPhase = 'disarmed' | 'armed' | 'frozen' | 'crashed' | 'replay';

/** Why arming was refused: the flight model's `BlockReason` (flight namespace `msg.blocked.*`), or `sticks` (the room's: not centred). */
export type RoomBlockReason = BlockReason | 'sticks';

/** What the runner reports: the flight model's events (`blocked` may carry `sticks`), the net, and phase changes. */
export type RunnerEvent =
  | Exclude<FlightEvent, { type: 'blocked' }>
  | { t: number; type: 'blocked'; why: RoomBlockReason }
  | { t: number; type: 'net' }
  | { t: number; type: 'phase'; phase: RunnerPhase };

/** The craft this render frame, course metres and degrees (map it with `CourseMap`). One reused object. */
export interface RunnerFrame {
  x: number;
  y: number;
  z: number;
  /** Degrees: yaw from +x counter-clockwise, pitch nose down positive, roll left bank positive. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Prop phase, radians, and motor output 0..1. */
  spin: number;
  thr: number;
  /** Ground speed, course m/s. */
  speed: number;
  armed: boolean;
  crashed: boolean;
  airborne: boolean;
  perCell: number;
  low: boolean;
  /** Index of the next gate and checkpoint. */
  gate: number;
  checkpoint: number;
  /** Seconds since arming, and the flight step. */
  t: number;
  step: number;
}

export interface RunnerOptions {
  /** Asked-for mode; the room flies its climb alternative (`climbModeFor`). Default the craft's first mode. */
  readonly mode?: string;
  readonly faults?: CraftFaults;
  /** Wind is off indoors unless asked for. */
  readonly windOn?: boolean;
  /** A pace (ghost) exists for this course: `fixFor` may suggest flying slower. */
  readonly hasPace?: boolean;
}

export interface FlightRunner {
  readonly session: FlightSession;
  readonly phase: RunnerPhase;
  /** The craft now; rewritten by `tick`. */
  readonly frame: Readonly<RunnerFrame>;
  /** The impact's replay window and card data, from the impact until a reset. */
  readonly crash: ReplayWindow | null;
  /** The mode being flown. */
  readonly mode: string;
  /** Sets the sticks for the next ticks (copied). */
  setSticks(s: Readonly<Sticks>): void;
  /** Called once per render frame with the frame time in seconds (clamped to the flight model's `MAX_FRAME`). */
  tick(dt: number): void;
  arm(): void;
  disarm(): void;
  /** The A button. */
  toggleArm(): void;
  /** The B button: back to the pad. */
  reset(): void;
  setMode(id: string): void;
  setDesign(calc: CalcOutputs, faults?: CraftFaults): void;
  /** Opens and closes the crash replay (from `crashed`). */
  openReplay(): boolean;
  closeReplay(): void;
  onEvent(fn: (e: RunnerEvent) => void): () => void;
}

export function createRunner(craft: FlightCraft, course: Course, calc: CalcOutputs, opts: RunnerOptions = {}): FlightRunner {
  let mode = climbModeFor(craft, opts.mode ?? craft.modes[0]?.id ?? '');
  const session = createSession(craft, course, calc, { mode, faults: opts.faults, windOn: opts.windOn ?? false });
  const sim = session.sim;
  const listeners = new Set<(e: RunnerEvent) => void>();
  const want = centreSticks({ throttle: 0, yaw: 0, pitch: 0, roll: 0 });
  const sent = { throttle: NaN, yaw: NaN, pitch: NaN, roll: NaN };
  const frame: RunnerFrame = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, spin: 0, thr: 0, speed: 0, armed: false, crashed: false, airborne: false, perCell: 0, low: false, gate: 0, checkpoint: 0, t: 0, step: 0 };
  let phase: RunnerPhase = 'disarmed';
  let freeze = 0;
  let crash: ReplayWindow | null = null;

  const emit = (e: RunnerEvent) => listeners.forEach((l) => l(e));
  const setPhase = (p: RunnerPhase) => {
    if (p === phase) return;
    phase = p;
    emit({ t: sim.t, type: 'phase', phase: p });
  };
  const readFrame = () => {
    frame.x = sim.p[0];
    frame.y = sim.p[1];
    frame.z = sim.p[2];
    frame.yaw = sim.yaw + (sim.crashed ? sim.tumble * 40 : 0);
    frame.pitch = sim.pitch;
    frame.roll = sim.roll;
    frame.spin = sim.spin % (Math.PI * 2);
    frame.thr = sim.u;
    frame.speed = Math.hypot(sim.v[0], sim.v[1], sim.v[2]);
    frame.armed = sim.armed;
    frame.crashed = sim.crashed;
    frame.airborne = sim.airborne;
    frame.perCell = sim.battery.volt / sim.calc.cells;
    frame.low = sim.battery.low;
    frame.gate = sim.gate;
    frame.checkpoint = sim.checkpoint;
    frame.t = sim.t;
    frame.step = sim.step;
  };
  const follow = () => {
    if (phase === 'disarmed' || phase === 'armed') setPhase(sim.armed && !sim.crashed ? 'armed' : 'disarmed');
  };
  // the session logs each sticks action, so send one only when the sticks changed
  const sendSticks = () => {
    if (want.throttle === sent.throttle && want.yaw === sent.yaw && want.pitch === sent.pitch && want.roll === sent.roll) return;
    Object.assign(sent, want);
    session.dispatch({ type: 'sticks', sticks: { ...want } });
  };
  const impact = (kind: 'crash' | 'net') => {
    freeze = FREEZE_S;
    setPhase('frozen');
    crash = kind === 'crash' ? crashWindow(session.origin, session.log(), sim.step, opts.hasPace) : netWindow(session.origin, session.log(), sim.step);
  };
  const dispatch = (a: Parameters<FlightSession['dispatch']>[0]) => {
    session.dispatch(a);
    for (const e of drain()) emit(e);
    follow();
    readFrame();
  };
  // dispatch emits through the sim's queue, which the next tick drains; arm and reset report at once
  const drain = (): FlightEvent[] => session.tick(0);

  function arm() {
    if (sim.armed || phase === 'frozen' || phase === 'replay') return;
    if (phase === 'crashed') return emit({ t: sim.t, type: 'blocked', why: 'crashed' });
    if (!sticksCentred(want)) return emit({ t: sim.t, type: 'blocked', why: 'sticks' });
    sendSticks();
    dispatch({ type: 'arm' });
  }
  function disarm() {
    if (sim.armed && phase === 'armed') dispatch({ type: 'disarm' });
  }

  readFrame();
  return {
    session,
    get phase() {
      return phase;
    },
    frame,
    get crash() {
      return crash;
    },
    get mode() {
      return mode;
    },
    setSticks(s) {
      want.throttle = s.throttle;
      want.yaw = s.yaw;
      want.pitch = s.pitch;
      want.roll = s.roll;
    },
    tick(dt) {
      const step = Math.min(MAX_FRAME, Math.max(0, dt));
      if (phase === 'frozen') {
        freeze -= step;
        if (freeze <= 0) setPhase('crashed');
        return;
      }
      if (phase === 'crashed' || phase === 'replay') return;
      sendSticks();
      const events = session.tick(step);
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        emit(e);
        if ((phase as RunnerPhase) === 'frozen') continue;
        if (e.type === 'crash') impact('crash');
        else if (e.type === 'outOfField') {
          emit({ t: e.t, type: 'net' });
          impact('net');
        }
      }
      follow();
      readFrame();
    },
    arm,
    disarm,
    toggleArm() {
      if (sim.armed && phase === 'armed') disarm();
      else arm();
    },
    reset() {
      crash = null;
      freeze = 0;
      session.dispatch({ type: 'reset' });
      sent.throttle = NaN;
      for (const e of drain()) emit(e);
      setPhase(sim.armed ? 'armed' : 'disarmed');
      readFrame();
    },
    setMode(id) {
      const next = climbModeFor(craft, id);
      if (next === mode) return;
      mode = next;
      dispatch({ type: 'mode', mode: next });
    },
    setDesign(c, faults) {
      dispatch({ type: 'design', calc: c, faults });
    },
    openReplay() {
      if (phase !== 'crashed' || !crash) return false;
      setPhase('replay');
      return true;
    },
    closeReplay() {
      if (phase === 'replay') setPhase('crashed');
    },
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
