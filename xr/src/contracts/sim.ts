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
import type { HostInput, PartInput, PartState, SimDiagnostic, SimNetlist } from '@/sim/engine';
import type { AnalogFrame, AnalogWatch, WaveSamples } from '@/sim-host/analog-protocol';
import type { PinLevel, SimRunState } from '@/sim-host/protocol';
import type { MeterProbes } from '@/sim/probe/meter';
import type { ProbeSpec, Reading } from '@/sim/probe/tap';
import type { Unsubscribe } from './common';

export type {
  Finding,
  HostInput,
  PartInput,
  PartState,
  PinLevel,
  AnalogFrame,
  AnalogWatch,
  WaveSamples,
  Reading,
  MeterProbes,
  ProbeSpec,
  SimNetlist,
};

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
  /**
   * The netlist the current run was built from, or null before a successful load. Its net ids (`nets[].id`, and each
   * part's `pins`, pin name to net id) are what `addProbe` and `meter` take. Set when a load resolves ok, before
   * `onState` reports `idle`; null while a load is in flight and after a refused one, so a later load replaces it.
   */
  readonly netlist: SimNetlist | null;

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
  /**
   * The worker's static fault rules over a document, with no run (`static-check`): the netlist is built from `doc` as
   * `load` builds it, and the code rules read every source of `doc`. The current run is not touched, and nothing needs
   * to be loaded. Resolves with what the rules found even for a document `load` would refuse (netlist diagnostics, no
   * firmware); rejects only after `dispose`.
   */
  check(doc: Project): Promise<{ findings: readonly Finding[] }>;
  /**
   * A probe on the run (`probe.add`): `voltage` takes a net id of `netlist`, `current` and `power` take
   * `<net id>|<element id>`. Rejects while nothing is loaded or after a refused load, like `meter`. The run answers
   * `unknown-target` for an id it already has or an empty target, and `too-many-probes` past 64.
   *
   * Its waveform arrives in frames once its id is in `watchAnalog({ ..., waves: [id] })` (at most 8 ids), as
   * `frame.analog.waves[id]`: samples on a uniform grid since the previous frame, or, on a frame with `analog.full`,
   * from the oldest sample the probe keeps (`capacity`). The watch may name the id before or after the probe is added.
   * `pause` and `step` send the watch again so that they end with a frame, which is therefore a `full` one.
   *
   * Probes belong to the run the worker holds, and three calls rebuild that run and clear them: `load` (which also
   * clears the watch), `stop` (the bridge sends the watch again, so adding the same ids again is enough), and `run` on
   * a run that ended (`done`, `halted`, `limit`), which starts it again from the beginning (the worker then carries no
   * watch until the next `pause` or `step`, or a new `watchAnalog`). Add the probes again after any of these. A run
   * reaching its end, `pause`, `step`, `setSpeed`, `input`, `watchAnalog` and `check` keep them.
   */
  addProbe(spec: ProbeSpec): Promise<{ id: string; error?: 'unknown-target' | 'too-many-probes' }>;
  /**
   * Takes a probe off the run (`probe.remove`); its id then carries no waves. Resolves without doing anything while
   * nothing is loaded and for an id the run does not have (never added, already removed, or cleared as `addProbe` says).
   */
  removeProbe(id: string): Promise<void>;

  onFrame(fn: (frame: SimFrame) => void): Unsubscribe;
  onState(fn: (state: RunState) => void): Unsubscribe;
  onFindings(fn: (findings: readonly Finding[]) => void): Unsubscribe;
  onDiagnostic(fn: (d: { kind: string; message: string; atNs: number }) => void): Unsubscribe;

  /** Ends the worker. Calls after this reject. */
  dispose(): Promise<void>;
}
