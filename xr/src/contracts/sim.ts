/**
 * The simulation bridge: the only way the render thread talks to the simulation. The simulation itself (iynk's
 * `createSimHandler`, imported unchanged) runs in a Web Worker owned by the XR app; the render thread never runs the
 * solver. Contract file: changes only in its own PR (label `contract-change`).
 *
 * Implementation: `xr/src/sim/bridge.ts` (`createSimBridge`). Fake for tests: pass `inlinePort` to run the same
 * handler in the calling thread.
 */
import type { Project } from '@/project/generated/types';
import type { Finding } from '@/sim/faults/types';
import type { HostInput, PartInput, PartState, SimDiagnostic } from '@/sim/engine';
import type { AnalogFrame, AnalogWatch } from '@/sim-host/analog-protocol';
import type { PinLevel, SimRunState } from '@/sim-host/protocol';
import type { MeterProbes } from '@/sim/probe/meter';
import type { Reading } from '@/sim/probe/tap';
import type { Unsubscribe } from './common';

export type { Finding, HostInput, PartInput, PartState, PinLevel, AnalogFrame, AnalogWatch, Reading, MeterProbes };

/** The worker's run states plus the two the bridge adds: `unloaded` (nothing loaded) and `error` (load refused). */
export type RunState = SimRunState | 'unloaded' | 'error';

/**
 * One frame of the run as the meshes need it. Frames are change driven (at most 30 per simulated second, plus a
 * heartbeat every 250 simulated ms), so a consumer keeps the last one rather than expecting one per render frame.
 */
export interface SimFrame {
  /** Simulated time in nanoseconds. */
  readonly atNs: number;
  /** Board pin name (the header label, for example `D13`) to level. */
  readonly pins: Readonly<Record<string, PinLevel>>;
  /** Part id (`cmp_led1`) to its readout. Parts the sim does not model are absent or `not-modelled`. */
  readonly parts: ReadonlyMap<string, PartState>;
  /** Serial output since the previous frame. */
  readonly serial: ReadonlyArray<{ atNs: number; text: string }>;
  /** Volts, amps, watts and part latches (`ok`/`hot`/`burnt`/`reversed`), only after `watchAnalog`. */
  readonly analog?: AnalogFrame;
}

export interface LoadResult {
  ok: boolean;
  /** Netlist and load diagnostics (unwired pins, unknown parts, a refused program). */
  diagnostics: readonly SimDiagnostic[];
}

/** A world input in the person's terms. The bridge turns it into the worker's `HostInput`. */
export type WorldInput =
  /** Press a button, flip a switch, turn a pot (0..1), set a sensor (`lux`, `distance` in m, `temp_c`, ...). */
  | { kind: 'part'; part: string; path: string; value: number | boolean }
  /** Drive a board pin directly (a jumper to 5V or GND); null releases it. */
  | { kind: 'pin'; pin: string; value: 0 | 1 | null }
  /** Put a voltage on an analog pin. */
  | { kind: 'analog'; pin: string; volts: number }
  /** Type into the serial monitor. */
  | { kind: 'serial'; text: string };

export interface SimBridge {
  readonly state: RunState;
  /** The last frame of the current run, or null before the first one. */
  readonly lastFrame: SimFrame | null;
  /** Findings posted at the last pause or run end (the fault rules and the solver's `solve:*` rules). */
  readonly findings: readonly Finding[];

  /** Builds the netlist from the document and loads its firmware. Replaces any earlier run. */
  load(doc: Project): Promise<LoadResult>;
  /** Starts or resumes, paced against the wall clock at the current speed. */
  run(): Promise<void>;
  pause(): Promise<void>;
  /** Advances a paused or loaded run by simulated milliseconds, synchronously in the worker. */
  step(ms: number): Promise<void>;
  /** Stops the run; the next `run` starts from the beginning of the loaded program. */
  stop(): Promise<void>;
  /** Simulated seconds per wall second: 1 is real time, 0.1 slow motion, 0.01 to 100. */
  setSpeed(x: number): Promise<void>;
  /** World inputs (gestures on parts). Ignored while unloaded. */
  input(i: WorldInput): Promise<void>;
  /** Chooses what frames carry in `analog`. The fault lab and the current-flow overlay call this. */
  watchAnalog(watch: AnalogWatch): Promise<void>;
  /** One multimeter reading now (`meter.read`). Rejects when the run has no circuit solver. */
  meter(id: string, settings: Record<string, unknown>, probes: MeterProbes): Promise<Reading>;

  onFrame(fn: (frame: SimFrame) => void): Unsubscribe;
  onState(fn: (state: RunState) => void): Unsubscribe;
  onFindings(fn: (findings: readonly Finding[]) => void): Unsubscribe;
  onDiagnostic(fn: (d: { kind: string; message: string; atNs: number }) => void): Unsubscribe;

  /** Ends the worker. Calls after this reject. */
  dispose(): Promise<void>;
}
