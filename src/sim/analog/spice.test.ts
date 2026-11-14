// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "../../parts/builtin.ts";
import type { Project } from "../../project/generated/types.ts";
import { StateHasher } from "../core/hash.ts";
import type { DigitalLayer, SimRunOptions, SliceBudget } from "../engine.ts";
import { createRunAnalog } from "./run.ts";
import { createOrchestrator } from "../orchestrator.ts";
import { buildSimNetlist } from "../netlist.ts";
import { exportSpice, SPICE_LOSS } from "./spice.ts";

const registry = builtinRegistry();
const STARTERS = join(import.meta.dirname, "..", "..", "studio", "starters");
const load = (id: string): Project => JSON.parse(readFileSync(join(STARTERS, `${id}.project.json`), "utf8")) as Project;

const BUDGET: SliceBudget = { shouldYield: () => false, work: { statements: Infinity, events: Infinity, outputBytes: Infinity } };
const OPTS: SimRunOptions = { seed: 1, speed: 1, limits: { statements: 1e6, events: 1e6, outputBytes: 1e6 }, tier: "T1" };
const DIGITAL: DigitalLayer = { load: () => [], onPin: () => undefined, partStates: () => [], stateHash: () => new StateHasher().hex() };

/** The solver's node voltages, as the app computes them, at each time in seconds. */
function solverTrace(project: Project, times: readonly number[]): Map<string, number[]> {
  const { net } = buildSimNetlist(project, registry);
  const live = createRunAnalog(registry);
  const orch = createOrchestrator({ engines: [], digital: DIGITAL, analog: live });
  orch.load(net, OPTS);
  const out = new Map(net.nets.map((n) => [n.id, [] as number[]]));
  for (const t of times) {
    orch.runUntil(Math.round(t * 1e9), BUDGET);
    for (const n of net.nets) out.get(n.id)!.push(live.netVolts(n.id) ?? NaN);
  }
  return out;
}

interface Engine {
  setNetList(text: string): void;
  runSim(): Promise<{ data: { name: string; values: number[] }[] }>;
}

/** ngspice, as eecircuit-engine runs it, on the deck; each node's trace read at `times`. */
async function ngspiceTrace(deck: string, nodes: ReadonlyMap<string, string>, times: readonly number[]): Promise<Map<string, number[]>> {
  const engine = (await import(pathToFileURL(join(import.meta.dirname, "..", "..", "..", "node_modules", "eecircuit-engine", "dist", "eecircuit-engine.mjs")).href)) as { Simulation: new () => Engine & { start(): Promise<void> } };
  const sim = new engine.Simulation();
  await sim.start();
  sim.setNetList(deck);
  const result = await sim.runSim();
  const by = new Map(result.data.map((d) => [d.name.toLowerCase(), d.values]));
  const time = by.get("time")!;
  const out = new Map<string, number[]>();
  for (const [netId, node] of nodes) {
    const values = node === "0" ? time.map(() => 0) : by.get(`v(${node})`);
    if (!values) continue;
    out.set(netId, times.map((t) => {
      let k = 0;
      while (k + 1 < time.length && time[k + 1]! < t) k++;
      const k1 = Math.min(k + 1, time.length - 1);
      const span = time[k1]! - time[k]!;
      const w = span > 0 ? Math.min(1, Math.max(0, (t - time[k]!) / span)) : 0;
      return values[k]! + w * (values[k1]! - values[k]!);
    }));
  }
  return out;
}

const REL = 0.02;
// A node near zero volts is held to 20 mV, so a few millivolts of offset there is not a failure; the worst difference measured is 3 mV.
const FLOOR_VOLTS = 0.02;

interface Case {
  id: string;
  stop: number;
  step: number;
  times: number[];
}

const CASES: Case[] = [
  { id: "rc-led", stop: 3, step: 1e-3, times: [0.1, 0.47, 1, 2, 3] },
  { id: "opamp-amplifier", stop: 0.05, step: 1e-5, times: [0.01, 0.03, 0.05] },
  { id: "zener-regulator", stop: 2, step: 1e-3, times: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] },
  { id: "rectifier", stop: 0.5, step: 2e-5, times: [0.101, 0.1135, 0.2, 0.3055, 0.4, 0.4205] },
  { id: "blinker-555", stop: 2, step: 1e-4, times: [0.05, 0.2, 0.4, 0.6, 0.8, 1.2, 1.5] },
];

describe("the SPICE export of each analog starter, run in ngspice, against the live solver", () => {
  it.each(CASES)("$id: every node within 2 percent at every sample", async ({ id, stop, step, times }) => {
    const project = load(id);
    const spice = exportSpice(project, registry, { exportedAt: "2026-11-10T10:00:00.000Z", appVersion: "test", stopSeconds: stop, stepSeconds: step });
    expect(spice.loss.filter((l) => l.severity !== "info")).toEqual([]);
    const solver = solverTrace(project, times);
    const spiced = await ngspiceTrace(spice.text, spice.nodes, times);
    const worst: string[] = [];
    let compared = 0;
    for (const [netId, expected] of solver) {
      const got = spiced.get(netId);
      if (!got) continue;
      expected.forEach((v, k) => {
        compared++;
        const tolerance = Math.max(REL * Math.abs(v), FLOOR_VOLTS);
        if (!(Math.abs(got[k]! - v) <= tolerance)) worst.push(`${netId} at ${times[k]} s: solver ${v.toFixed(3)} V, ngspice ${got[k]!.toFixed(3)} V`);
      });
    }
    expect(compared).toBeGreaterThan(times.length);
    expect(worst).toEqual([]);
  }, 60_000);
});

describe("the deck", () => {
  const spice = exportSpice(load("blinker-555"), registry, { exportedAt: "2026-11-10T10:00:00.000Z", appVersion: "test" });

  it("names each part by its reference designator and writes the subcircuit once", () => {
    expect(spice.text).toMatch(/^R1 /m);
    expect(spice.text).toMatch(/^D_LED1 /m);
    expect(spice.text.match(/^\.subckt IYNK_555/gm)).toHaveLength(1);
    expect(spice.text).toMatch(/^\.tran \S+ \S+ 0 \S+ uic$/m);
    expect(spice.text.endsWith(".end\n")).toBe(true);
  });

  it("says the board pins are left open when the circuit is wired to them", () => {
    const blink = exportSpice(load("blink"), registry, { exportedAt: "2026-11-10T10:00:00.000Z", appVersion: "test" });
    expect(blink.loss.map((l) => l.code)).toContain(SPICE_LOSS.floating);
  });

  it("says when a project has nothing analog to export", () => {
    const bare = { ...load("blink"), components: [], nets: [] } as Project;
    expect(exportSpice(bare, registry, { exportedAt: "2026-11-10T10:00:00.000Z", appVersion: "test" }).loss.map((l) => l.code)).toContain(SPICE_LOSS.nothing);
  });
});
