// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type BenchPart, bench, uno, unoPin } from "./live-bench.testing.ts";

const pack = (id: string, volts: number, plus: string): BenchPart => ({
  part: { id, descriptor: "core.aa-holder-4@1.0.0", params: { volts }, pins: { PLUS: plus, MINUS: "gnd" }, kind: "other" },
});
const motor = (id: string, plus: string, minus: string, kind = "tt-motor"): BenchPart => ({
  part: { id, descriptor: `core.${kind}@1.0.0`, params: {}, pins: { PLUS: plus, MINUS: minus }, kind: "other" },
});
const l298n = (pins: Record<string, string | null>): BenchPart => ({
  part: { id: "H", descriptor: "core.l298n-module@1.0.0", params: {}, pins: { VS: "vs", GND: "gnd", P5V: "p5v", ...pins }, kind: "other" },
});
const tb6612 = (pins: Record<string, string | null>): BenchPart => ({
  part: { id: "H", descriptor: "core.tb6612fng-module@1.0.0", params: {}, pins: { VM: "vm", VCC: "5v", GND: "gnd", ...pins }, kind: "other" },
});

/** Runs on in 5 ms steps and gives the last motor speed and output volts. */
function run(parts: BenchPart[], seconds: number, nets: string[] = []) {
  const a = bench(parts, { mode: "dc-event" });
  for (let t = 5e6; t <= seconds * 1e9; t += 5e6) a.advanceTo(t);
  return { a, rpm: (id = "M1") => a.readout().rpm.get(id) ?? 0, volts: Object.fromEntries(nets.map((n) => [n, a.netVolts(n) ?? NaN])) };
}

describe("L298N module", () => {
  const board = (pins: Record<string, string>) => uno({ "5V": "5v", GND: "gnd", ...pins });

  it("turns a motor forward with IN1 high and IN2 low, on a 12 V supply through its own 5 V regulator", () => {
    const parts = [pack("BAT", 12, "vs"), board({ D7: "in1", D8: "in2" }), l298n({ IN1: "in1", IN2: "in2", OUT1: "o1", OUT2: "o2" }), motor("M1", "o1", "o2")];
    const a = bench(parts, { mode: "dc-event" });
    a.apply([{ kind: "pin", element: unoPin("D7"), level: 1 }, { kind: "pin", element: unoPin("D8"), level: 0 }]);
    for (let t = 5e6; t <= 2e9; t += 5e6) a.advanceTo(t);
    expect(a.netVolts("p5v")).toBeCloseTo(5, 1);
    expect(a.readout().rpm.get("M1")).toBeGreaterThan(200);
    const across = a.netVolts("o1")! - a.netVolts("o2")!;
    expect(across).toBeGreaterThan(9);
    expect(across).toBeLessThan(12 - 1.4);
  });

  it("turns it back with the inputs swapped, and brakes with both inputs equal", () => {
    const parts = [pack("BAT", 12, "vs"), board({ D7: "in1", D8: "in2" }), l298n({ IN1: "in1", IN2: "in2", OUT1: "o1", OUT2: "o2" }), motor("M1", "o1", "o2")];
    const a = bench(parts, { mode: "dc-event" });
    a.apply([{ kind: "pin", element: unoPin("D7"), level: 0 }, { kind: "pin", element: unoPin("D8"), level: 1 }]);
    for (let t = 5e6; t <= 2e9; t += 5e6) a.advanceTo(t);
    expect(a.readout().rpm.get("M1")).toBeLessThan(-200);
    a.apply([{ kind: "pin", element: unoPin("D7"), level: 1 }]);
    for (let t = 2.005e9; t <= 3.5e9; t += 5e6) a.advanceTo(t);
    expect(Math.abs(a.netVolts("o1")! - a.netVolts("o2")!)).toBeLessThan(0.1);
    expect(Math.abs(a.readout().rpm.get("M1")!)).toBeLessThan(1);
  });

  it("sets the speed from the PWM duty on ENA", () => {
    const speedAt = (duty: number) => {
      const parts = [pack("BAT", 12, "vs"), board({ D5: "ena", D7: "in1", D8: "in2" }), l298n({ ENA: "ena", IN1: "in1", IN2: "in2", OUT1: "o1", OUT2: "o2" }), motor("M1", "o1", "o2")];
      const a = bench(parts, { mode: "dc-event" });
      a.apply([
        { kind: "pin", element: unoPin("D7"), level: 1 },
        { kind: "pin", element: unoPin("D8"), level: 0 },
        { kind: "pwm", element: unoPin("D5"), duty, hz: 490 },
      ]);
      for (let t = 5e6; t <= 2e9; t += 5e6) a.advanceTo(t);
      return a.readout().rpm.get("M1")!;
    };
    const half = speedAt(0.5);
    const full = speedAt(1);
    expect(speedAt(0)).toBe(0);
    expect(half).toBeGreaterThan(50);
    expect(half).toBeLessThan(full * 0.75);
  });

  it("lets the motor coast with ENA low, and does nothing on a supply too low for its regulator", () => {
    const coast = run([pack("BAT", 12, "vs"), pack("EN", 0, "ena"), pack("IN", 5, "in1"), l298n({ ENA: "ena", IN1: "in1", OUT1: "o1", OUT2: "o2" }), motor("M1", "o1", "o2")], 1);
    expect(coast.rpm()).toBe(0);
    const flat = run([pack("BAT", 5, "vs"), pack("IN", 5, "in1"), l298n({ IN1: "in1", OUT1: "o1", OUT2: "o2" }), motor("M1", "o1", "o2")], 1, ["p5v"]);
    expect(flat.rpm()).toBe(0);
    expect(flat.volts.p5v).toBeLessThan(1);
  });

  it("runs from an outside 5 V on P5V when the motor supply is low, and the battery carries the motor current", () => {
    const parts = [pack("BAT", 6, "vs"), pack("LOGIC", 5, "p5v"), pack("IN", 5, "in1"), l298n({ IN1: "in1", OUT1: "o1", OUT2: "o2" }), motor("M1", "o1", "o2")];
    const { a, rpm } = run(parts, 2);
    expect(rpm()).toBeGreaterThan(100);
    expect(Math.abs(a.readout().amps.get("BAT")!)).toBeGreaterThan(0.1);
  });
});

describe("TB6612FNG module", () => {
  const board = (pins: Record<string, string>) => uno({ "5V": "5v", GND: "gnd", ...pins });
  const wiring = { PWMA: "pwma", AIN1: "ain1", AIN2: "ain2", STBY: "stby", A01: "o1", A02: "o2" };
  const start = (levels: Record<string, 0 | 1>, duty = 1) => {
    const parts = [pack("BAT", 6, "vm"), board({ D3: "pwma", D4: "ain1", D5: "ain2", D6: "stby" }), tb6612(wiring), motor("M1", "o1", "o2")];
    const a = bench(parts, { mode: "dc-event" });
    a.apply([
      ...Object.entries(levels).map(([pin, level]) => ({ kind: "pin" as const, element: unoPin(pin), level })),
      { kind: "pwm", element: unoPin("D3"), duty, hz: 490 },
    ]);
    for (let t = 5e6; t <= 2e9; t += 5e6) a.advanceTo(t);
    return a;
  };

  it("drives forward, back, and floats in standby", () => {
    expect(start({ D4: 1, D5: 0, D6: 1 }).readout().rpm.get("M1")).toBeGreaterThan(200);
    expect(start({ D4: 0, D5: 1, D6: 1 }).readout().rpm.get("M1")).toBeLessThan(-200);
    expect(start({ D4: 1, D5: 0, D6: 0 }).readout().rpm.get("M1")).toBe(0);
  });

  it("sets the speed from the PWM duty and loses about 0.5 ohm x I", () => {
    const half = start({ D4: 1, D5: 0, D6: 1 }, 0.5).readout().rpm.get("M1")!;
    const full = start({ D4: 1, D5: 0, D6: 1 }, 1);
    expect(half).toBeGreaterThan(30);
    expect(half).toBeLessThan(full.readout().rpm.get("M1")! * 0.75);
    const across = full.netVolts("o1")! - full.netVolts("o2")!;
    expect(across).toBeGreaterThan(5.8);
  });
});

describe("TT motor with encoder", () => {
  it("gives quadrature edges on A and B at 528 pulses a wheel turn, A leading B going forward", () => {
    const parts: BenchPart[] = [
      pack("BAT", 6, "vp"),
      { part: { id: "M1", descriptor: "core.tt-motor-encoder@1.0.0", params: {}, pins: { PLUS: "vp", MINUS: "gnd", VCC: "5v", GND: "gnd", A: "a", B: "b" }, kind: "other" } },
      uno({ "5V": "5v", GND: "gnd", D2: "a", D3: "b" }),
    ];
    const live = bench(parts, { mode: "dc-event" });
    let rises = 0;
    let aLeads = 0;
    let last = { a: false, b: false };
    const step = 100_000;
    for (let t = step; t <= 2e9; t += step) {
      live.advanceTo(t);
      const now = { a: live.netVolts("a")! > 2.5, b: live.netVolts("b")! > 2.5 };
      if (t > 1e9 && now.a && !last.a) {
        rises++;
        if (!now.b) aLeads++;
      }
      last = now;
    }
    const rpm = live.readout().rpm.get("M1")!;
    expect(rpm).toBeGreaterThan(200);
    expect(rises).toBeGreaterThan(((rpm / 60) * 528) * 0.9);
    expect(rises).toBeLessThan(((rpm / 60) * 528) * 1.1);
    expect(aLeads).toBe(rises);
  });
});
