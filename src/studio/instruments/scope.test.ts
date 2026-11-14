import { describe, expect, it } from "vitest";
import { autoVoltsPerDiv, channelScale, sampleIntervalNs, TIME_PER_DIV_S, VOLTS_PER_DIV } from "./scope.ts";

describe("scope ladders", () => {
  it("run in 1, 2, 5 steps", () => {
    expect(TIME_PER_DIV_S.slice(0, 4)).toEqual([1e-6, 2e-6, 5e-6, 1e-5]);
    expect(TIME_PER_DIV_S[TIME_PER_DIV_S.length - 1]).toBe(1);
    expect(VOLTS_PER_DIV.slice(0, 3)).toEqual([0.001, 0.002, 0.005]);
    expect(VOLTS_PER_DIV[VOLTS_PER_DIV.length - 1]).toBe(20);
  });

  it("are rising", () => {
    for (const ladder of [TIME_PER_DIV_S, VOLTS_PER_DIV]) expect([...ladder].sort((a, b) => a - b)).toEqual([...ladder]);
  });
});

describe("autoVoltsPerDiv", () => {
  it("fits a 3.3 V swing on 500 mV per division", () => {
    expect(autoVoltsPerDiv(3.3)).toBe(0.5);
  });

  it("fits 5 V on 1 V per division", () => {
    expect(autoVoltsPerDiv(5)).toBe(1);
  });

  it("stays on the ladder for a flat line and for a huge swing", () => {
    expect(autoVoltsPerDiv(0)).toBe(0.001);
    expect(autoVoltsPerDiv(1e6)).toBe(20);
  });
});

describe("channelScale", () => {
  it("keeps ground on the bottom line for a trace above it, so an RC charge fills the screen from 0 V", () => {
    expect(channelScale(0, 3.3)).toEqual({ mid: 2, div: 0.5 });
    expect(channelScale(0, 5)).toEqual({ mid: 4, div: 1 });
  });

  it("shows a settled level against ground and not as a ripple", () => {
    expect(channelScale(3.28, 3.3)).toEqual({ mid: 2, div: 0.5 });
  });

  it("puts ground on the middle line for a signal that crosses it, and on the top line for one below it", () => {
    expect(channelScale(-1, 1)).toEqual({ mid: 0, div: 0.5 });
    expect(channelScale(-0.4, 1)).toEqual({ mid: 0, div: 0.5 });
    expect(channelScale(-3.3, -1)).toEqual({ mid: -2, div: 0.5 });
  });

  it("centres a chosen division on the trace in whole divisions", () => {
    expect(channelScale(3.28, 3.3, 0.01)).toEqual({ mid: 3.29, div: 0.01 });
    expect(channelScale(0, 5, 1)).toEqual({ mid: 3, div: 1 });
  });
});

describe("sampleIntervalNs", () => {
  it("keeps a thousand samples of the window on screen", () => {
    expect(sampleIntervalNs(0.5)).toBe(5_000_000);
    expect(sampleIntervalNs(1e-3)).toBe(10_000);
  });

  it("is never under a nanosecond", () => {
    expect(sampleIntervalNs(1e-12)).toBe(1);
  });
});
