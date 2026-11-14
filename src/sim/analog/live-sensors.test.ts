// @vitest-environment node
import { describe, expect, it } from "vitest";
import { partInputChanges } from "./part-input.ts";
import { type BenchPart, bench, resistor } from "./live-bench.testing.ts";

const vcc = (net: string): BenchPart => ({ part: { id: "V", descriptor: "core.aa-holder-4@1.0.0", params: { volts: 5 }, pins: { PLUS: net, MINUS: "gnd" }, kind: "other" } });
const sensor = (id: string, name: string, pins: Record<string, string>, params: Record<string, number> = {}): BenchPart => ({
  part: { id, descriptor: `core.${name}@1.0.0`, params, pins, kind: "other" },
});

describe("sensors in the live solver", () => {
  it("an LDR divider reads higher in brighter light, and follows a light change during the run", () => {
    const divider = (lux: number) => bench([vcc("v"), sensor("L", "ldr", { P1: "v", P2: "a0" }, { lux }), resistor("R", "a0", "gnd", 10_000)], { mode: "dc-event" });
    const dim = divider(10).netVolts("a0")!;
    const bright = divider(1000).netVolts("a0")!;
    expect(bright).toBeGreaterThan(dim + 2);
    const a = divider(10);
    a.apply(partInputChanges("core.ldr@1.0.0", "L", "lux", 1000)!);
    a.advanceTo(1e6);
    expect(a.netVolts("a0")).toBeCloseTo(bright, 3);
  });

  it("an FSR is open with no force and conducts when pressed", () => {
    const divider = (force: number) => bench([vcc("v"), sensor("F", "fsr402", { P1: "v", P2: "a0" }, { force }), resistor("R", "a0", "gnd", 10_000)], { mode: "dc-event" }).netVolts("a0")!;
    expect(divider(0)).toBeLessThan(0.01);
    expect(divider(10)).toBeGreaterThan(4);
  });

  it("a soil probe's AOUT falls as the soil gets wetter", () => {
    const aout = (moisture: number) => bench([sensor("S", "soil-moisture", { AOUT: "a0", VCC: "v", GND: "gnd" }, { moisture }), vcc("v"), resistor("R", "a0", "gnd", 1e6)], { mode: "dc-event" }).netVolts("a0")!;
    expect(aout(0)).toBeGreaterThan(aout(100) + 1);
  });

  it("a TMP36 gives 0.5 V + 10 mV per degree from its temperature setting", () => {
    const out = bench([vcc("v"), sensor("T", "tmp36", { PLUS_VS: "v", VOUT: "a0", GND: "gnd" }, { temp_c: 30 }), resistor("R", "a0", "gnd", 1e6)], { mode: "dc-event" });
    expect(out.netVolts("a0")).toBeCloseTo(0.8, 2);
  });

  it("a ranger's distance changes nothing in the circuit", () => {
    expect(partInputChanges("core.hc-sr04@1.0.0", "U", "distance", 40)).toEqual([]);
  });
});
