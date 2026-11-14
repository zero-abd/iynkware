// @vitest-environment node
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "../../parts/builtin.ts";
import { StateHasher } from "../core/hash.ts";
import type { DigitalLayer, SimNetlist, SimPart, SimRunOptions, SliceBudget } from "../engine.ts";
import { createOrchestrator } from "../orchestrator.ts";
import { createRunAnalog } from "./run.ts";

// Each passive and semiconductor on the live solver the Studio runs, doing the one job its card names: a divider, a
// ramp, a drop, a lit LED, a switch, a charge. A 5 V supply feeds net n1; ground is gnd.

const parts = builtinRegistry();
const BUDGET: SliceBudget = { shouldYield: () => false, work: { statements: Infinity, events: Infinity, outputBytes: Infinity } };
const OPTS: SimRunOptions = { seed: 1, speed: 1, limits: { statements: 1e6, events: 1e6, outputBytes: 1e6 }, tier: "T1" };
const DIGITAL: DigitalLayer = { load: () => [], onPin: () => undefined, partStates: () => [], stateHash: () => new StateHasher().hex() };

const part = (id: string, descriptor: string, pins: Record<string, string>, params: SimPart["params"] = {}): SimPart => ({ id, descriptor: `core.${descriptor}@1.0.0`, params, pins, kind: "other" });
const resistor = (id: string, a: string, b: string, ohms: number) => part(id, "resistor", { P1: a, P2: b }, { ohms });

function bench(list: SimPart[], stepNs = 1_000_000) {
  const net: SimNetlist = {
    version: 1,
    docHash: "t",
    nets: [...new Set(["gnd", "n1", ...list.flatMap((p) => Object.values(p.pins).filter((n): n is string => n !== null))])].map((id) => ({ id })),
    ground: "gnd",
    parts: list,
    settings: { seed: 1, toleranceMode: "nominal", analog: { mode: "transient", stepNs }, speed: 1 },
  };
  const live = createRunAnalog(parts);
  const orch = createOrchestrator({ engines: [], digital: DIGITAL, analog: live });
  orch.load(net, OPTS);
  expect(orch.setInstrument("ps1", { kind: "psu", pos: "n1", neg: "gnd", volts: 5, limitAmps: 1 })).toEqual({ ok: true });
  const at = (seconds: number) => void orch.runUntil(Math.round(seconds * 1e9), BUDGET);
  return { at, volts: (n: string) => live.netVolts(n)!, amps: (id: string) => live.readout().amps.get(id)!, state: (id: string) => live.readout().parts.get(id)?.state };
}

describe("passives", () => {
  it("resistor: two equal resistors halve the supply", () => {
    const b = bench([resistor("R1", "n1", "mid", 1000), resistor("R2", "mid", "gnd", 1000)]);
    b.at(0.01);
    expect(b.volts("mid")).toBeCloseTo(2.5, 2);
    expect(b.amps("R1")).toBeCloseTo(0.0025, 4);
  });

  it("resistor: a 1k and a 4k divider give a fifth of the supply across the 1k", () => {
    const b = bench([resistor("R1", "n1", "mid", 4000), resistor("R2", "mid", "gnd", 1000)]);
    b.at(0.01);
    expect(b.volts("mid")).toBeCloseTo(1, 2);
  });

  it("ceramic capacitor: charges through 1 k toward the supply, a third of the gap left after one time constant", () => {
    const b = bench([resistor("R1", "n1", "c", 1000), part("C1", "capacitor-ceramic", { P1: "c", P2: "gnd" }, { farads: 1e-5 })], 100_000);
    b.at(0.01);
    expect(b.volts("c")).toBeGreaterThan(3);
    expect(b.volts("c")).toBeLessThan(3.3);
    b.at(0.1);
    expect(b.volts("c")).toBeGreaterThan(4.9);
  });

  it("electrolytic capacitor: charges through 1 k toward the supply with a 0.1 s time constant", () => {
    const b = bench([resistor("R1", "n1", "c", 1000), part("C1", "capacitor-electrolytic", { PLUS: "c", MINUS: "gnd" }, { farads: 1e-4, rated_volts: 16 })]);
    b.at(0.1);
    expect(b.volts("c")).toBeGreaterThan(3);
    expect(b.volts("c")).toBeLessThan(3.4);
    b.at(1);
    expect(b.volts("c")).toBeGreaterThan(4.9);
  });

  it("inductor: opposes a step, then passes the full current set by the series resistor", () => {
    const b = bench([resistor("R1", "n1", "x", 100), part("L1", "inductor", { P1: "x", P2: "gnd" }, { henries: 0.01 })], 10_000);
    b.at(0.00002);
    const early = b.volts("x");
    expect(early).toBeGreaterThan(2);
    b.at(0.003);
    expect(b.volts("x")).toBeLessThan(0.3);
    expect(b.amps("L1")).toBeGreaterThan(0.04);
    expect(b.amps("L1")).toBeLessThan(0.0501);
  });
});

describe("diodes and LEDs", () => {
  it("1N4007: forward it drops about 0.7 V, and reversed it blocks", () => {
    const forward = bench([resistor("R1", "n1", "a", 1000), part("D1", "diode-1n4007", { A: "a", K: "gnd" })]);
    forward.at(0.01);
    expect(forward.volts("a")).toBeGreaterThan(0.6);
    expect(forward.volts("a")).toBeLessThan(0.9);
    const reversed = bench([resistor("R1", "n1", "a", 1000), part("D1", "diode-1n4007", { A: "gnd", K: "a" })]);
    reversed.at(0.01);
    expect(reversed.volts("a")).toBeGreaterThan(4.9);
  });

  it("LED: a red one on 220 ohm carries about 14 mA, and one fitted backwards passes none", () => {
    const lit = bench([resistor("R1", "n1", "a", 220), part("LED1", "led-5mm", { A: "a", K: "gnd" }, { color: "red" })]);
    lit.at(0.01);
    expect(lit.amps("LED1")).toBeGreaterThan(0.012);
    expect(lit.amps("LED1")).toBeLessThan(0.016);
    const backwards = bench([resistor("R1", "n1", "a", 220), part("LED1", "led-5mm", { A: "gnd", K: "a" }, { color: "red" })]);
    backwards.at(0.01);
    expect(Math.abs(backwards.amps("LED1"))).toBeLessThan(1e-6);
  });

  it("RGB LED: each colour lights on its own pin, and blue (the higher drop) carries less current than red", () => {
    const b = bench([
      resistor("RR", "n1", "r", 220),
      resistor("RG", "n1", "g", 220),
      resistor("RB", "n1", "bl", 220),
      part("LED1", "rgb-led", { R: "r", COM: "gnd", G: "g", B: "bl" }),
    ]);
    b.at(0.01);
    const [red, green, blue] = ["RR", "RG", "RB"].map((id) => b.amps(id));
    expect(red).toBeGreaterThan(0.008);
    expect(green).toBeGreaterThan(0.005);
    expect(blue).toBeGreaterThan(0.002);
    expect(blue).toBeLessThan(red);
  });
});

describe("transistors", () => {
  const switched = (descriptor: string, base: string) => {
    const pins = descriptor === "npn-2n2222" ? { E: "gnd", B: base, C: "c" } : { B: base, C: "c", E: "gnd" };
    return bench([resistor("RL", "n1", "c", 330), resistor("RB", base === "gnd" ? "gnd" : "n1", base === "gnd" ? "bx" : "b", 10000), part("Q1", descriptor, pins)]);
  };

  it.each([["npn-2n2222", 0.5], ["tip120", 1]] as const)("%s: base current pulls the collector low, and no base current leaves it at the supply", (descriptor, saturated) => {
    const on = switched(descriptor, "b");
    on.at(0.01);
    expect(on.volts("c")).toBeLessThan(saturated);
    const off = switched(descriptor, "gnd");
    off.at(0.01);
    expect(off.volts("c")).toBeGreaterThan(4.9);
  });
});
