import { describe, expect, it } from "vitest";
import { MIN_STEP_NS } from "../../sim/analog/step.ts";
import { coarseAboveHz, generatorRateHz, isCoarse, pointsPerPeriod, sampleRateHz } from "./sampling.ts";

describe("the rate a generator is sampled at", () => {
  it("is the step the project runs on, which a generator on the bench sets to 10 microseconds", () => {
    for (const hz of [0.1, 1, 50, 440, 1000]) expect(pointsPerPeriod(hz, generatorRateHz(hz, MIN_STEP_NS))).toBeGreaterThanOrEqual(100);
    expect(generatorRateHz(1e6, MIN_STEP_NS)).toBe(1e9 / MIN_STEP_NS);
  });

  it("is cut to a hundred points a period when the project names a coarser step", () => {
    expect(generatorRateHz(1000, 1_000_000)).toBe(100_000);
    expect(generatorRateHz(100, 1_000_000)).toBe(10_000);
  });

  it("drops to a few points a period above a kilohertz", () => {
    const rate = generatorRateHz(1e6, MIN_STEP_NS);
    expect(pointsPerPeriod(10_000, rate)).toBe(10);
    expect(pointsPerPeriod(100_000, rate)).toBe(1);
  });

  it("calls a wave coarse above a tenth of the rate and not at it", () => {
    const rate = generatorRateHz(1e6, MIN_STEP_NS);
    expect(coarseAboveHz(rate)).toBe(10_000);
    expect(isCoarse(10_000, rate)).toBe(false);
    expect(isCoarse(10_001, rate)).toBe(true);
    expect(isCoarse(1000, rate)).toBe(false);
  });
});

describe("sampleRateHz", () => {
  it("reads the rate from the spacing of the newest samples", () => {
    expect(sampleRateHz([0, 10_000, 20_000, 30_000])).toBe(100_000);
  });

  it("ignores one odd gap", () => {
    expect(sampleRateHz([0, 10_000, 20_000, 90_000, 100_000, 110_000])).toBe(100_000);
  });

  it("has no rate for fewer than two samples", () => {
    expect(sampleRateHz([])).toBeNull();
    expect(sampleRateHz([5])).toBeNull();
  });
});
