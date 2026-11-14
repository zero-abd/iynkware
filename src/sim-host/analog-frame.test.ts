// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Readout } from "@/sim/analog/readout";
import { createAnalogFrames, waveSamples } from "./analog-frame";
import { type AnalogWatch, MAX_WAVE_SAMPLES } from "./analog-protocol";

const readout = (volts: Record<string, number>, state: "ok" | "hot" = "ok"): Readout => ({
  volts: new Map(Object.entries(volts)),
  amps: new Map([["R1", 0.01]]),
  pinAmps: new Map(),
  parts: new Map([["R1", { watts: 0.1, state }]]),
  instruments: new Map(),
  rpm: new Map(),
});

const WATCH: AnalogWatch = { volts: "all", amps: "all", pinAmps: false, waves: [] };

describe("analog frames", () => {
  it("sends only part health without a watch and everything on the first frame after one", () => {
    let ro = readout({ a: 1, b: 2 });
    const frames = createAnalogFrames({ readout: () => ro, samples: () => null });
    expect(frames.frame(0)).toEqual({ full: true, parts: { R1: { watts: 0.1, state: "ok" } } });
    expect(frames.frame(1)).toBeNull();
    frames.watch(WATCH);
    expect(frames.frame(0)).toEqual({ full: true, volts: { a: 1, b: 2 }, amps: { R1: 0.01 }, parts: { R1: { watts: 0.1, state: "ok" } } });
    expect(frames.frame(1)).toBeNull();
    ro = readout({ a: 1, b: 2.5 }, "hot");
    expect(frames.frame(2)).toEqual({ full: false, volts: { b: 2.5 }, parts: { R1: { watts: 0.1, state: "hot" } } });
  });

  it("names only the nets it was asked for, and an empty watch leaves only part health", () => {
    const frames = createAnalogFrames({ readout: () => readout({ a: 1, b: 2 }), samples: () => null });
    frames.watch({ ...WATCH, volts: ["b"], amps: [] });
    expect(frames.frame(0)).toEqual({ full: true, volts: { b: 2 }, parts: { R1: { watts: 0.1, state: "ok" } } });
    frames.watch({ volts: [], amps: [], pinAmps: false, waves: [] });
    expect(frames.frame(1)).toEqual({ full: true, parts: { R1: { watts: 0.1, state: "ok" } } });
    expect(frames.frame(2)).toBeNull();
  });

  it("sends nothing for a circuit with no part health and no bench source", () => {
    const frames = createAnalogFrames({ readout: () => ({ ...readout({ a: 1 }), parts: new Map() }), samples: () => null });
    expect(frames.frame(0)).toBeNull();
  });

  it("starts again from a full frame when the watch changes", () => {
    const frames = createAnalogFrames({ readout: () => readout({ a: 1 }), samples: () => null });
    frames.watch(WATCH);
    frames.frame(0);
    frames.watch(WATCH);
    expect(frames.frame(1)?.full).toBe(true);
  });
});

describe("waveSamples", () => {
  const raw = { t: Float64Array.from([0, 5]), v: Float64Array.from([1, 3]), stepNs: 1 };

  it("holds each value on a uniform grid and continues where it stopped", () => {
    const cursor = { next: 0, last: null };
    expect(waveSamples(cursor, raw, 7)).toEqual({ fromNs: 0, stepNs: 1, v: [1, 1, 1, 1, 1, 3, 3, 3] });
    expect(waveSamples(cursor, raw, 7)).toBeNull();
  });

  it("thins a long stretch to a coarser uniform grid that ends on the newest sample", () => {
    const n = MAX_WAVE_SAMPLES * 3 + 1;
    const long = { t: Float64Array.from([0]), v: Float64Array.from([2]), stepNs: 1 };
    const w = waveSamples({ next: 0, last: null }, long, n - 1)!;
    expect(w.v.length).toBeLessThanOrEqual(MAX_WAVE_SAMPLES);
    expect(w.stepNs).toBe(Math.ceil(n / MAX_WAVE_SAMPLES));
    expect(w.fromNs + (w.v.length - 1) * w.stepNs).toBe(n - 1);
  });
});
