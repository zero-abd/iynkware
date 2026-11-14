// @vitest-environment node
import { describe, expect, it } from "vitest";
import { digitsFor, formatReading, scaleUnit } from "./provenance";
import type { Reading } from "./tap";

const reading = (value: number, unit: string): Reading => ({ value, unit, at: 0, provenance: "computed", tier: "T1", modelIds: [] });
const say = (key: string) => key;

describe("what a meter shows", () => {
  it("gives a piecewise model three digits, like a bench meter", () => {
    expect(digitsFor("T1")).toBe(3);
    expect(formatReading(reading(3.1623, "V"), say).text).toBe("3.16 V");
  });

  it("shows an amp under one in milliamps", () => {
    expect(formatReading(reading(0.012224, "A"), say).text).toBe("12.2 mA");
    expect(scaleUnit(0.5, "V")).toEqual({ value: 500, unit: "mV" });
  });

  it("leaves whole units, zero and other units alone", () => {
    expect(scaleUnit(2.5, "A")).toEqual({ value: 2.5, unit: "A" });
    expect(scaleUnit(0, "V")).toEqual({ value: 0, unit: "V" });
    expect(scaleUnit(0.5, "W")).toEqual({ value: 0.5, unit: "W" });
  });
});
