// @vitest-environment node
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "../../parts/builtin.ts";
import { StateHasher } from "../core/hash.ts";
import type { DigitalLayer, SimNetlist, SimRunOptions, SliceBudget } from "../engine.ts";
import { createOrchestrator } from "../orchestrator.ts";
import { createRunAnalog } from "./run.ts";

const MS = 1_000_000;
const BUDGET: SliceBudget = { shouldYield: () => false, work: { statements: Infinity, events: Infinity, outputBytes: Infinity } };
const OPTS: SimRunOptions = { seed: 1, speed: 1, limits: { statements: 1e6, events: 1e6, outputBytes: 1e6 }, tier: "T1" };
const DIGITAL: DigitalLayer = { load: () => [], onPin: () => undefined, partStates: () => [], stateHash: () => new StateHasher().hex() };

const net: SimNetlist = {
  version: 1,
  docHash: "t",
  nets: [{ id: "gnd" }, { id: "in" }, { id: "out" }],
  ground: "gnd",
  parts: [
    { id: "R1", descriptor: "core.resistor@1.0.0", params: { ohms: 1000 }, pins: { P1: "in", P2: "out" }, kind: "resistor" },
    { id: "C1", descriptor: "core.capacitor-ceramic@1.0.0", params: { farads: 1e-6 }, pins: { P1: "out", P2: "gnd" }, kind: "other" },
  ],
  settings: { seed: 1, toleranceMode: "nominal", analog: { mode: "transient", stepNs: MS / 10 }, speed: 1 },
};

const supply = (volts: number) => ({ kind: "psu", pos: "in", neg: "gnd", volts, limitAmps: 1 }) as const;

/** An RC with a 5 V bench supply put in at 0: R 1 kohm, C 1 uF, so a time constant of 1 ms. */
function bench() {
  const live = createRunAnalog(builtinRegistry());
  const orch = createOrchestrator({ engines: [], digital: DIGITAL, analog: live });
  orch.load(net, OPTS);
  expect(orch.setInstrument("ps1", supply(5))).toEqual({ ok: true });
  const to = (ns: number) => void orch.runUntil(ns, BUDGET);
  return { live, orch, to, out: () => live.netVolts("out")! };
}

describe("the step of a transient run", () => {
  const without = (analog: SimNetlist["settings"]["analog"]) => {
    const orch = createOrchestrator({ engines: [], digital: DIGITAL, analog: createRunAnalog(builtinRegistry()) });
    orch.load({ ...net, settings: { ...net.settings, analog } }, OPTS);
    return orch.analogStepNs;
  };

  it("is the one the project names", () => {
    expect(without({ mode: "transient", stepNs: 5000 })).toBe(5000);
  });

  it("is sized from the circuit when the project names none: a fiftieth of the 1 ms time constant", () => {
    expect(without({ mode: "transient" })).toBe(20_000);
  });

  it("is chosen for a circuit with a capacitor even when the project asks only for events", () => {
    expect(without({ mode: "dc-event" })).toBe(20_000);
  });
});

describe("a transient run of the live solver", () => {
  it("charges an RC the way 5 (1 - e^(-t/RC)) says, from an empty capacitor", () => {
    const { to, out } = bench();
    to(MS);
    expect(out()).toBeCloseTo(5 * (1 - Math.exp(-1)), 1);
    to(5 * MS);
    expect(out()).toBeCloseTo(5 * (1 - Math.exp(-5)), 1);
  });

  it("keeps the charge across a change at an instant between steps: the capacitor holds and the supply jumps", () => {
    const { orch, to, out, live } = bench();
    to(MS + MS / 20);
    orch.setInstrument("ps1", supply(0));
    to(MS + MS / 20 + 1);
    const held = 5 * (1 - Math.exp(-1.05));
    expect(live.netVolts("in")!).toBeCloseTo(0, 2);
    expect(out()).toBeCloseTo(held, 1);
    to(3 * MS);
    expect(out()).toBeCloseTo(held * Math.exp(-1.95), 1);
  });

  it("carries on from a snapshot as the run it was taken from does", () => {
    const { live, to, out } = bench();
    to(MS);
    const snapshot = live.snapshot();
    to(2 * MS);
    const onward = out();
    live.restore(snapshot);
    for (let t = MS + MS / 10; t <= 2 * MS; t += MS / 10) live.advanceTo(t);
    expect(out()).toBeCloseTo(onward, 3);
  });

  it("holds a charged capacitor at 5 V through a long quiet run and answers when the supply changes", () => {
    const { orch, to, out } = bench();
    to(40 * MS);
    expect(out()).toBeCloseTo(5, 3);
    to(400 * MS);
    expect(out()).toBeCloseTo(5, 3);
    orch.setInstrument("ps1", supply(2));
    to(405 * MS);
    expect(out()).toBeCloseTo(2 + 3 * Math.exp(-5), 2);
  });
});
