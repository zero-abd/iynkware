/**
 * Render-thread side of the simulation (contract: src/contracts/sim.ts). Posts requests to the sim worker and fans its
 * events out. Never runs the solver itself, except through `inlinePort` in tests.
 */
import { createInlinePort, createRpcPort, WorkerError, type RpcPort, type WorkerLike } from '@/protocol';
import { builtinRegistry } from '@/parts/builtin';
import type { Project } from '@/project/generated/types';
import { simDiag } from '@/sim/core/diagnostic';
import type { HostInput, ProgramImage, SimDiagnostic, SimNetlist, WorkLimits } from '@/sim/engine';
import { buildSimNetlist } from '@/sim/netlist';
import type { IgnoredReply, ProbeAddReply, SimEv, SimReq, StaticCheckReply } from '@/sim-host/protocol';
import type { Unsubscribe } from '../contracts/common';
import type { AnalogWatch, Finding, LoadResult, Reading, RunState, SimBridge, SimFrame, WorldInput } from '../contracts/sim';
import { createXrSimHandler, type XrHandlerOptions } from './handler-deps';

export type SimPort = RpcPort<SimReq, SimEv>;

/** Per-slice work budget, the same one iynk's studio uses (simLink.ts `LIMITS`). */
export const WORK_LIMITS: WorkLimits = { statements: 400_000, events: 100_000, outputBytes: 1024 * 1024 };

const MIN_SPEED = 0.01;
const MAX_SPEED = 100;
const NS_PER_MS = 1_000_000;
const TERMINAL: readonly RunState[] = ['done', 'halted', 'limit'];
/** The worker's default: no extra analog values, only part health. */
const NO_WATCH: AnalogWatch = { volts: [], amps: [], pinAmps: false, waves: [] };

/** The firmware of the first board that has one. Ported from iynk's simLink.ts `programOf` (that file pulls IndexedDB). */
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
  return { kind: 'source', language: firmware.language, files, entry };
}

/** The sim worker (sim.worker.ts). The default port of `createSimBridge`. */
export function workerPort(): SimPort {
  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module', name: 'iynkware-sim' });
  return createRpcPort<SimReq, SimEv>(worker as unknown as WorkerLike);
}

/** The same handler run in the calling thread, behind the same port. For tests and debugging. */
export function inlinePort(opts: Partial<XrHandlerOptions> = {}): SimPort {
  return createInlinePort<SimReq, SimEv>(
    createXrSimHandler({
      wallMs: opts.wallMs ?? (() => performance.now()),
      schedule: opts.schedule ?? ((fn) => void setTimeout(fn, 0)),
    }),
  );
}

/** A world input in the person's terms, as the worker's `HostInput`. */
export function hostInputOf(i: WorldInput): HostInput {
  switch (i.kind) {
    case 'part': {
      const value = typeof i.value === 'boolean' ? (i.value ? 1 : 0) : i.value;
      if (!Number.isFinite(value)) throw new RangeError(`input ${i.path} of ${i.part} needs a finite number, got ${value}`);
      return { kind: 'param', target: i.part, value: { path: i.path, value } };
    }
    case 'pin':
      return { kind: 'pin', target: i.pin, value: i.value };
    case 'analog':
      if (!Number.isFinite(i.volts)) throw new RangeError(`analog input on ${i.pin} needs finite volts, got ${i.volts}`);
      return { kind: 'analog', target: i.pin, value: i.volts };
    case 'serial':
      return { kind: 'serial', target: 'serial', value: i.text };
  }
}

function frameOf(ev: Extract<SimEv, { t: 'frame' }>): SimFrame {
  return {
    atNs: ev.at,
    pins: ev.pins,
    parts: new Map(ev.parts.map((p) => [p.part, p])),
    serial: ev.serial.map((s) => ({ atNs: s.at, text: s.text })),
    ...(ev.analog ? { analog: ev.analog } : {}),
  };
}

/** Built once: the registry is rebuilt from every descriptor on each `builtinRegistry()` call. */
let parts: ReturnType<typeof builtinRegistry> | null = null;

/** Every source of the document, path to text, as iynk's 2D Check sends them (faultLink.ts). */
const sourcesOf = (doc: Project): Record<string, string> => Object.fromEntries(doc.sources.map((s) => [s.path, s.content]));

const blocking = (diagnostics: readonly SimDiagnostic[]) => diagnostics.some((d) => d.severity === 'error');

function listeners<T>() {
  const fns = new Set<(value: T) => void>();
  return {
    add(fn: (value: T) => void): Unsubscribe {
      fns.add(fn);
      return () => void fns.delete(fn);
    },
    emit(value: T) {
      for (const fn of [...fns]) {
        try {
          fn(value);
        } catch (err) {
          console.error(err);
        }
      }
    },
    clear: () => fns.clear(),
  };
}

export interface SimBridgeOptions {
  /** Where the handler runs. Defaults to the sim worker; tests pass `inlinePort()`. */
  port?: SimPort;
}

export function createSimBridge(opts: SimBridgeOptions = {}): SimBridge {
  const port = opts.port ?? workerPort();
  /** Run id of the current load; events of any other run are dropped. 0 means nothing was ever loaded. */
  let run = 0;
  /** The run whose load has not been answered yet; its state events wait for the answer. */
  let loading = 0;
  let state: RunState = 'unloaded';
  let lastFrame: SimFrame | null = null;
  let findings: readonly Finding[] = [];
  let netlist: SimNetlist | null = null;
  let speed = 1;
  let watch: AnalogWatch | null = null;
  let disposed = false;

  const frames = listeners<SimFrame>();
  const states = listeners<RunState>();
  const findingsFns = listeners<readonly Finding[]>();
  const diagnostics = listeners<{ kind: string; message: string; atNs: number }>();

  const setState = (next: RunState) => {
    if (next === state) return;
    state = next;
    states.emit(next);
  };

  port.on((ev) => {
    if (disposed || run === 0 || ev.run !== run) return;
    if (ev.t === 'frame') {
      lastFrame = frameOf(ev);
      frames.emit(lastFrame);
    } else if (ev.t === 'state') {
      if (loading !== run) setState(ev.state);
    } else if (ev.t === 'event') {
      const e = ev.event;
      if (e.kind === 'findings') {
        findings = e.findings;
        findingsFns.emit(findings);
      } else if (e.kind !== 'paused') {
        diagnostics.emit({ kind: e.kind, message: e.message, atNs: e.at });
      }
    }
  });

  /** True when the worker holds a run of ours; pause, stop and input are no-ops otherwise. */
  const loaded = () => {
    if (disposed) throw new Error('the sim bridge was disposed');
    return state !== 'unloaded' && state !== 'error';
  };

  /** The current run id, or a rejection for calls that need a loaded run. */
  const live = () => {
    if (disposed) throw new Error('the sim bridge was disposed');
    if (state === 'unloaded') throw new Error('nothing is loaded');
    if (state === 'error') throw new Error('the loaded project did not load');
    return run;
  };

  const call = (msg: SimReq) => {
    if (disposed) return Promise.reject(new Error('the sim bridge was disposed'));
    return port.call(msg);
  };

  const control = async (op: 'run' | 'pause' | 'stop') => {
    await call({ t: 'control', run: live(), op });
  };

  /**
   * The worker throttles frames (30 per simulated second, none while nothing changes), so a short step or a pause can
   * end without one and `lastFrame` would lag. Sending the analog watch again makes it send a frame now.
   */
  const refresh = async (id: number) => {
    if (id === run && loaded()) await call({ t: 'analog.watch', run: id, watch: watch ?? NO_WATCH });
  };

  const refuse = (diags: SimDiagnostic[]): LoadResult => {
    setState('error');
    return { ok: false, diagnostics: diags };
  };

  const bridge: SimBridge = {
    get state() {
      return state;
    },
    get lastFrame() {
      return lastFrame;
    },
    get findings() {
      return findings;
    },
    get netlist() {
      return netlist;
    },

    async load(doc) {
      if (disposed) throw new Error('the sim bridge was disposed');
      // A new id drops the old run's late events. Cancel stops its pump without rebuilding it (a refused load below
      // never reaches the worker, and the worker's own load would stop the pump too).
      const old = run;
      const id = ++run;
      if (state === 'running') await call({ t: 'control', run: old, op: 'cancel' }).catch(() => undefined);
      lastFrame = null;
      findings = [];
      netlist = null;
      watch = null;
      const { net, diagnostics: netDiags } = buildSimNetlist(doc, (parts ??= builtinRegistry()));
      const program = programOf(doc);
      if (!program) return refuse([...netDiags, simDiag('no-firmware', 'error', {}, { message: 'the project has no code to run' })]);
      if (blocking(netDiags)) return refuse(netDiags);
      loading = id;
      try {
        const ack = await call({
          t: 'load',
          run: id,
          net,
          opts: { seed: doc.simulation.seed, speed, limits: WORK_LIMITS, tier: 'T1' },
          program,
        });
        const loadDiags = (ack.result as { diagnostics?: SimDiagnostic[] } | undefined)?.diagnostics ?? [];
        const all = [...netDiags, ...loadDiags];
        if (id !== run) return { ok: !blocking(all), diagnostics: all };
        if (blocking(loadDiags)) return refuse(all);
        netlist = net;
        setState('idle');
        return { ok: true, diagnostics: all };
      } catch (err) {
        if (id === run) setState('error');
        throw err;
      } finally {
        if (loading === id) loading = 0;
      }
    },

    async run() {
      // A finished run starts again from the beginning; the worker would ignore `run` there.
      if (TERMINAL.includes(state)) await control('stop');
      await control('run');
    },

    async pause() {
      if (!loaded() || state !== 'running') return;
      const id = run;
      await control('pause');
      await refresh(id);
    },

    async step(ms) {
      if (!(ms > 0)) throw new RangeError(`step needs ms above 0, got ${ms}`);
      const id = live();
      await call({ t: 'step', run: id, unit: 'ns', n: Math.max(1, Math.round(ms * NS_PER_MS)) });
      await refresh(id);
    },

    async stop() {
      if (!loaded()) return;
      const id = run;
      // Pausing first makes the worker post the findings of the run that is ending; stop alone posts none.
      if (state === 'running') await control('pause');
      // The worker rebuilds the run at t = 0 from the program it loaded, so the next `run` starts from the beginning.
      await control('stop');
      if (watch && id === run) await call({ t: 'analog.watch', run: id, watch });
    },

    async setSpeed(x) {
      if (!Number.isFinite(x)) throw new RangeError(`speed must be a finite number, got ${x}`);
      speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, x));
      if (loaded()) await call({ t: 'speed', run, x: speed });
    },

    async input(i) {
      if (loaded()) await call({ t: 'input', run, input: hostInputOf(i) });
    },

    async watchAnalog(w) {
      const id = live();
      watch = w;
      await call({ t: 'analog.watch', run: id, watch: w });
    },

    async meter(id, settings, probes) {
      const ack = await call({ t: 'meter.read', run: live(), meter: id, settings, probes });
      return ack.result as Reading;
    },

    async check(doc) {
      if (disposed) throw new Error('the sim bridge was disposed');
      // Netlist diagnostics do not stop a check: the rules report what they find in whatever the document wires.
      const { net } = buildSimNetlist(doc, (parts ??= builtinRegistry()));
      const ack = await call({ t: 'static-check', net, sources: sourcesOf(doc) });
      return { findings: (ack.result as StaticCheckReply).findings };
    },

    async addProbe(spec) {
      const ack = await call({ t: 'probe.add', run: live(), spec });
      const reply = (ack.result ?? {}) as ProbeAddReply | IgnoredReply;
      // Only while a load waits for the old run's pump to stop: the worker still holds the old run.
      if ('ignored' in reply) throw new Error('a new load replaced the run before the probe was added');
      return reply.error ? { id: spec.id, error: reply.error } : { id: spec.id };
    },

    async removeProbe(id) {
      if (!loaded()) return;
      try {
        await call({ t: 'probe.remove', run, probe: id });
      } catch (err) {
        // The worker refuses an id its run does not have; load, stop and a restart clear probes without telling us.
        if (!(err instanceof WorkerError && err.kind === 'bad_message')) throw err;
      }
    },

    onFrame: (fn) => frames.add(fn),
    onState: (fn) => states.add(fn),
    onFindings: (fn) => findingsFns.add(fn),
    onDiagnostic: (fn) => diagnostics.add(fn),

    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const l of [frames, states, findingsFns, diagnostics]) l.clear();
      await port.kill(0);
    },
  };
  return bridge;
}
