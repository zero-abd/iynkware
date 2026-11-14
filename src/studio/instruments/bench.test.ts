import { describe, expect, it } from "vitest";
import { BENCH_LIMITS, fgenSettings, fgenSource, psuSettings, psuSource, withSettings } from "./bench.ts";

describe("fgenSettings", () => {
  it("starts as a 1 kHz, 1 V peak sine with the output on", () => {
    expect(fgenSettings(undefined)).toEqual({ shape: "sine", hz: 1000, amplitudeV: 1, offsetV: 0, dutyPercent: 50, on: true });
  });

  it("keeps what is saved and holds the rest inside the generator's range", () => {
    const s = fgenSettings({ shape: "pulse", hz: 5e9, amplitudeV: -3, offsetV: 2.5, dutyPercent: 0, on: false, neg: "n_2" });
    expect(s).toEqual({ shape: "pulse", hz: BENCH_LIMITS.hz.max, amplitudeV: 0, offsetV: 2.5, dutyPercent: 1, on: false, neg: "n_2" });
  });

  it("falls back on junk", () => {
    expect(fgenSettings({ shape: "saw", hz: "fast", neg: 4 })).toMatchObject({ shape: "sine", hz: 1000 });
    expect(fgenSettings({ neg: "" })).not.toHaveProperty("neg");
  });
});

describe("psuSettings", () => {
  it("defaults to 5 V with a 100 mA limit", () => {
    expect(psuSettings(undefined)).toEqual({ volts: 5, limitAmps: 0.1, on: true });
  });

  it("holds the setpoints inside 0 to 30 V and 1 mA to 3 A", () => {
    expect(psuSettings({ volts: 99, limitAmps: 0 })).toMatchObject({ volts: 30, limitAmps: 0.001 });
  });
});

describe("sources", () => {
  it("makes a function generator source from the settings, with duty as a fraction", () => {
    const s = fgenSettings({ shape: "square", hz: 440, amplitudeV: 2, offsetV: 1, dutyPercent: 25 });
    expect(fgenSource(s, "a", "gnd")).toEqual({
      kind: "fgen",
      pos: "a",
      neg: "gnd",
      wave: { shape: "square", amplitudeV: 2, offsetV: 1, hz: 440, duty: 0.25, phaseDeg: 0 },
      rSeriesOhms: 50,
    });
  });

  it("makes a supply source, and no source while the output is off", () => {
    expect(psuSource(psuSettings({ volts: 3.3, limitAmps: 0.2 }), "a", "gnd")).toEqual({ kind: "psu", pos: "a", neg: "gnd", volts: 3.3, limitAmps: 0.2 });
    expect(psuSource(psuSettings({ on: false }), "a", "gnd")).toBeNull();
    expect(fgenSource(fgenSettings({ on: false }), "a", "gnd")).toBeNull();
  });

  it("merges a change over the settings an instrument has", () => {
    const next = withSettings({ id: "ins_a", kind: "power-supply", settings: { volts: 5, on: true } }, { volts: 9 });
    expect(next.settings).toEqual({ volts: 9, on: true });
    expect(withSettings(next, { on: undefined }).settings).toEqual({ volts: 9 });
  });
});
