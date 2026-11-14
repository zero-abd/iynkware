// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SimNetlist, SimPart } from "../engine.ts";
import { loadRegistry } from "../registry/entries.ts";
import { PWL_OPTIONS } from "./elements.ts";
import { createLiveAnalog, instrumentElementId, type LiveAnalog } from "./live.ts";
import { solve } from "./solve.ts";
import type { InstrumentSource } from "./types.ts";

const resistor = (id: string, a: string, b: string, ohms: number): SimPart => ({ id, descriptor: "part:resistor@1", params: { ohms }, pins: { a, b }, kind: "resistor" });

function netlist(parts: SimPart[], nets: string[]): SimNetlist {
  return {
    version: 1,
    docHash: "t",
    nets: nets.map((id) => ({ id })),
    ground: "gnd",
    parts,
    settings: { seed: 1, toleranceMode: "nominal", analog: { mode: "dc-event", stepNs: 1000 }, speed: 1 },
  };
}

function live(parts: SimPart[], nets: string[]): LiveAnalog {
  const a = createLiveAnalog({ solve, pins: () => null, registry: loadRegistry(), power: () => null });
  a.load(netlist(parts, nets), PWL_OPTIONS);
  a.advanceTo(0);
  return a;
}

const psu = (volts: number, limitAmps: number, pos = "n1", neg = "gnd"): InstrumentSource => ({ kind: "psu", pos, neg, volts, limitAmps });

describe("a bench supply in the live solver", () => {
  it("holds its set voltage across a light load and reports the amps it delivers", () => {
    const a = live([resistor("R1", "n1", "gnd", 100)], ["n1", "gnd"]);
    a.apply([{ kind: "instrument", element: "ps1", source: psu(5, 0.5) }]);
    a.advanceTo(1);
    const reading = a.instrumentReading("ps1")!;
    expect(reading.volts).toBeCloseTo(5, 1);
    expect(reading.amps).toBeCloseTo(0.05, 2);
    expect(reading.limiting).toBe(false);
    expect(a.netVolts("n1")).toBeCloseTo(5, 1);
  });

  it("goes constant current when the load asks for more than the limit", () => {
    const a = live([resistor("R1", "n1", "gnd", 10)], ["n1", "gnd"]);
    a.apply([{ kind: "instrument", element: "ps1", source: psu(12, 0.3) }]);
    a.advanceTo(1);
    const reading = a.instrumentReading("ps1")!;
    expect(reading.limiting).toBe(true);
    expect(reading.amps).toBeCloseTo(0.3, 3);
    expect(reading.volts).toBeCloseTo(3, 1);
  });

  it("leaves constant current once the setting is turned down", () => {
    const a = live([resistor("R1", "n1", "gnd", 10)], ["n1", "gnd"]);
    a.apply([{ kind: "instrument", element: "ps1", source: psu(12, 0.3) }]);
    a.advanceTo(1);
    a.apply([{ kind: "instrument", element: "ps1", source: psu(2, 0.3) }]);
    a.advanceTo(2);
    expect(a.instrumentReading("ps1")).toMatchObject({ limiting: false });
    expect(a.instrumentReading("ps1")!.volts).toBeCloseTo(2, 1);
  });

  it("joins circuits that were solved apart and powers a net nothing else touches", () => {
    const a = live([resistor("R1", "n1", "gnd", 100), resistor("R2", "n2", "n3", 100)], ["n1", "n2", "n3", "gnd"]);
    a.apply([{ kind: "instrument", element: "ps1", source: psu(4, 1, "n2", "gnd") }, { kind: "instrument", element: "ps2", source: psu(6, 1, "n3", "n2") }]);
    a.advanceTo(1);
    expect(a.netVolts("n2")).toBeCloseTo(4, 1);
    expect(a.netVolts("n3")).toBeCloseTo(10, 1);
    expect(a.instrumentReading("ps2")!.amps).toBeCloseTo(0.06, 2);
  });

  it("takes the source out again and keeps the circuit's own state across the change", () => {
    const a = live([resistor("R1", "n1", "gnd", 100)], ["n1", "gnd"]);
    a.apply([{ kind: "instrument", element: "ps1", source: psu(5, 0.5) }]);
    a.advanceTo(1);
    a.apply([{ kind: "instrument", element: "ps1", source: null }]);
    a.advanceTo(2);
    expect(a.instrumentReading("ps1")).toBeNull();
    expect(a.netVolts("n1")).toBeCloseTo(0, 6);
  });

  it("refuses a net the circuit does not have and says so", () => {
    const a = live([resistor("R1", "n1", "gnd", 100)], ["n1", "gnd"]);
    a.apply([{ kind: "instrument", element: "ps1", source: psu(5, 0.5, "nope") }, { kind: "instrument", element: "ps2", source: psu(5, 0.5, "n1", "n1") }]);
    const step = a.advanceTo(1);
    expect(step.diagnostics.filter((d) => d.args?.element === instrumentElementId("ps1") || d.args?.element === instrumentElementId("ps2"))).toHaveLength(2);
    expect(a.instrumentReading("ps1")).toBeNull();
  });

  it("restores a snapshot taken with an instrument set", () => {
    const a = live([resistor("R1", "n1", "gnd", 100)], ["n1", "gnd"]);
    a.apply([{ kind: "instrument", element: "ps1", source: psu(5, 0.5) }]);
    a.advanceTo(1);
    const snap = a.snapshot();
    a.apply([{ kind: "instrument", element: "ps1", source: null }]);
    a.advanceTo(2);
    a.restore(snap);
    expect(a.instrumentReading("ps1")?.volts).toBeCloseTo(5, 1);
  });

  it("drives a sine from a function generator in a transient run and reads its peak across the load", () => {
    const parts = [resistor("R1", "n1", "gnd", 100)];
    const a = createLiveAnalog({ solve, pins: () => null, registry: loadRegistry(), power: () => null });
    a.load({ ...netlist(parts, ["n1", "gnd"]), settings: { seed: 1, toleranceMode: "nominal", analog: { mode: "transient", stepNs: 10_000 }, speed: 1 } }, PWL_OPTIONS);
    a.advanceTo(0);
    const wave = { shape: "sine", amplitudeV: 1, offsetV: 0, hz: 1000, duty: 0.5, phaseDeg: 0 } as const;
    a.apply([{ kind: "instrument", element: "fg1", source: { kind: "fgen", pos: "n1", neg: "gnd", wave, rSeriesOhms: 50 } }]);
    let peak = 0;
    for (let t = 10_000; t <= 1_000_000; t += 10_000) {
      a.advanceTo(t);
      peak = Math.max(peak, a.netVolts("n1") ?? 0);
    }
    expect(peak).toBeCloseTo(100 / 150, 2);
    expect(a.instrumentReading("fg1")?.amps).toBeDefined();
  });
});
