// @vitest-environment node
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "@/parts/builtin";
import type { Project } from "@/project/generated/types";
import { drawBuild, spreadsOf } from "@/sim/analog/part-tolerance";
import { histogram, summarize } from "@/sim/analog/spread";
import { buildSimNetlist } from "@/sim/netlist";
import { loadRegistry } from "@/sim/registry/entries";
import starter from "@/studio/starters/blinker-555.project.json";
import { type BatchHooks, buildSeed, prepare, runBatch, runBuild } from "./build";
import type { BatchRequest, BuildResult } from "./protocol";

const reg = builtinRegistry();
const registry = loadRegistry();
const doc = starter as unknown as Project;
const OUT = buildSimNetlist(doc, reg).net.parts.find((p) => p.id === "cmp_u1")!.pins.OUT!;

const request = (over: Partial<BatchRequest> = {}): BatchRequest => ({ doc, program: null, builds: 100, simSeconds: 2, measure: { quantity: "hz", target: OUT }, ...over });
const hooks = (over: Partial<BatchHooks> = {}): BatchHooks => ({ progress: () => undefined, breathe: () => Promise.resolve(), cancelled: () => false, ...over });

async function batch(req: BatchRequest): Promise<BuildResult[]> {
  const p = prepare(req, reg);
  if (!p.ok) throw new Error(p.reason);
  const outcome = await runBatch(p.prepared, reg, registry, hooks());
  if (outcome.t !== "done") throw new Error("cancelled");
  return outcome.results;
}

/** The frequency of the 555 astable from the drawn parts alone. */
const predicted = (r: BuildResult) => 1 / (Math.LN2 * (r.drawn.cmp_r1.ohms + 2 * r.drawn.cmp_r2.ohms) * r.drawn.cmp_c1.farads);

describe("the 555 blinker built 100 times", () => {
  it("gives the same hundred results for the same project seed, and others for another seed", async () => {
    const first = await batch(request({ builds: 12 }));
    expect(await batch(request({ builds: 12 }))).toEqual(first);
    const other = await batch(request({ builds: 12, doc: { ...doc, simulation: { ...doc.simulation, seed: doc.simulation.seed + 1 } } }));
    expect(other.map((r) => r.seed)).not.toEqual(first.map((r) => r.seed));
    expect(first.map((r) => r.seed)).toEqual(first.map((_, i) => buildSeed(doc.simulation.seed, i)));
  });

  it("reads, build by build, the frequency its drawn parts predict", async () => {
    const results = await batch(request({ simSeconds: 4 }));
    expect(results.every((r) => r.value !== null)).toBe(true);
    for (const r of results) {
      expect(r.value! / predicted(r)).toBeGreaterThan(0.97);
      expect(r.value! / predicted(r)).toBeLessThan(0.995);
    }
  });

  it("spreads over what the tolerances allow: inside the corners of 5 percent resistors and a 20 percent capacitor, and across most of it", async () => {
    const results = await batch(request({ simSeconds: 4 }));
    const nominal = 1 / (Math.LN2 * (1000 + 2 * 68000) * 1e-5);
    const model = 0.981;
    const slowest = (model * nominal * 1) / (1.05 * 1.2);
    const fastest = (model * nominal * 1) / (0.95 * 0.8);
    const s = summarize(results.map((r) => r.value))!;
    expect(s.min).toBeGreaterThan(slowest);
    expect(s.max).toBeLessThan(fastest);
    // the capacitor alone is uniform over 0.8 to 1.2 and the resistors add a little, so a hundred builds reach into both thirds of the range
    expect(s.min).toBeLessThan(model * nominal * 0.9 * 0.97);
    expect(s.max).toBeGreaterThan(model * nominal * 1.12);
    expect(Math.abs(s.median / (model * nominal) - 1)).toBeLessThan(0.07);
    expect(histogram(results.map((r) => r.value), 10).filter((b) => b.builds.length > 0).length).toBeGreaterThanOrEqual(7);
  });

  it("leaves a build with no reading when two cycles do not fit in the time, and reads the rest", async () => {
    const results = await batch(request());
    const slow = results.filter((r) => r.value === null);
    expect(slow.length).toBeGreaterThan(0);
    expect(slow.length).toBeLessThan(40);
    for (const r of slow) expect(predicted(r)).toBeLessThan(1.02);
  });

  it("burns no part on the starter", async () => {
    expect((await batch(request({ builds: 20 }))).filter((r) => r.burnt.length > 0)).toEqual([]);
  });

  it("says which part burnt in the builds that burnt one", async () => {
    const hot: Project = { ...doc, components: doc.components.map((c) => (c.id === "cmp_r3" ? { ...c, params: { ...c.params, ohms: 4 } } : c)) };
    const results = await batch(request({ doc: hot, builds: 10, simSeconds: 1 }));
    expect(results.every((r) => r.burnt.some((b) => b.part === "cmp_led1"))).toBe(true);
  });

  it("reads a volt and an amp as well as a frequency", async () => {
    const v = await batch(request({ builds: 6, measure: { quantity: "volts", target: OUT } }));
    expect(v.every((r) => r.value !== null && r.value >= 0 && r.value <= 5)).toBe(true);
    const a = await batch(request({ builds: 6, simSeconds: 1, measure: { quantity: "amps", target: "cmp_r1" } }));
    expect(a.every((r) => r.value !== null)).toBe(true);
  });

  it("stops between builds when cancelled and says how far it got", async () => {
    const p = prepare(request({ builds: 50 }), reg);
    if (!p.ok) throw new Error(p.reason);
    let done = 0;
    const outcome = await runBatch(p.prepared, reg, registry, hooks({ progress: (n) => void (done = n), cancelled: () => done >= 3 }));
    expect(outcome).toEqual({ t: "cancelled", done: 3 });
  });

  it("opens a build in the normal run: the project at that build's seed in the seeded mode draws the same parts", async () => {
    const results = await batch(request({ builds: 5, simSeconds: 1 }));
    const pick = results[3];
    const opened: Project = { ...doc, simulation: { ...doc.simulation, seed: pick.seed, solver: { ...doc.simulation.solver, options: { ...doc.simulation.solver.options, toleranceMode: "seeded" } } } };
    const net = buildSimNetlist(opened, reg).net;
    expect(net.parts.find((p) => p.id === "cmp_r2")!.params.ohms).toBe(pick.drawn.cmp_r2.ohms);
    expect(net.parts.find((p) => p.id === "cmp_c1")!.params.farads).toBe(pick.drawn.cmp_c1.farads);
    const nominal = buildSimNetlist(doc, reg).net;
    expect(drawBuild(nominal, spreadsOf(nominal, (r, v) => reg.get(r, v)), pick.seed).drawn).toEqual(pick.drawn);
  });

  it("is refused when nothing in the circuit varies, or the measure names nothing", () => {
    expect(prepare(request({ measure: { quantity: "hz", target: "nowhere" } }), reg)).toEqual({ ok: false, reason: "no-target" });
    const bare: Project = { ...doc, components: doc.components.filter((c) => c.id === "cmp_u1" || c.id.startsWith("cmp_eend")) };
    expect(prepare(request({ doc: bare }), reg).ok).toBe(false);
  });

  it("runs one build the same alone as in a batch", async () => {
    const p = prepare(request({ builds: 3, simSeconds: 1 }), reg);
    if (!p.ok) throw new Error(p.reason);
    const alone = runBuild(p.prepared, 2, buildSeed(doc.simulation.seed, 2), reg, registry);
    expect((await batch(request({ builds: 3, simSeconds: 1 })))[2]).toEqual(alone);
  });
});
