import { INTERP_LANGUAGE } from "@/lib/interp";
import type { PartRegistry } from "@/parts/registry";
import type { Project } from "@/project/generated/types";
import { boardIdOf } from "@/sim/boards/profiles";
import { type PartSpread, drawBuild, spreadsOf } from "@/sim/analog/part-tolerance";
import { createRunAnalog } from "@/sim/analog/run";
import { frequencyHz } from "@/sim/analog/spread";
import { inhouseBackend } from "@/sim/analog/backend";
import type { LiveAnalog } from "@/sim/analog/live";
import { toleranceStreams } from "@/sim/analog/tolerance";
import { createDigitalNets } from "@/sim/digital/nets";
import type { SimNetlist, SimRunOptions, SliceBudget } from "@/sim/engine";
import { buildSimNetlist } from "@/sim/netlist";
import { createOrchestrator } from "@/sim/orchestrator";
import type { Registry } from "@/sim/registry/types";
import { getProfile } from "@/sim/boards/profiles";
import { bindAnalog } from "../engines/bind";
import { createInterpEngine } from "../engines/interp-engine";
import type { BatchRefusal, BatchRequest, BuildResult, Measure } from "./protocol";

const NS_PER_SECOND = 1e9;
const NEVER_YIELD: SliceBudget = { shouldYield: () => false, work: { statements: Infinity, events: Infinity, outputBytes: Infinity } };
const LIMITS: SimRunOptions["limits"] = { statements: 4_000_000, events: 1_000_000, outputBytes: 65_536 };
const MAX_SEED = 2 ** 31 - 1;

/** The seed of build `index` under the project's seed. */
export function buildSeed(projectSeed: number, index: number): number {
  return 1 + Math.floor(toleranceStreams(projectSeed)(`build:${index}`)() * (MAX_SEED - 1));
}

export interface Prepared {
  req: BatchRequest;
  net: SimNetlist;
  spreads: PartSpread[];
}

export type Preparation = { ok: true; prepared: Prepared } | { ok: false; reason: BatchRefusal; detail?: string };

/** The document with its tolerance mode put back to nominal, so the netlist the builds start from has no draw in it already. */
function nominal(doc: Project): Project {
  const { solver } = doc.simulation;
  return { ...doc, simulation: { ...doc.simulation, solver: { ...solver, options: { ...solver.options, toleranceMode: "nominal" } } } };
}

/** Checks that the circuit can be built many ways and that the measure names something in it. */
export function prepare(req: BatchRequest, reg: Pick<PartRegistry, "get">): Preparation {
  const { net, diagnostics } = buildSimNetlist(nominal(req.doc), reg);
  const blocked = diagnostics.find((d) => d.severity === "error");
  if (blocked) return { ok: false, reason: "bad-doc", detail: String(blocked.args?.message ?? blocked.text_key) };
  if (net.ground === "") return { ok: false, reason: "no-circuit" };
  if (req.program?.kind === "hex") return { ok: false, reason: "firmware-image" };
  const { quantity, target } = req.measure;
  const known = quantity === "amps" ? net.parts.some((p) => p.id === target) : net.nets.some((n) => n.id === target);
  if (!known) return { ok: false, reason: "no-target" };
  const spreads = spreadsOf(net, (ref, version) => reg.get(ref, version), req.resistorPct === undefined ? {} : { resistorPct: req.resistorPct });
  return spreads.length === 0 ? { ok: false, reason: "no-spread" } : { ok: true, prepared: { req, net, spreads } };
}

function measured(live: LiveAnalog, measure: Measure, trace: { at: number[]; volts: number[] }): number | null {
  if (measure.quantity === "hz") return frequencyHz(trace.at, trace.volts);
  if (measure.quantity === "volts") return live.readout().volts.get(measure.target) ?? null;
  return live.readout().amps.get(measure.target) ?? null;
}

/** One build of the circuit with every spread value drawn from `seed`, run for the simulated time and read. */
export function runBuild(p: Prepared, index: number, seed: number, parts: Pick<PartRegistry, "get">, registry: Registry): BuildResult {
  const { net, drawn } = drawBuild(p.net, p.spreads, seed);
  const live = createRunAnalog(parts, registry);
  const base = inhouseBackend(live);
  const trace = { at: [] as number[], volts: [] as number[] };
  const watch = p.req.measure.quantity === "hz";
  const backend = watch
    ? {
        ...base,
        advanceTo(t: number, changes: Parameters<typeof base.advanceTo>[1]) {
          const step = base.advanceTo(t, changes);
          const v = live.netVolts(p.req.measure.target);
          if (v !== null) trace.at.push(t / NS_PER_SECOND), trace.volts.push(v);
          return step;
        },
      }
    : base;
  const board = net.parts.find((part) => part.kind === "board");
  const program = p.req.program?.kind === "source" ? p.req.program : null;
  const engines = program && board ? [createInterpEngine({ id: board.id, board: boardIdOf(board.descriptor), language: INTERP_LANGUAGE[program.language as keyof typeof INTERP_LANGUAGE] ?? "arduino", seed })] : [];
  const orch = createOrchestrator({ engines, digital: createDigitalNets(), analog: live, backend });
  const endNs = Math.round(p.req.simSeconds * NS_PER_SECOND);
  const loaded = orch.load(net, { seed, speed: 0, limits: LIMITS, tier: "T1", endNs });
  let ok = loaded.ok;
  if (ok && program && board) {
    ok = engines[0].load(program).ok;
    if (ok) bindAnalog(engines[0], live, board.id, getProfile(boardIdOf(board.descriptor)));
  }
  const reached = ok && orch.runUntil(endNs, NEVER_YIELD).now >= endNs;
  const burnt = [...live.readout().parts].flatMap(([part, r]) => (r.state === "burnt" ? [{ part, key: r.why?.key ?? "", args: r.why?.args ?? {} }] : []));
  return { index, seed, value: reached ? measured(live, p.req.measure, trace) : null, burnt, drawn };
}

export interface BatchHooks {
  progress(done: number, of: number): void;
  /** Lets the host handle a message between builds; the worker waits a turn of its event loop here. */
  breathe(): Promise<void>;
  cancelled(): boolean;
}

export type BatchOutcome = { t: "done"; results: BuildResult[] } | { t: "cancelled"; done: number };

/** The builds one after another, each from its own seed under the project's, so the same project always gives the same hundred. */
export async function runBatch(p: Prepared, parts: Pick<PartRegistry, "get">, registry: Registry, hooks: BatchHooks): Promise<BatchOutcome> {
  const results: BuildResult[] = [];
  const base = p.req.doc.simulation.seed;
  for (let i = 0; i < p.req.builds; i++) {
    if (hooks.cancelled()) return { t: "cancelled", done: i };
    results.push(runBuild(p, i, buildSeed(base, i), parts, registry));
    hooks.progress(i + 1, p.req.builds);
    await hooks.breathe();
  }
  return { t: "done", results };
}
