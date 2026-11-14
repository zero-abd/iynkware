// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Project } from "../../../project/generated/types.ts";
import { breadboardPlan, edgeCurrents } from "./plan.ts";

const starter = (id: string) => JSON.parse(readFileSync(join(__dirname, "../../starters", `${id}.project.json`), "utf8")) as Project;
const rc = starter("rc-led");
const view = rc.views.find((v) => v.kind === "breadboard")!;

// the loop of the starter: 5 V pin, a resistor, an LED, a capacitor, ground
const LOOP = {
  brd_uno: { P5V: -0.006, GND: 0.006 },
  cmp_r1: { P1: 0.006, P2: -0.006 },
  cmp_led1: { A: 0.006, K: -0.006 },
  cmp_c1: { PLUS: 0.006, MINUS: -0.006 },
};

describe("the flow plan of a breadboard view", () => {
  it("has an edge for every wire of the view and finds nothing for a view that is not there", () => {
    const plan = breadboardPlan(rc, view.id)!;
    expect(plan.edges.map((e) => e.id)).toEqual(view.wires.map((w) => w.id));
    expect(breadboardPlan(rc, "vw_nope")).toBeNull();
  });

  it("carries the loop current out of the 5 V pin and back to ground, and nothing along a spare rail wire", () => {
    const plan = breadboardPlan(rc, view.id)!;
    const amps = edgeCurrents(plan, LOOP);
    const by = (id: string) => amps[plan.edgeOf.get(id)!]!;
    expect(by("wir_2")).toBeCloseTo(0.006, 9);
    expect(by("wir_5")).toBeCloseTo(0.006, 9);
    expect(by("wir_6")).toBeCloseTo(0.006, 9);
    expect(by("wir_1")).toBeCloseTo(-0.006, 9);
    expect(Math.abs(by("wir_3"))).toBeLessThan(1e-12);
    expect(Math.abs(by("wir_4"))).toBeLessThan(1e-12);
  });

  it("ignores a pin that is not in the plan and what the pins do not balance", () => {
    const plan = breadboardPlan(rc, view.id)!;
    const amps = edgeCurrents(plan, { ...LOOP, nowhere: { X: 1 } });
    expect(amps[plan.edgeOf.get("wir_2")!]).toBeCloseTo(0.006, 9);
  });

  it("gives every edge no current when no pin reports one", () => {
    const plan = breadboardPlan(rc, view.id)!;
    expect(Array.from(edgeCurrents(plan, {})).every((a) => a === 0)).toBe(true);
  });
});
