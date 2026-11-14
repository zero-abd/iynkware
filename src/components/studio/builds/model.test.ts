// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Project } from "@/project/generated/types";
import { accept } from "@/project/apply/fixtures.testing";
import type { BuildResult } from "@/sim-host/montecarlo/protocol";
import starter from "@/studio/starters/blinker-555.project.json";
import { burnsOf, formatReading, nominalOps, openBuildOps, targetsOf, watchedNode } from "./model";

const doc = starter as unknown as Project;
const burnt = (part: string) => ({ part, key: "fidelity.states.led", args: {} });
const result = (index: number, parts: string[]): BuildResult => ({ index, seed: index + 1, value: 1, burnt: parts.map(burnt), drawn: {} });

describe("what the Builds panel can measure", () => {
  it("lists the pins of the circuit for a voltage and the parts for a current, with no breadboard among them", () => {
    const pins = targetsOf(doc, "volts");
    expect(pins.map((p) => p.label)).toContain("U2 3");
    expect(new Set(pins.map((p) => p.value)).size).toBeGreaterThan(3);
    const parts = targetsOf(doc, "amps");
    expect(parts.map((p) => p.label).sort()).toEqual(["C1", "C2", "LED1", "R1", "R2", "R3", "U2"]);
    expect(parts.find((p) => p.label === "R1")!.target).toBe("cmp_r1");
    const out = pins.filter((p) => p.label.startsWith("R3 1") || p.label === "U2 3");
    expect(out).toHaveLength(2);
    expect(out[0].target).toBe(out[1].target);
    expect(out[0].value).not.toBe(out[1].value);
  });

  it("starts from the pin a meter of the project is on, and from nothing when there is none", () => {
    expect(watchedNode(doc)).toBeUndefined();
    const withMeter: Project = { ...doc, simulation: { ...doc.simulation, instruments: [{ id: "ins_1", kind: "voltmeter", target: { pin: { c: "cmp_u1", p: "OUT" } } }] } };
    expect(watchedNode(withMeter)).toBe(targetsOf(doc, "volts").find((p) => p.label === "U2 3")!.target);
  });
});

describe("a reading", () => {
  it("shows three digits in the unit it is read in", () => {
    expect(formatReading(1.08755, "hz")).toBe("1.09 Hz");
    expect(formatReading(0.892857, "hz")).toBe("0.893 Hz");
    expect(formatReading(0.05, "hz")).toBe("50 mHz");
    expect(formatReading(2500, "hz")).toBe("2.5 kHz");
    expect(formatReading(0.0123, "amps")).toBe("12.3 mA");
    expect(formatReading(0.00002, "amps")).toBe("20 µA");
    expect(formatReading(4.9987, "volts")).toBe("5 V");
    expect(formatReading(0.043, "volts")).toBe("43 mV");
    expect(formatReading(0, "amps")).toBe("0 A");
    expect(formatReading(-0.0123, "amps")).toBe("-12.3 mA");
  });
});

describe("opening a build", () => {
  it("puts the seed on the project and the seeded mode on its solver, and both undo", () => {
    const outcome = accept(doc, openBuildOps(doc, 123456));
    expect(outcome.state.simulation.seed).toBe(123456);
    expect(outcome.state.simulation.solver.options).toMatchObject({ toleranceMode: "seeded", mode: "transient", stepNs: 1_000_000 });
    const back = accept(outcome.state, outcome.inverse);
    expect(back.state.simulation).toEqual(doc.simulation);
  });

  it("goes back to the nominal parts without touching the rest of the solver", () => {
    const opened = accept(doc, openBuildOps(doc, 9)).state;
    const nominal = accept(opened, nominalOps(opened)).state;
    expect(nominal.simulation.solver.options).toMatchObject({ toleranceMode: "nominal", mode: "transient" });
  });
});

describe("the parts that burnt", () => {
  it("counts the builds each part burnt in, the most often first, and says where it first burnt", () => {
    const burns = burnsOf([result(0, []), result(1, ["cmp_led1"]), result(2, ["cmp_r1", "cmp_led1"]), result(3, ["cmp_led1"])]);
    expect(burns).toEqual([
      { part: "cmp_led1", count: 3, first: 1 },
      { part: "cmp_r1", count: 1, first: 2 },
    ]);
    expect(burnsOf([result(0, [])])).toEqual([]);
  });
});
