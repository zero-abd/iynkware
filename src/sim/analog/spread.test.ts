// @vitest-environment node
import { describe, expect, it } from "vitest";
import { frequencyHz, histogram, passCount, summarize } from "./spread.ts";

const wave = (hz: number, seconds: number, stepS: number, offsetS = 0) => {
  const at: number[] = [];
  const volts: number[] = [];
  for (let t = 0; t <= seconds; t += stepS) {
    at.push(t);
    volts.push(Math.floor((t + offsetS) * hz * 2) % 2 === 0 ? 5 : 0);
  }
  return { at, volts };
};

describe("summarize", () => {
  it("gives the lowest, middle and highest of the readings and leaves out a build with none", () => {
    expect(summarize([3, null, 1, 2, 10])).toEqual({ count: 4, min: 1, median: 2.5, max: 10, mean: 4 });
    expect(summarize([null, null])).toBeNull();
  });
});

describe("histogram", () => {
  it("puts every reading in one bar, the highest in the last, and keeps which builds are in each", () => {
    const bins = histogram([0, 1, 2, 3, 4, null, 10], 5);
    expect(bins.map((b) => b.builds.length)).toEqual([2, 2, 1, 0, 1]);
    expect(bins[1].builds).toEqual([2, 3]);
    expect(bins[4].builds).toEqual([6]);
    expect(bins[0].lo).toBe(0);
    expect(bins[4].hi).toBe(10);
  });

  it("is a single bar when every build read the same", () => {
    expect(histogram([2, 2, 2], 10)).toEqual([{ lo: 2, hi: 2, builds: [0, 1, 2] }]);
  });
});

describe("passCount", () => {
  it("counts the builds inside the range, ends included, and fails a build with no reading", () => {
    expect(passCount([0.8, 0.9, 1, 1.1, 1.2, null], { min: 0.9, max: 1.1 })).toBe(3);
    expect(passCount([0.8, 1.5], { min: 1 })).toBe(1);
    expect(passCount([0.8, 1.5], {})).toBe(2);
  });
});

describe("frequencyHz", () => {
  it("reads the frequency of a square wave to within a step", () => {
    const { at, volts } = wave(2, 3, 0.001);
    expect(frequencyHz(at, volts)).toBeCloseTo(2, 1);
  });

  it("does not count the settling before the first edge", () => {
    const { at, volts } = wave(1, 5, 0.001, 0.3);
    expect(frequencyHz(at, volts)).toBeCloseTo(1, 1);
  });

  it("is null for a level that does not swing and for a trace with one edge", () => {
    expect(frequencyHz([0, 1, 2], [3, 3.05, 3])).toBeNull();
    expect(frequencyHz([0, 1, 2, 3], [0, 0, 5, 5])).toBeNull();
  });
});
