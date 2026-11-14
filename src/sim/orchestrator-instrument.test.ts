// @vitest-environment node
import { describe, expect, it } from "vitest";
import { StateHasher } from "./core/hash.ts";
import { createLiveAnalog } from "./analog/live.ts";
import { solve } from "./analog/solve.ts";
import type { InstrumentSource } from "./analog/types.ts";
import type { DigitalLayer, SimNetlist, SimRunOptions, SliceBudget } from "./engine.ts";
import { createOrchestrator } from "./orchestrator.ts";
import { loadRegistry } from "./registry/entries.ts";

const digital: DigitalLayer = { load: () => [], onPin: () => undefined, partStates: () => [], stateHash: () => new StateHasher().hex() };

const OPTS: SimRunOptions = { seed: 1, speed: 0, limits: { statements: 400_000, events: 100_000, outputBytes: 65_536 }, tier: "T1" };
const FOREVER: SliceBudget = { shouldYield: () => false, work: { statements: Infinity, events: Infinity, outputBytes: Infinity } };

const NETLIST: SimNetlist = {
  version: 1,
  docHash: "x",
  nets: [{ id: "gnd" }, { id: "n1" }],
  ground: "gnd",
  parts: [{ id: "r1", descriptor: "part:resistor@1", params: { ohms: 100 }, pins: { a: "n1", b: "gnd" }, kind: "resistor" }],
  settings: { seed: 1, toleranceMode: "nominal", analog: { mode: "dc-event", stepNs: 1000 }, speed: 0 },
};

const psu = (pos = "n1", neg = "gnd"): InstrumentSource => ({ kind: "psu", pos, neg, volts: 5, limitAmps: 0.5 });
const fgen: InstrumentSource = { kind: "fgen", pos: "n1", neg: "gnd", wave: { shape: "sine", amplitudeV: 1, offsetV: 0, hz: 1000, duty: 0.5, phaseDeg: 0 }, rSeriesOhms: 50 };

function withAnalog(analog: SimNetlist["settings"]["analog"] = NETLIST.settings.analog) {
  const live = createLiveAnalog({ solve, pins: () => null, registry: loadRegistry(), power: () => null });
  const o = createOrchestrator({ engines: [], digital, analog: live });
  o.load({ ...NETLIST, settings: { ...NETLIST.settings, analog } }, OPTS);
  return { o, live };
}

describe("setInstrument", () => {
  it("is refused while the run has no analog solver", () => {
    const o = createOrchestrator({ engines: [], digital });
    o.load(NETLIST, OPTS);
    expect(o.setInstrument("ps1", psu())).toEqual({ ok: false, reason: "not-modelled-yet" });
    expect(o.inputs).toEqual([]);
  });

  it("puts a supply across a net, logs it as an input and lets the solver power the net", () => {
    const { o, live } = withAnalog();
    expect(o.setInstrument("ps1", psu())).toEqual({ ok: true });
    expect(o.inputs).toMatchObject([{ kind: "param", target: "inst:ps1", value: { source: psu() } }]);
    o.runUntil(1000, FOREVER);
    expect(live.netVolts("n1")).toBeCloseTo(5, 1);
    expect(live.instrumentReading("ps1")?.amps).toBeCloseTo(0.05, 2);
  });

  it("takes the supply out again and logs that too", () => {
    const { o, live } = withAnalog();
    o.setInstrument("ps1", psu());
    o.runUntil(1000, FOREVER);
    expect(o.setInstrument("ps1", null)).toEqual({ ok: true });
    o.runUntil(2000, FOREVER);
    expect(live.instrumentReading("ps1")).toBeNull();
    expect(o.inputs).toHaveLength(2);
  });

  it("answers unknown-net for a net the run lacks and for both ends on one net", () => {
    const { o } = withAnalog();
    expect(o.setInstrument("ps1", psu("nope"))).toEqual({ ok: false, reason: "unknown-net" });
    expect(o.setInstrument("ps1", psu("n1", "n1"))).toEqual({ ok: false, reason: "unknown-net" });
    expect(o.inputs).toEqual([]);
  });

  it("allows eight sources and refuses a ninth, but lets an existing one change", () => {
    const { o } = withAnalog();
    for (let i = 0; i < 8; i++) expect(o.setInstrument(`ps${i}`, psu())).toEqual({ ok: true });
    expect(o.setInstrument("ps8", psu())).toEqual({ ok: false, reason: "too-many" });
    expect(o.setInstrument("ps3", psu())).toEqual({ ok: true });
    o.setInstrument("ps0", null);
    expect(o.setInstrument("ps8", psu())).toEqual({ ok: true });
  });

  it("puts a function generator on a run with no time base: the solver starts stepping and the orchestrator ticks", () => {
    const { o, live } = withAnalog({ mode: "dc-event" });
    expect(o.analogStepNs).toBeNull();
    expect(o.setInstrument("fg1", fgen)).toEqual({ ok: true });
    o.runUntil(1000, FOREVER);
    expect(o.analogStepNs).toBe(10_000);
    o.runUntil(300_000, FOREVER);
    // a sine of 1 V through 50 ohm into 100 ohm, peaking a quarter of the 1 ms period in
    expect(live.netVolts("n1")).toBeCloseTo((Math.sin(2 * Math.PI * 300_000e-9 * 1000) * 100) / 150, 2);
  });

  it("stops stepping when the last generator is taken off a circuit that needs no time base, and starts again with the next", () => {
    const { o, live } = withAnalog({ mode: "dc-event" });
    o.setInstrument("fg1", fgen);
    o.runUntil(100_000, FOREVER);
    o.setInstrument("fg1", null);
    o.runUntil(200_000, FOREVER);
    expect(o.analogStepNs).toBeNull();
    expect(live.netVolts("n1")).toBeCloseTo(0, 6);
    o.setInstrument("fg2", fgen);
    o.runUntil(250_000, FOREVER);
    expect(o.analogStepNs).toBe(10_000);
    o.runUntil(450_000, FOREVER);
    expect(live.netVolts("n1")).not.toBe(0);
  });
});
