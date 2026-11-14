// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SliceBudget } from "../engine.ts";
import type { LiveAnalog } from "../analog/live.ts";
import { loadRegistry } from "../registry/entries.ts";
import { createProbeTap } from "./tap.ts";

const NEVER: SliceBudget = { shouldYield: () => false, work: { statements: Infinity, events: Infinity, outputBytes: Infinity } };

function rig() {
  let volts = 0;
  const analog = { netVolts: () => volts } as unknown as LiveAnalog;
  const tap = createProbeTap({ analog, registry: loadRegistry(), modelOf: () => [] });
  return { tap, set: (v: number) => void (volts = v) };
}

const spec = (sampleNs?: number) => ({ id: "p", kind: "voltage" as const, target: "n1", capacity: 64, envelope: false, ...(sampleNs === undefined ? {} : { sampleNs }) });

describe("a probe tap in a stepped run", () => {
  it("takes a sample at each step it is told about and no more than one per sample period", () => {
    const { tap, set } = rig();
    const h = tap.add(spec(1000));
    for (const [at, v] of [[500, 1], [1000, 2], [1500, 3], [2000, 4]] as const) {
      set(v);
      tap.observe(at);
    }
    const chunk = tap.stream(h, 0);
    expect(Array.from(chunk.t)).toEqual([1000, 2000]);
    expect(Array.from(chunk.v)).toEqual([2, 4]);
    expect(chunk.staircase).toBe(false);
  });

  it("does not make up samples at the instants the page asks once the solver reports its steps", () => {
    const { tap, set } = rig();
    const h = tap.add(spec(1000));
    set(1);
    tap.observe(1000);
    set(2);
    tap.advanceTo(5000, NEVER);
    expect(Array.from(tap.stream(h, 0).t)).toEqual([1000]);
  });

  it("still fills a sampled probe from the page's instants when the solver does not report steps", () => {
    const { tap, set } = rig();
    const h = tap.add(spec(1000));
    set(3);
    tap.advanceTo(3000, NEVER);
    expect(Array.from(tap.stream(h, 0).t)).toEqual([1000, 2000, 3000]);
  });

  it("leaves a probe with no sample period to the page's instants and calls its chunk a staircase", () => {
    const { tap, set } = rig();
    const h = tap.add(spec());
    set(1);
    tap.observe(1000);
    tap.advanceTo(2000, NEVER);
    expect(tap.stream(h, 0).staircase).toBe(true);
  });
});
