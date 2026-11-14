import { deviceAssetBytes, type AssetBytes } from "@/local/asset-bytes";
import { builtinRegistry } from "@/parts/builtin";
import type { PartRegistry } from "@/parts/registry";
import type { RunWiring } from "@/collab/run-wiring";
import type { Op, Project } from "@/project/generated/types";
import type { OpImpact } from "@/project/opImpact";
import type { SimHost } from "@/sim-host/host";
import { buildSimNetlist } from "@/sim-host";
import { PROFILES, type BoardId } from "@/sim/boards/profiles";
import { boardIdForPart } from "@/parts/boards";
import { portMap } from "@/lib/interp/verilog/ports";
import { needsPhysics } from "@/sim-host/robot-doc";
import { inputDrives } from "@/sim-host/world-drive";
import type { SimEv } from "@/sim-host/protocol";
import type { PartInput, ProgramImage, SimDiagnostic, SimNetlist, SimRunOptions, StepUnit } from "@/sim/engine";
import type { RobotStore } from "@/studio/robot/store";
import type { DocStore } from "@/studio/stores/doc";
import type { Diagnostic, LimitInfo, RunStore } from "@/studio/stores/run";

export type SimHostLike = Pick<SimHost, "load" | "control" | "input" | "setInput" | "debug" | "onEvent" | "pause" | "resume" | "step" | "setSpeed">;

export interface SimLinkDeps {
  doc: DocStore;
  run: RunStore;
  host: SimHostLike;
  impact: (ops: Op[]) => OpImpact;
  reg?: Pick<PartRegistry, "get">;
  /** The breakpoint lines by source path, read each time a run starts. */
  breakpoints?: () => Readonly<Record<string, readonly number[]>>;
  /** Where the imported files of the project are read from; a run on the avr8js engine needs its hex. */
  assets?: Pick<AssetBytes, "get">;
  /** Where the physics frames, robot checks and run report of a robot project go. */
  robot?: RobotStore;
}

export interface SimLink {
  run(): Promise<void>;
  stop(): void;
  reset(): void;
  pause(): void;
  resume(): void;
  /** Runs `n` units of one kind from a paused run; the host refuses while running. */
  step(unit: StepUnit, n: number): void;
  /** Simulated seconds per wall second, or 0 for as fast as possible. */
  setSpeed(x: number): void;
  restart(): Promise<void>;
  sendSerial(text: string): void;
  press(c: string, pin: string, down: boolean): void;
  /** Works a control of a placed part (a button, a switch, a pot) while the run is going; the value is run data and never touches the document. */
  partInput(input: PartInput): void;
  /** Sets a world input of the run; the value is run data and never touches the document. */
  setInput(id: string, value: number): void;
  dispose(): void;
}

const LIMITS = { statements: 400_000, events: 100_000, outputBytes: 1024 * 1024 };
const WORKER_REPLACED = ["wall-stall", "cancel-unanswered"];
/** How long the circuit must stay as it is before a running one starts again on it, so a drag or a typed value restarts once. */
const RESTART_AFTER_MS = 400;
/** The edits that change the circuit a run was built from: its parts, their values and its nets. */
const CIRCUIT_OP = /^(net\.|board\.(add|remove)$|component\.(add|remove|swap|set)$|param\.)/;

let target: RunWiring | null = null;
const targetListeners = new Set<() => void>();

/** Points the run controls at a room's run, or back at the local host with `null`. */
export function setRunTarget(next: RunWiring | null) {
  if (target === next) return;
  target = next;
  for (const fn of [...targetListeners]) fn();
}

export const getRunTarget = (): RunWiring | null => target;

export function subscribeRunTarget(fn: () => void): () => void {
  targetListeners.add(fn);
  return () => void targetListeners.delete(fn);
}

/** The room's run when the controls belong to it: a private run is the member's own. */
function sharedRun(): RunWiring | null {
  return target && target.client.state.status !== "detached-own" ? target : null;
}

const failure = (id: string, text: string): Diagnostic => ({ id, severity: "error", text });

function limitOf(message: string): LimitInfo {
  const lower = message.toLowerCase();
  const which = lower.includes("statement") ? "statements" : lower.includes("operation") ? "operations" : lower.includes("memory") ? "memory" : "time";
  return { which, text: message };
}

function diagnosticOf(d: SimDiagnostic): Diagnostic {
  const found: Diagnostic = { id: d.id, severity: d.severity, text: String(d.args?.message ?? d.text_key) };
  if (d.ref.file !== undefined) found.file = d.ref.file;
  if (d.ref.line !== undefined) found.line = d.ref.line;
  return found;
}

/** The firmware of the first board that has one, with the entry resolved from its source id to a path. */
export function programOf(state: Project): ProgramImage | null {
  const board = state.boards.find((b) => b.firmware);
  const firmware = board?.firmware;
  if (!board || !firmware) return null;
  const files = firmware.sources.flatMap((id) => {
    const source = state.sources.find((s) => s.id === id);
    return source ? [{ path: source.path, text: source.content }] : [];
  });
  const entry = state.sources.find((s) => s.id === firmware.entry)?.path;
  if (entry === undefined || files.length === 0) return null;
  const ports = firmware.language === "verilog" ? portsOf(state, board.definition, firmware.ports) : undefined;
  return { kind: "source", language: firmware.language, files, entry, ...(ports ? { ports } : {}) };
}

/** The board pin of every Verilog port bit: what the project's mapping says, and the board's own pins for the ports it leaves out. */
function portsOf(state: Project, definition: { ref: string; version: string }, mapped?: Record<string, string[] | undefined>): Record<string, string[]> | undefined {
  const id = boardIdForPart(definition.ref) as BoardId | undefined;
  const profile = id && PROFILES[id];
  if (!profile || !profile.fpga) return undefined;
  const pins = state.dependencies.components.find((c) => c.ref === definition.ref && c.version === definition.version)?.interface.pins ?? [];
  return portMap(profile, pins.map((p) => p.id), mapped);
}

const FIRMWARE_ENGINE = "avr8js";
const PICO_ENGINE = "rp2040js";
const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** The hex of the first runtime when it runs on the avr8js engine, with its ELF when one was imported; null when the files are not there. */
async function hexProgramOf(state: Project, assets: Pick<AssetBytes, "get">): Promise<ProgramImage | null> {
  const options: { image?: string; elf?: string } | undefined = state.simulation.runtimes[0]?.options;
  const read = async (id: string | undefined): Promise<Uint8Array | null> => {
    const asset = state.assets.find((a) => a.id === id);
    return asset ? assets.get(asset.sha256) : null;
  };
  const hex = await read(options?.image);
  if (!hex) return null;
  const elf = options?.elf === undefined ? undefined : ((await read(options.elf)) ?? undefined);
  return { kind: "hex", hex: textOf(hex), ...(elf ? { elf } : {}) };
}

/** The UF2 file of the first runtime when it runs on the rp2040js engine; null when the file is not there. */
async function uf2ProgramOf(state: Project, assets: Pick<AssetBytes, "get">): Promise<ProgramImage | null> {
  const options: { image?: string } | undefined = state.simulation.runtimes[0]?.options;
  const asset = state.assets.find((a) => a.id === options?.image);
  const bytes = asset ? await assets.get(asset.sha256) : null;
  return bytes ? { kind: "uf2", bytes } : null;
}

/** Loads the project's circuit and firmware into `host`, not started, at the speed a mirrored run needs. */
export async function loadForRun(host: Pick<SimHost, "load">, state: Project, seed: number, reg: Pick<PartRegistry, "get"> = builtinRegistry()): Promise<void> {
  const { net, diagnostics } = buildSimNetlist(state, reg);
  const program = programOf(state);
  if (!program) throw new Error("The project has no code to run.");
  const blocked = diagnostics.find((d) => d.severity === "error");
  if (blocked) throw new Error(String(blocked.args?.message ?? blocked.text_key));
  const loaded = await host.load(net, { seed, speed: 0, limits: LIMITS, tier: "T1" }, program, needsPhysics(state) ? state : undefined);
  const failed = loaded.diagnostics.find((d) => d.severity === "error");
  if (failed) throw new Error(String(failed.args?.message ?? failed.text_key));
}

export function linkSim({ doc, run, host, impact, reg = builtinRegistry(), breakpoints = () => ({}), assets = deviceAssetBytes(), robot }: SimLinkDeps): SimLink {
  // A newer start, stop or reset makes the answers of an older start irrelevant.
  let generation = 0;
  // Where each world input was last put. It outlives a run, so a restart keeps a turned knob where it was.
  const inputValues = new Map<string, number>();
  let runNet: SimNetlist | null = null;

  function onSimEvent(ev: SimEv) {
    if (run.getState().phase === "idle") return;
    if (ev.t === "frame") {
      run.apply({ t: "frame", frame: { tNs: ev.at, pins: ev.pins, parts: ev.parts } });
      if (ev.analog) run.apply({ t: "analog", frame: ev.analog });
      for (const chunk of ev.serial) run.apply({ t: "serial", tNs: chunk.at, kind: "out", text: chunk.text });
      if (ev.serial.length > 0) robot?.apply({ t: "serial", entries: ev.serial.map((chunk) => ({ tNs: chunk.at, text: chunk.text })) });
      return;
    }
    if (ev.t === "mech_status") {
      robot?.apply({ t: "mech_status", state: ev.state, ...(ev.wireBytes === undefined ? {} : { wireBytes: ev.wireBytes }), ...(ev.reason === undefined ? {} : { reason: ev.reason }) });
      return;
    }
    if (ev.t === "mech_frame") {
      robot?.apply({ t: "mech_frame", frame: ev.frame });
      return;
    }
    if (ev.t === "robot_problems") {
      robot?.apply({ t: "robot_problems", problems: ev.problems, checks: ev.checks, coupling: ev.coupling });
      return;
    }
    if (ev.t === "mech_report") {
      robot?.apply({ t: "mech_report", report: ev.report });
      return;
    }
    if (ev.t === "speed.report") {
      run.apply({ t: "behind", behind: ev.behind, achieved: ev.achieved });
      return;
    }
    if (ev.t === "event") {
      if (ev.event.kind === "paused" || ev.event.kind === "findings") return;
      const severity = ev.event.kind === "no-time-progress" ? "error" : "warning";
      run.apply({ t: "diagnostics", append: true, diagnostics: [{ id: ev.event.kind, severity, text: ev.event.message }] });
      return;
    }
    if (ev.t !== "state") return;
    if (ev.state === "running") run.apply({ t: "phase", phase: "running" });
    else if (ev.state === "paused") run.apply({ t: "phase", phase: "paused", tNs: ev.at });
    else if (ev.state === "done") run.apply({ t: "phase", phase: "done" });
    else if (ev.state === "halted") run.apply({ t: "phase", phase: "error" });
    else if (ev.state === "limit") {
      const kind = ev.limit?.kind ?? "";
      if (WORKER_REPLACED.includes(kind)) run.apply({ t: "phase", phase: "killed" });
      else run.apply({ t: "phase", phase: "limit", limit: limitOf(ev.limit?.message ?? "") });
    }
    if (ev.state !== "running") run.apply({ t: "behind", behind: false });
  }

  const offHost = host.onEvent(onSimEvent);
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelRestart = () => {
    clearTimeout(restartTimer);
    restartTimer = undefined;
  };

  /** An instrument on a pin the run has no node for needs the run built again; any other instrument change leaves the run as it is. */
  const probesNewPin = (ops: readonly Op[]): boolean =>
    ops.some((op) => {
      const pin = op.k === "instrument.set" ? op.instrument.target?.pin : undefined;
      return pin !== undefined && (runNet?.parts.find((p) => p.id === pin.c)?.pins[pin.p] ?? null) === null;
    });

  const offDoc = doc.onChange(({ origin, ops }) => {
    if (origin === "load") return run.markStale();
    const instrumentsOnly = ops.every((op) => op.k.startsWith("instrument."));
    const rebuild = instrumentsOnly ? probesNewPin(ops) : ops.some((op) => CIRCUIT_OP.test(op.k));
    if (instrumentsOnly ? rebuild : impact(ops) !== "none") run.markStale();
    if (!rebuild || sharedRun()) return;
    cancelRestart();
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      if (run.getState().phase === "running") void start();
    }, RESTART_AFTER_MS);
  });

  /** A board that cannot be debugged refuses the op; its run just goes without breakpoints. */
  async function armBreakpoints(program: ProgramImage): Promise<void> {
    const marked = breakpoints();
    if (program.kind !== "source") return;
    for (const { path } of program.files) {
      const lines = marked[path];
      if (lines?.length) await host.debug({ op: "set-breakpoints", file: path, lines: [...lines] }).catch(() => undefined);
    }
  }

  /** Puts every world input of the document at its value, so a sketch never reads a floating pin. */
  async function driveInputs(net: SimNetlist, state: Project): Promise<void> {
    for (const input of state.simulation.world.inputs) {
      for (const drive of inputDrives(net, input, inputValues.get(input.id) ?? input.default)) await host.input(drive);
    }
  }

  async function start(): Promise<void> {
    const mine = ++generation;
    robot?.reset();
    run.apply({ t: "phase", phase: "starting" });
    const fail = (diagnostics: Diagnostic[]) => {
      run.apply({ t: "diagnostics", diagnostics });
      run.apply({ t: "phase", phase: "error" });
    };
    const state = doc.getState().state;
    const { net, diagnostics: netDiagnostics } = buildSimNetlist(state, reg);
    const blocked = netDiagnostics.filter((d) => d.severity === "error");
    if (blocked.length > 0) return fail(blocked.map(diagnosticOf));
    const engine = state.simulation.runtimes[0]?.engine;
    const compiled = engine === FIRMWARE_ENGINE || engine === PICO_ENGINE;
    const program = engine === PICO_ENGINE ? await uf2ProgramOf(state, assets) : compiled ? await hexProgramOf(state, assets) : programOf(state);
    if (mine !== generation) return;
    if (!program) return fail([compiled ? failure("no-firmware-image", `Import a ${engine === PICO_ENGINE ? ".uf2" : ".hex"} file to run in Firmware mode.`) : failure("no-firmware", "The project has no code to run.")]);
    const opts: SimRunOptions = { seed: state.simulation.seed, speed: run.getState().speed, limits: LIMITS, tier: "T1" };
    try {
      const loaded = await host.load(net, opts, program, needsPhysics(state) ? state : undefined);
      if (mine !== generation) return;
      const errors = loaded.diagnostics.filter((d) => d.severity === "error").map(diagnosticOf);
      if (errors.length > 0) return fail(errors);
      run.apply({ t: "diagnostics", diagnostics: [...netDiagnostics, ...loaded.diagnostics].map(diagnosticOf) });
      runNet = net;
      await driveInputs(net, state);
      await armBreakpoints(program);
      await host.control("run");
    } catch (err) {
      if (mine === generation) fail([failure("host-failed", err instanceof Error ? err.message : String(err))]);
    }
  }

  const quiet = (op: "stop" | "reset") => void host.control(op).catch(() => undefined);

  function driveWorldInput(id: string, value: number) {
    if (run.getState().phase !== "running" || !runNet) return;
    inputValues.set(id, value);
    const input = doc.getState().state.simulation.world.inputs.find((i) => i.id === id);
    if (!input) return;
    for (const drive of inputDrives(runNet, input, value)) void host.input(drive).catch(() => undefined);
  }

  return {
    async run() {
      cancelRestart();
      const shared = sharedRun();
      if (shared) return shared.start(run.getState().speed);
      const { phase, stale } = run.getState();
      if (phase === "starting" || (phase === "running" && !stale)) return;
      await start();
    },
    restart: async () => {
      cancelRestart();
      const shared = sharedRun();
      if (shared) return shared.start(run.getState().speed);
      return start();
    },
    stop() {
      cancelRestart();
      const shared = sharedRun();
      if (shared) return shared.client.request("stop");
      const { phase } = run.getState();
      if (phase !== "starting" && phase !== "running" && phase !== "paused") return;
      generation++;
      run.apply({ t: "phase", phase: "stopped" });
      quiet("stop");
    },
    reset() {
      cancelRestart();
      const shared = sharedRun();
      if (shared) return shared.client.request("reset");
      generation++;
      run.reset();
      quiet("reset");
    },
    pause() {
      const shared = sharedRun();
      if (shared) return shared.client.request("pause");
      if (run.getState().phase === "running") void host.pause().catch(() => undefined);
    },
    resume() {
      const shared = sharedRun();
      if (shared) return shared.client.request("resume");
      if (run.getState().phase === "paused") void host.resume().catch(() => undefined);
    },
    step(unit, n) {
      const shared = sharedRun();
      if (shared) return shared.client.request("step", { unit, n });
      if (run.getState().phase === "paused") void host.step(unit, n).catch(() => undefined);
    },
    setSpeed(x) {
      run.apply({ t: "speed", speed: x });
      const shared = sharedRun();
      if (shared) return shared.client.request("speed", { x });
      if (run.getState().phase !== "idle") void host.setSpeed(x).catch(() => undefined);
    },
    sendSerial(text) {
      if (run.getState().phase !== "running") return;
      run.apply({ t: "serial", tNs: run.getState().tNs, kind: "in", text });
      void host.input({ kind: "serial", target: "serial", value: text }).catch(() => undefined);
    },
    press(c, pin, down) {
      if (run.getState().phase !== "running") return;
      void host.input({ kind: "pin", target: `${c}/${pin}`, value: down }).catch(() => undefined);
    },
    partInput(input) {
      if (run.getState().phase !== "running") return;
      void host.setInput(input).catch(() => undefined);
      // A lesson ties a world input to the part, and that input is what the interpreter's pins follow today.
      const world = doc.getState().state.simulation.world.inputs.find((i) => i.component === input.part);
      if (world) driveWorldInput(world.id, input.param === "pos" ? world.min + input.value * (world.max - world.min) : input.value > 0 ? world.max : world.min);
    },
    setInput: driveWorldInput,
    dispose() {
      cancelRestart();
      generation++;
      offHost();
      offDoc();
    },
  };
}
