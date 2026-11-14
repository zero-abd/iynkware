// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type BenchPart, bench, resistor } from "./live-bench.testing.ts";

const part = (id: string, name: string, pins: Record<string, string>, params: Record<string, string | number> = {}): BenchPart => ({
  part: { id, descriptor: `core.${name}@1.0.0`, params, pins, kind: "other" },
});

describe("battery packs", () => {
  it("start at the fresh alkaline volts and sag under a load by their internal resistance", () => {
    const idle = bench([part("BAT", "aa-holder-4", { PLUS: "vp", MINUS: "gnd" }), resistor("R", "vp", "gnd", 1e6)], { mode: "dc-event" });
    const loaded = bench([part("BAT", "aa-holder-4", { PLUS: "vp", MINUS: "gnd" }), resistor("R", "vp", "gnd", 6)], { mode: "dc-event" });
    expect(idle.netVolts("vp")).toBeGreaterThan(6.2);
    expect(loaded.netVolts("vp")!).toBeLessThan(idle.netVolts("vp")! - 0.4);
  });

  it("drain: a 2S LiPo on a heavy load reads lower an hour on", () => {
    const a = bench([part("BAT", "lipo-2s", { PLUS: "vp", MINUS: "gnd" }), resistor("R", "vp", "gnd", 8)], { mode: "dc-event" });
    const start = a.netVolts("vp")!;
    for (let t = 60e9; t <= 3600e9; t += 60e9) a.advanceTo(t);
    expect(start).toBeGreaterThan(8.2);
    expect(a.netVolts("vp")!).toBeLessThan(start - 0.3);
  });

  it("start lower for the nominal and low settings", () => {
    const at = (demo: string) => bench([part("BAT", "lipo-2s", { PLUS: "vp", MINUS: "gnd" }, { demo }), resistor("R", "vp", "gnd", 1e6)], { mode: "dc-event" }).netVolts("vp")!;
    expect(at("full")).toBeGreaterThan(at("nominal"));
    expect(at("nominal")).toBeGreaterThan(at("low"));
  });
});

describe("LM2596 module", () => {
  const buck = (vin: number, load: number, params: Record<string, number> = {}) =>
    bench(
      [
        part("IN", "aa-holder-4", { PLUS: "vin", MINUS: "gnd" }, { volts: vin }),
        part("U", "lm2596-module", { VIN: "vin", GND_IN: "gnd", VOUT: "vout", GND_OUT: "gnd" }, params),
        resistor("R", "vout", "gnd", load),
      ],
      { mode: "dc-event" },
    );

  it("holds 5 V from 12 V at the default trimmer setting, and takes less current in than it gives out", () => {
    const a = buck(12, 10);
    expect(a.netVolts("vout")).toBeCloseTo(5, 1);
    const iin = Math.abs(a.readout().amps.get("U:in")!);
    expect(iin).toBeGreaterThan(0.2);
    expect(iin).toBeLessThan(0.5);
  });

  it("follows the input down in dropout and is off below 3.6 V", () => {
    expect(buck(5.5, 10).netVolts("vout")!).toBeLessThan(5);
    expect(buck(3, 10).netVolts("vout")!).toBeLessThan(0.1);
  });

  it("sets a higher output with more trimmer turns", () => {
    expect(buck(12, 100, { trimmer_turns: 5 }).netVolts("vout")!).toBeGreaterThan(8);
  });
});

describe("traffic light module", () => {
  it("limits each lamp with its own resistor, so a 5 V pin gives about 9 mA", () => {
    const a = bench([part("V", "aa-holder-4", { PLUS: "r", MINUS: "gnd" }, { volts: 5 }), part("T", "traffic-light", { GND: "gnd", R: "r", Y: "y", G: "g" })], { mode: "dc-event" });
    const amps = Math.abs(a.readout().amps.get("T:R")!);
    expect(amps).toBeGreaterThan(0.007);
    expect(amps).toBeLessThan(0.011);
  });
});
