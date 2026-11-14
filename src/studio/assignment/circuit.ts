import { INTERP_LANGUAGE } from "@/lib/interp";
import { builtinRegistry } from "@/parts/builtin";
import type { Project } from "@/project/generated/types";
import { rangersOf } from "@/sim-host/mech";
import { bindAnalog } from "@/sim-host/engines/bind";
import { createInterpEngine } from "@/sim-host/engines/interp-engine";
import { inputDrives } from "@/sim-host/world-drive";
import { buildSimNetlist } from "@/sim-host";
import { NS_PER_MS } from "@/sim/core/clock";
import { boardIdOf, getProfile } from "@/sim/boards/profiles";
import { createRunAnalog } from "@/sim/analog/run";
import { createDigitalNets } from "@/sim/digital/nets";
import type { SimNetlist, SliceBudget } from "@/sim/engine";
import { createOrchestrator } from "@/sim/orchestrator";
import { loadRegistry } from "@/sim/registry/entries";
import { programOf } from "@/components/studio/wiring/simLink";

export type Read = { key: string; atMs: number; what: { kind: "volts"; part: string; pin: string } | { kind: "amps"; part: string } };

export type Window = { key: string; part: string; pin: string; fromMs: number; toMs: number };

export interface CircuitPlan {
  endMs: number;
  reads: readonly Read[];
  windows: readonly Window[];
  /** Wall clock the run may use, and the clock it reads. Both are passed in so a test does not depend on the machine. */
  budgetMs: number;
  now(): number;
}

export type Series = { tMs: number[]; volts: number[] };

export interface CircuitOutcome {
  /** `ok` ran to the end; the others say why there is nothing to read. */
  status: "ok" | "no-program" | "no-engine" | "refused" | "limit";
  /** A read the run could not make is null. */
  reads: Map<string, number | null>;
  series: Map<string, Series>;
  /** Parts the solver latched burnt, with the message key and numbers of what they failed on. */
  burnt: { part: string; why: { key: string; args: Record<string, string | number> } }[];
  /** The run ended on a limit or a runtime error. */
  halted: "limit" | "error" | null;
  net: SimNetlist | null;
}

const LIMITS = { statements: 400_000, events: 100_000, outputBytes: 1024 * 1024 };
const NEVER_YIELD: SliceBudget = { shouldYield: () => false, work: { statements: Infinity, events: Infinity, outputBytes: Infinity } };
/** A window is sampled at most this often, whatever its length. */
const SAMPLES_PER_WINDOW = 20_000;

let parts: ReturnType<typeof builtinRegistry> | null = null;
let fidelity: ReturnType<typeof loadRegistry> | null = null;

const empty = (status: CircuitOutcome["status"], net: SimNetlist | null = null): CircuitOutcome => ({ status, reads: new Map(), series: new Map(), burnt: [], halted: null, net });

type Stop = { atNs: number; read?: Read; window?: { key: string; part: string; pin: string } };

/** The net a pin of a part sits on, or null for a pin that is not wired. */
const netOf = (net: SimNetlist, part: string, pin: string): string | null => net.parts.find((p) => p.id === part)?.pins[pin] ?? null;

/** Runs the project's circuit and its first board's code as the Studio does, and reads what the plan asks for on the way. */
export function runCircuit(project: Project, plan: CircuitPlan): CircuitOutcome {
  parts ??= builtinRegistry();
  fidelity ??= loadRegistry();
  const { net, diagnostics } = buildSimNetlist(project, parts);
  if (diagnostics.some((d) => d.severity === "error")) return empty("refused", net);
  const program = programOf(project);
  if (!program) return empty("no-program", net);
  if (program.kind !== "source" || INTERP_LANGUAGE[program.language as keyof typeof INTERP_LANGUAGE] === undefined) return empty("no-engine", net);
  const board = net.parts.find((p) => p.kind === "board");
  if (!board) return empty("no-program", net);

  const boardId = boardIdOf(board.descriptor);
  const live = createRunAnalog(parts, fidelity);
  const engine = createInterpEngine({
    id: board.id,
    board: boardId,
    language: INTERP_LANGUAGE[program.language as keyof typeof INTERP_LANGUAGE],
    seed: project.simulation.seed,
    rangers: rangersOf(net),
  });
  const orch = createOrchestrator({ engines: [engine], digital: createDigitalNets(), analog: live });
  const endNs = plan.endMs * NS_PER_MS;
  const loaded = orch.load(net, { seed: project.simulation.seed, speed: 0, limits: LIMITS, tier: "T1", endNs });
  if (!loaded.ok || !engine.load(program).ok) return empty("refused", net);
  bindAnalog(engine, live, board.id, getProfile(boardId));
  for (const input of project.simulation.world.inputs) for (const drive of inputDrives(net, input, input.default)) orch.inject(drive);

  const stops: Stop[] = plan.reads.map((read) => ({ atNs: read.atMs * NS_PER_MS, read }));
  const series = new Map<string, Series>();
  for (const w of plan.windows) {
    const fromNs = w.fromMs * NS_PER_MS;
    const spanNs = (w.toMs - w.fromMs) * NS_PER_MS;
    const stepNs = Math.max(orch.analogStepNs ?? 0, Math.ceil(spanNs / SAMPLES_PER_WINDOW), 1);
    series.set(w.key, { tMs: [], volts: [] });
    for (let at = fromNs; at <= w.toMs * NS_PER_MS; at += stepNs) stops.push({ atNs: at, window: w });
  }
  stops.sort((a, b) => a.atNs - b.atNs);

  const reads = new Map<string, number | null>(plan.reads.map((r) => [r.key, null]));
  const started = plan.now();
  let status: CircuitOutcome["status"] = "ok";
  let halted: CircuitOutcome["halted"] = null;
  const run = (toNs: number): boolean => {
    const result = orch.runUntil(toNs, NEVER_YIELD);
    if (orch.diagnostics.some((d) => d.id === "limit-exceeded") || (engine.diagnostics ?? []).some((d) => d.id === "limit-exceeded")) halted = "limit";
    else if (result.reason === "halted" || (engine.diagnostics ?? []).some((d) => d.id === "runtime-error")) halted = "error";
    return halted !== "limit" && plan.now() - started <= plan.budgetMs;
  };

  for (const stop of stops) {
    if (!run(stop.atNs)) {
      status = "limit";
      break;
    }
    if (stop.read) {
      const { what } = stop.read;
      if (what.kind === "volts") {
        const id = netOf(net, what.part, what.pin);
        reads.set(stop.read.key, id === null ? null : live.netVolts(id));
      } else {
        const readout = live.readout();
        const pins = Object.values(readout.pinAmps.get(what.part) ?? {});
        const own = readout.amps.get(what.part);
        reads.set(stop.read.key, own !== undefined ? Math.abs(own) : pins.length > 0 ? Math.max(...pins.map(Math.abs)) : null);
      }
    } else if (stop.window) {
      const id = netOf(net, stop.window.part, stop.window.pin);
      const volts = id === null ? null : live.netVolts(id);
      if (volts !== null) {
        const s = series.get(stop.window.key)!;
        s.tMs.push(stop.atNs / NS_PER_MS);
        s.volts.push(volts);
      }
    }
  }
  if (status === "ok" && !run(endNs)) status = "limit";

  const burnt = [...live.readout().parts].flatMap(([part, p]) => (p.why ? [{ part, why: p.why }] : []));
  return { status, reads, series, burnt, halted, net };
}
