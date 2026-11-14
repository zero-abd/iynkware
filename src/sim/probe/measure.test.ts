// @vitest-environment node
import { describe, expect, it } from "vitest";
import { measure, type Trace, valueAt } from "./measure.ts";

const NS = 1e9;

function sample(f: (tSec: number) => number, hz: number, periods: number, perPeriod: number, zoh = false): Trace {
  const n = Math.round(periods * perPeriod);
  const t = Float64Array.from({ length: n + 1 }, (_, i) => (i / perPeriod / hz) * NS);
  return { t, v: Float64Array.from(t, (ns) => f(ns / NS)), zoh };
}

describe("measure", () => {
  it("reads a sine of 1 kHz, 1.5 V peak on 0.5 V", () => {
    const m = measure(sample((s) => 0.5 + 1.5 * Math.sin(2 * Math.PI * 1000 * s + 0.4), 1000, 5.3, 200))!;
    expect(m.freqHz).toBeCloseTo(1000, -1);
    expect(m.vppVolts).toBeCloseTo(3, 2);
    expect(m.vmeanVolts).toBeCloseTo(0.5, 2);
    expect(m.vrmsVolts).toBeCloseTo(Math.sqrt(0.25 + 1.5 ** 2 / 2), 2);
    expect(m.dutyPercent).toBeCloseTo(50, 0);
  });

  it("reads the duty of a held 25 percent pulse train at 2 kHz", () => {
    const m = measure(sample((s) => ((s * 2000) % 1 < 0.25 ? 5 : 0), 2000, 6, 400, true))!;
    expect(m.freqHz).toBeCloseTo(2000, -1);
    expect(m.dutyPercent).toBeCloseTo(25, 0);
    expect(m.vrmsVolts).toBeCloseTo(5 * Math.sqrt(0.25), 1);
  });

  it("reads a triangle's RMS as peak over root three", () => {
    const tri = (s: number) => 4 * Math.abs(((s * 500) % 1) - 0.5) - 1;
    const m = measure(sample(tri, 500, 4.5, 400))!;
    expect(m.vrmsVolts).toBeCloseTo(1 / Math.sqrt(3), 2);
    expect(m.vppVolts).toBeCloseTo(2, 2);
  });

  it("has no frequency for a steady level or a single edge", () => {
    expect(measure({ t: [0, 1000], v: [3, 3], zoh: false })).toMatchObject({ freqHz: null, dutyPercent: null, vppVolts: 0, vrmsVolts: 3 });
    expect(measure({ t: [0, 1000, 2000], v: [0, 5, 5], zoh: true })?.freqHz).toBeNull();
  });

  it("has nothing to say about fewer than two samples", () => {
    expect(measure({ t: [0], v: [1], zoh: true })).toBeNull();
  });
});

describe("valueAt", () => {
  const line: Trace = { t: [0, 100, 200], v: [0, 10, 0], zoh: false };

  it("runs along the line between samples", () => {
    expect(valueAt(line, 50)).toBe(5);
    expect(valueAt(line, 150)).toBe(5);
    expect(valueAt(line, 100)).toBe(10);
  });

  it("holds a stepped trace", () => {
    expect(valueAt({ ...line, zoh: true }, 99)).toBe(0);
    expect(valueAt({ ...line, zoh: true }, 100)).toBe(10);
  });

  it("is null before the first sample and holds the last one after it", () => {
    expect(valueAt(line, -1)).toBeNull();
    expect(valueAt(line, 500)).toBe(0);
    expect(valueAt({ t: [], v: [], zoh: true }, 0)).toBeNull();
  });
});
