// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MOTORS, steadyRpm } from "./devices/motor.ts";
import { bench, type BenchPart } from "./live-bench.testing.ts";

const pack = (volts = 6): BenchPart => ({ part: { id: "BAT", descriptor: "core.aa-holder-4@1.0.0", params: { volts }, pins: { PLUS: "vp", MINUS: "gnd" }, kind: "other" } });
const motor = (kind: string, params: Record<string, string | number> = {}): BenchPart => ({ part: { id: "M1", descriptor: `core.${kind}@1.0.0`, params, pins: { PLUS: "vp", MINUS: "gnd" }, kind: "other" } });

/** Runs the circuit on in 5 ms steps, as the orchestrator ticks it. */
function spin(parts: BenchPart[], seconds: number) {
  const a = bench(parts, { mode: "dc-event" });
  const trace: { rpm: number; amps: number; volts: number }[] = [];
  for (let t = 5e6; t <= seconds * 1e9; t += 5e6) {
    a.advanceTo(t);
    const r = a.readout();
    trace.push({ rpm: r.rpm.get("M1")!, amps: r.amps.get("M1")!, volts: a.netVolts("vp")! });
  }
  return { a, trace };
}

describe("motor back-EMF", () => {
  it("starts as a stall current and settles to the running current as it spins up", () => {
    const { trace } = spin([pack(4), motor("dc-motor")], 1.5);
    const first = trace[0];
    const last = trace[trace.length - 1];
    expect(first.amps).toBeGreaterThan(1.5);
    expect(last.amps).toBeGreaterThan(0.15);
    expect(last.amps).toBeLessThan(0.3);
    expect(last.rpm).toBeCloseTo(steadyRpm(MOTORS["dc-motor"].model, 1.43, last.volts), -2);
  });

  it("spins up through a lag instead of jumping to speed", () => {
    const { trace } = spin([pack(4), motor("dc-motor")], 1);
    expect(trace[2].rpm).toBeGreaterThan(0);
    expect(trace[2].rpm).toBeLessThan(trace[trace.length - 1].rpm / 2);
  });

  it("lets a battery pack keep its voltage once the motor is up to speed", () => {
    const { trace } = spin([pack(6), motor("tt-motor")], 3);
    const last = trace[trace.length - 1];
    expect(last.volts).toBeGreaterThan(5.9);
    expect(last.rpm).toBeGreaterThan(200);
    expect(last.rpm).toBeLessThan(240);
    expect(last.amps).toBeCloseTo(0.16, 1);
  });

  it("draws the stall current when the shaft is held, and never turns", () => {
    const { trace } = spin([pack(6), motor("tt-motor", { load: "stalled" })], 1);
    const last = trace[trace.length - 1];
    expect(last.rpm).toBe(0);
    expect(last.amps).toBeGreaterThan(1.2);
  });

  it("turns the other way with the leads swapped", () => {
    const swapped = motor("dc-motor");
    swapped.part.pins = { PLUS: "gnd", MINUS: "vp" };
    const { trace } = spin([pack(4), swapped], 1);
    expect(trace[trace.length - 1].rpm).toBeLessThan(-3000);
  });

  it("does not start below the start voltage", () => {
    const { trace } = spin([pack(0.8), motor("dc-motor")], 0.5);
    expect(trace[trace.length - 1].rpm).toBe(0);
  });

  it("runs a fan at about 6000 rpm and 0.1 A on 5 V", () => {
    const { trace } = spin([pack(5), motor("fan")], 3);
    const last = trace[trace.length - 1];
    expect(last.rpm).toBeGreaterThan(5500);
    expect(last.rpm).toBeLessThan(6300);
    expect(last.amps).toBeCloseTo(0.1, 1);
  });

  it("coasts down when the supply is taken away, slower than it spun up", () => {
    const { a } = spin([pack(4), motor("dc-motor")], 1);
    a.apply([{ kind: "source", element: "BAT", volts: 0 }]);
    const before = a.readout().rpm.get("M1")!;
    for (let t = 1.005e9; t <= 1.2e9; t += 5e6) a.advanceTo(t);
    const after = a.readout().rpm.get("M1")!;
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });
});
