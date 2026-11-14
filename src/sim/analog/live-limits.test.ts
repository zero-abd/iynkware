// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bench, capacitor, resistor, uno } from "./live-bench.testing.ts";

const US = 1000;
const STEP = 10 * US;

describe("a source limit in a circuit with a capacitor", () => {
  // the 5 V pin carries 0.5 A at most; 5 ohm across it asks for 1 A, so it holds 0.5 A and the net settles at 0.5 A * 5 ohm
  const load = () => bench([uno({ "5V": "n5", GND: "gnd" }), resistor("R1", "n5", "gnd", 5), capacitor("C1", "n5", "gnd", 100e-6)], { mode: "transient", stepNs: STEP });

  it("sags the Uno 5 V pin to 2.5 V under a 5 ohm load, as it does without the capacitor", () => {
    const a = load();
    a.advanceTo(10_000 * US);
    expect(a.netVolts("n5")).toBeCloseTo(2.5, 3);
  });

  it("charges the net from the limit current: 2.5 (1 - e^(-t/RC)) with RC = 0.5 ms", () => {
    const a = load();
    a.advanceTo(500 * US);
    expect(a.netVolts("n5")).toBeCloseTo(2.5 * (1 - Math.exp(-1)), 2);
  });

  it("holds a bench supply in constant current mode and says so", () => {
    const a = bench([resistor("R1", "n1", "gnd", 10), capacitor("C1", "n1", "gnd", 10e-6)], { mode: "transient", stepNs: STEP });
    a.apply([{ kind: "instrument", element: "ps1", source: { kind: "psu", pos: "n1", neg: "gnd", volts: 12, limitAmps: 0.3 } }]);
    a.advanceTo(STEP);
    a.advanceTo(5_000 * US);
    const reading = a.instrumentReading("ps1")!;
    expect(reading.limiting).toBe(true);
    expect(reading.amps).toBeCloseTo(0.3, 3);
    expect(reading.volts).toBeCloseTo(3, 2);
    a.apply([{ kind: "instrument", element: "ps1", source: { kind: "psu", pos: "n1", neg: "gnd", volts: 2, limitAmps: 0.3 } }]);
    a.advanceTo(5_000 * US + STEP);
    a.advanceTo(10_000 * US);
    expect(a.instrumentReading("ps1")).toMatchObject({ limiting: false });
    expect(a.instrumentReading("ps1")!.volts).toBeCloseTo(2, 2);
  });
});
