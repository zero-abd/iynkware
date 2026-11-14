// @vitest-environment node
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "../../parts/builtin.ts";
import type { Project } from "../../project/generated/types.ts";
import starter from "../../studio/starters/blinker-555.project.json";
import { buildSimNetlist } from "../netlist.ts";
import { drawBuild, spreadsOf } from "./part-tolerance.ts";

const reg = builtinRegistry();
const describeOf = (ref: string, version: string) => reg.get(ref, version);
const doc = starter as unknown as Project;
const { net } = buildSimNetlist(doc, reg);

describe("the spread of a part", () => {
  it("comes from its descriptor: resistors 5 percent, the ceramic 10, the electrolytic 20, the LED between its forward voltage limits", () => {
    const byPart = Object.fromEntries(spreadsOf(net, describeOf).map((s) => [s.part, s]));
    expect(Object.keys(byPart).sort()).toEqual(["cmp_c1", "cmp_c2", "cmp_led1", "cmp_r1", "cmp_r2", "cmp_r3"]);
    expect(byPart.cmp_r2.tol.tol).toEqual({ kind: "pct", value: 5 });
    expect(byPart.cmp_c2.tol.tol).toEqual({ kind: "pct", value: 10 });
    expect(byPart.cmp_c1.tol.tol).toEqual({ kind: "pct", value: 20 });
    expect(byPart.cmp_led1.param).toBe("vf");
    expect(byPart.cmp_led1.tol.nominal).toBeCloseTo(2, 6);
    expect(byPart.cmp_led1.tol.tol?.value).toBeCloseTo(0.2, 6);
  });

  it("takes 1 percent for the resistors when asked, and leaves the capacitors alone", () => {
    const byPart = Object.fromEntries(spreadsOf(net, describeOf, { resistorPct: 1 }).map((s) => [s.part, s]));
    expect(byPart.cmp_r1.tol.tol).toEqual({ kind: "pct", value: 1 });
    expect(byPart.cmp_c1.tol.tol).toEqual({ kind: "pct", value: 20 });
  });

  it("gives a transistor the gain range of its sheet", () => {
    const q = { id: "q1", descriptor: "core.npn-2n2222@1.0.0", params: {}, pins: {}, kind: "other" as const };
    const spreads = spreadsOf({ ...net, parts: [q] }, describeOf);
    expect(spreads).toHaveLength(1);
    expect(spreads[0].param).toBe("hfe");
    expect(spreads[0].tol.nominal).toBe(200);
    expect(spreads[0].tol.tol?.value).toBe(100);
  });
});

describe("one build", () => {
  const spreads = spreadsOf(net, describeOf);

  it("is the same for the same seed and different for another", () => {
    expect(drawBuild(net, spreads, 77).drawn).toEqual(drawBuild(net, spreads, 77).drawn);
    expect(drawBuild(net, spreads, 77).drawn).not.toEqual(drawBuild(net, spreads, 78).drawn);
  });

  it("keeps every value inside its tolerance and leaves the circuit's nets and the other parts alone", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { net: built, drawn } = drawBuild(net, spreads, seed);
      expect(drawn.cmp_r2.ohms).toBeGreaterThanOrEqual(68000 * 0.95);
      expect(drawn.cmp_r2.ohms).toBeLessThanOrEqual(68000 * 1.05);
      expect(drawn.cmp_c1.farads).toBeGreaterThanOrEqual(1e-5 * 0.8);
      expect(drawn.cmp_c1.farads).toBeLessThanOrEqual(1e-5 * 1.2);
      expect(drawn.cmp_led1.vf).toBeGreaterThanOrEqual(1.8);
      expect(drawn.cmp_led1.vf).toBeLessThanOrEqual(2.2);
      expect(built.nets).toBe(net.nets);
      expect(built.parts.find((p) => p.id === "cmp_u1")).toBe(net.parts.find((p) => p.id === "cmp_u1"));
      expect(built.parts.find((p) => p.id === "cmp_r2")!.params.ohms).toBe(drawn.cmp_r2.ohms);
    }
  });

  it("does not move a part's draw when another part is added", () => {
    const first = drawBuild(net, spreads, 5).drawn;
    const more = drawBuild(net, [...spreads, { part: "extra", param: "ohms", tol: { nominal: 100, tol: { kind: "pct", value: 5 } } }], 5).drawn;
    expect(more.cmp_r1).toEqual(first.cmp_r1);
    expect(more.cmp_c1).toEqual(first.cmp_c1);
  });
});

describe("the seeded tolerance mode of a project", () => {
  const seeded = (seed: number, mode: string): Project => ({ ...doc, simulation: { ...doc.simulation, seed, solver: { ...doc.simulation.solver, options: { ...doc.simulation.solver.options, toleranceMode: mode } } } });

  it("builds the netlist from the drawn parts, and the nominal mode from the placed values", () => {
    const nominal = buildSimNetlist(seeded(9, "nominal"), reg).net;
    const drawn = buildSimNetlist(seeded(9, "seeded"), reg).net;
    expect(nominal.parts.find((p) => p.id === "cmp_r2")!.params.ohms).toBe(68000);
    expect(drawn.parts.find((p) => p.id === "cmp_r2")!.params.ohms).not.toBe(68000);
    expect(drawn.parts.find((p) => p.id === "cmp_r2")!.params.ohms).toBe(drawBuild(net, spreadsOf(net, describeOf), 9).drawn.cmp_r2.ohms);
  });
});
