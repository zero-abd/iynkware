// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "../../parts/builtin.ts";
import type { Project } from "../../project/generated/types.ts";
import { createRunAnalog } from "../../sim/analog/run.ts";
import { StateHasher } from "../../sim/core/hash.ts";
import type { DigitalLayer, SimRunOptions, SliceBudget } from "../../sim/engine.ts";
import { buildSimNetlist } from "../../sim/netlist.ts";
import { createOrchestrator } from "../../sim/orchestrator.ts";

// The starters run on the engine the Studio uses: the netlist builder, the orchestrator and the live solver, with no
// sketch. What each guide promises is read off the nets the way the Multimeter reads them.

const parts = builtinRegistry();
const BUDGET: SliceBudget = { shouldYield: () => false, work: { statements: Infinity, events: Infinity, outputBytes: Infinity } };
const OPTS: SimRunOptions = { seed: 1, speed: 1, limits: { statements: 1e6, events: 1e6, outputBytes: 1e6 }, tier: "T1" };
const DIGITAL: DigitalLayer = { load: () => [], onPin: () => undefined, partStates: () => [], stateHash: () => new StateHasher().hex() };

function bench(id: string, { sized = false }: { sized?: boolean } = {}) {
  const project = JSON.parse(readFileSync(join(__dirname, `${id}.project.json`), "utf8")) as Project;
  // a project a student built has no step of its own: the solver sizes one from the circuit
  if (sized) delete (project.simulation.solver.options as { stepNs?: number }).stepNs;
  const { net } = buildSimNetlist(project, parts);
  const live = createRunAnalog(parts);
  const orch = createOrchestrator({ engines: [], digital: DIGITAL, analog: live });
  orch.load(net, OPTS);
  const netOf = (refdes: string, pin: string) => {
    const id = project.components.find((c) => c.refdes === refdes)!.id;
    return net.parts.find((p) => p.id === id)!.pins[pin]!;
  };
  const volts = (refdes: string, pin: string) => live.netVolts(netOf(refdes, pin))!;
  const runTo = (seconds: number) => void orch.runUntil(Math.round(seconds * 1e9), BUDGET);
  return { live, orch, netOf, volts, runTo, net, project, id: (refdes: string) => project.components.find((c) => c.refdes === refdes)!.id };
}

describe("the starters on the live solver", () => {
  it("rc-led: the capacitor charges toward 5 V less the LED drop with a time constant of 0.47 s", () => {
    const b = bench("rc-led");
    b.runTo(0.47);
    const atTau = b.volts("C1", "PLUS") - b.volts("C1", "MINUS");
    expect(atTau).toBeGreaterThan(1.7);
    expect(atTau).toBeLessThan(2.1);
    const ro = b.live.readout();
    expect(ro.amps.get(b.id("C1"))!).toBeGreaterThan(0.001);
    b.runTo(3);
    expect(b.volts("C1", "PLUS") - b.volts("C1", "MINUS")).toBeGreaterThan(2.8);
  });

  it("blinker-555: the output goes high and low about once a second", () => {
    const b = bench("blinker-555");
    const levels: number[] = [];
    for (let t = 0.05; t <= 3.2; t += 0.05) {
      b.runTo(t);
      levels.push(b.volts("U2", "OUT"));
    }
    const edges = levels.slice(1).filter((v, i) => v > 2.5 !== levels[i] > 2.5).length;
    expect(Math.max(...levels)).toBeGreaterThan(3.9);
    expect(Math.min(...levels)).toBeLessThan(0.5);
    expect(edges).toBeGreaterThanOrEqual(5);
    expect(edges).toBeLessThanOrEqual(7);
  });

  it("opamp-amplifier: 1 V in gives about 2 V out", () => {
    const b = bench("opamp-amplifier");
    b.runTo(0.05);
    expect(b.volts("U2", "IN1P")).toBeCloseTo(1, 1);
    expect(b.volts("U2", "OUT1")).toBeCloseTo(2, 1);
  });

  it("opamp-amplifier: a 1 kHz generator on the input comes out as a wave, though the starter steps every millisecond", () => {
    const b = bench("opamp-amplifier");
    b.runTo(0.05);
    const wave = { shape: "sine", amplitudeV: 1, offsetV: 0, hz: 1000, duty: 0.5, phaseDeg: 0 } as const;
    b.live.apply([{ kind: "instrument", element: "fg1", source: { kind: "fgen", pos: b.netOf("U2", "IN1P"), neg: b.netOf("U2", "VEE"), wave, rSeriesOhms: 50 } }]);
    // read once a frame, as the page does
    const out: number[] = [];
    for (let t = 0.0667; t < 0.4; t += 0.0167) {
      b.runTo(t);
      out.push(b.volts("U2", "OUT1"));
    }
    expect(Math.max(...out)).toBeGreaterThan(1);
    expect(Math.min(...out)).toBeLessThan(0.1);
  });

  it("rectifier: the capacitor holds the peaks near 3.4 V and never goes negative", () => {
    const b = bench("rectifier");
    let low = Infinity;
    let high = -Infinity;
    for (let t = 0.3; t <= 0.5; t += 0.0005) {
      b.runTo(t);
      const v = b.volts("C1", "PLUS") - b.volts("C1", "MINUS");
      low = Math.min(low, v);
      high = Math.max(high, v);
    }
    expect(high).toBeGreaterThan(3.1);
    expect(high).toBeLessThan(3.7);
    expect(low).toBeGreaterThan(0);
    expect(high - low).toBeGreaterThan(0.2);
  });

  it("zener-regulator: the output stays near 4.8 V while the input sweeps past the breakdown", () => {
    const b = bench("zener-regulator");
    const outs: number[] = [];
    for (let t = 0.05; t <= 2; t += 0.05) {
      b.runTo(t);
      outs.push(b.volts("R2", "P1"));
    }
    expect(Math.max(...outs)).toBeLessThan(5.1);
    expect(Math.max(...outs)).toBeGreaterThan(4.4);
  });

  it("takes the step from the circuit when the project names none, and the circuits still do what the guides promise", () => {
    const rc = bench("rc-led", { sized: true });
    expect(rc.orch.analogStepNs).toBe(1_000_000);
    rc.runTo(0.47);
    expect(rc.volts("C1", "PLUS") - rc.volts("C1", "MINUS")).toBeGreaterThan(1.7);
    expect(rc.volts("C1", "PLUS") - rc.volts("C1", "MINUS")).toBeLessThan(2.1);

    const blinker = bench("blinker-555", { sized: true });
    expect(blinker.orch.analogStepNs).toBeGreaterThanOrEqual(10_000);
    expect(blinker.orch.analogStepNs).toBeLessThanOrEqual(1_000_000);
    const levels: number[] = [];
    for (let t = 0.05; t <= 3.2; t += 0.05) {
      blinker.runTo(t);
      levels.push(blinker.volts("U2", "OUT"));
    }
    const edges = levels.slice(1).filter((v, i) => v > 2.5 !== levels[i] > 2.5).length;
    expect(edges).toBeGreaterThanOrEqual(5);
    expect(edges).toBeLessThanOrEqual(7);
  });
});
