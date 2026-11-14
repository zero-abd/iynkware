// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bench, capacitor, resistor, uno, unoPin, type BenchPart } from "./live-bench.testing.ts";

const tmp36 = (tempC: number): BenchPart => ({ part: { id: "T1", descriptor: "part:tmp36@1", params: { tempC }, pins: { VS: "n5", VOUT: "tout", GND: "gnd" }, kind: "other" } });
const buzzer = (kind: "active" | "passive"): BenchPart => ({ part: { id: "BZ1", descriptor: "part:piezo-buzzer@1", params: { kind }, pins: { POS: "d8", NEG: "gnd" }, kind: "buzzer" } });

// a 0.1 uF decoupling capacitor across a part's supply is what puts the circuit in the Newton solver
describe("a TMP36 beside a decoupling capacitor", () => {
  const read = (tempC: number) => {
    const a = bench([uno({ "5V": "n5", GND: "gnd" }), tmp36(tempC), capacitor("C1", "n5", "gnd", 0.1e-6), resistor("RL", "tout", "gnd", 100_000)], { mode: "transient" });
    a.advanceTo(1_000_000);
    return a.netVolts("tout")!;
  };

  it("reads 500 mV plus 10 mV per degree through its 20 ohm output", () => {
    const load = 100_000 / 100_020;
    expect(read(25)).toBeCloseTo(0.75 * load, 4);
    expect(read(100)).toBeCloseTo(1.5 * load, 4);
  });
});

describe("a buzzer in a circuit with a capacitor", () => {
  const sound = (kind: "active" | "passive") => {
    const a = bench([uno({ D8: "d8", GND: "gnd" }), buzzer(kind), capacitor("C1", "d8", "gnd", 1e-6)], { mode: "transient" });
    a.apply([{ kind: "pin", element: unoPin("D8"), level: 1 }]);
    a.advanceTo(1);
    a.advanceTo(5_000_000);
    return a;
  };

  it("draws (5 V - 0.05 V) / (100 ohm + 25 ohm pin) when active", () => {
    const a = sound("active");
    expect(a.readout().amps.get("BZ1")! * 1000).toBeCloseTo((4.95 / 125) * 1000, 0);
  });

  it("passes no direct current when passive, and the pin holds its 5 V", () => {
    const a = sound("passive");
    expect(a.readout().amps.get("BZ1")).toBeCloseTo(0, 6);
    expect(a.netVolts("d8")).toBeCloseTo(5, 2);
  });
});
