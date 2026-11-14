import { describe, expect, it } from "vitest";
import { MIN_FLOW_AMPS, RAMP_STEPS, niceMax, rampColour, rampStep, rangeOf, speedPx } from "./scale.ts";

describe("the voltage scale", () => {
  it("rounds the largest voltage up to 1, 2 or 5 times a power of ten", () => {
    expect([niceMax(0.3), niceMax(1), niceMax(3.3), niceMax(5), niceMax(5.1), niceMax(12)]).toEqual([0.5, 1, 5, 5, 10, 20]);
  });

  it("never goes under a tenth of a volt", () => {
    expect(niceMax(0)).toBe(0.1);
    expect(niceMax(0.001)).toBe(0.1);
  });

  it("is symmetric: a circuit that swings to -4 V is scaled by 5 like one that reaches 4 V", () => {
    expect(rangeOf({ a: -4, b: 1 })).toEqual({ max: 5, low: -4, high: 1 });
    expect(rangeOf({ a: 4 }).max).toBe(5);
  });

  it("ignores a voltage that is not a number", () => {
    expect(rangeOf({ a: Number.NaN, b: 2 })).toEqual({ max: 2, low: 0, high: 2 });
  });

  it("steps the colour ramp from the cool end through zero to the warm end and clamps beyond", () => {
    expect([rampStep(-5, 5), rampStep(0, 5), rampStep(2.5, 5), rampStep(5, 5), rampStep(50, 5)]).toEqual([-RAMP_STEPS, 0, RAMP_STEPS / 2, RAMP_STEPS, RAMP_STEPS]);
  });

  it("mixes the zero colour toward an end by the step", () => {
    const tokens = { warm: "red", cool: "blue", zero: "grey" };
    expect(rampColour(0, tokens)).toBe("grey");
    expect(rampColour(RAMP_STEPS, tokens)).toBe("color-mix(in srgb, red 100%, grey)");
    expect(rampColour(-RAMP_STEPS / 2, tokens)).toBe("color-mix(in srgb, blue 50%, grey)");
  });
});

describe("how fast dots travel", () => {
  it("draws no motion below the smallest current", () => {
    expect(speedPx(MIN_FLOW_AMPS / 2)).toBe(0);
  });

  it("grows with the logarithm of the current and stops at a cap", () => {
    expect(speedPx(1e-6)).toBeLessThan(speedPx(1e-3));
    expect(speedPx(1e-3)).toBeLessThan(speedPx(1));
    expect(speedPx(1e6)).toBe(speedPx(1e9));
  });

  it("is the same either way round", () => {
    expect(speedPx(-0.01)).toBe(speedPx(0.01));
  });
});
