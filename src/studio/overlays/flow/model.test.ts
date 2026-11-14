// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Project } from "../../../project/generated/types.ts";
import type { AnalogView } from "../../run/analog.ts";
import { emptyAnalog } from "../../run/analog.ts";
import type { Stroke } from "./geometry.ts";
import { flowItems } from "./model.ts";
import { breadboardPlan } from "./plan.ts";
import { rampColour, rampStep } from "./scale.ts";

const rc = JSON.parse(readFileSync(join(__dirname, "../../starters/rc-led.project.json"), "utf8")) as Project;
const view = rc.views.find((v) => v.kind === "breadboard")!;
const plan = breadboardPlan(rc, view.id)!;
const tokens = { warm: "red", cool: "blue", zero: "grey" };
const strokes: Stroke[] = plan.edges.map((_, edge) => ({ edge, xy: Float64Array.of(0, edge, 10, edge), x0: 0, y0: edge, x1: 10, y1: edge }));
const spots = new Map([
  ["cmp_r1/P1", { x: 0, y: 20 }],
  ["cmp_r1/P2", { x: 5, y: 20 }],
]);

const frame = (over: Partial<AnalogView>): AnalogView => ({ ...emptyAnalog(), ...over });

describe("the items of one frame", () => {
  it("colours each wire by the voltage of its net and gives it the current the plan finds", () => {
    const a = frame({
      volts: { "n:brd_uno/ICSP1_2": 5, "n:brd_uno/GND": 0 },
      pinAmps: { brd_uno: { P5V: -0.006, GND: 0.006 }, cmp_r1: { P1: 0.006, P2: -0.006 } },
    });
    const items = flowItems(plan, strokes, spots, a, 5, tokens);
    const wire = (id: string) => items.find((i) => i.key === `wire:${id}`)!;
    expect(wire("wir_2").colour).toBe(rampColour(rampStep(5, 5), tokens));
    expect(wire("wir_1").colour).toBe(rampColour(0, tokens));
    expect(wire("wir_2").amps).toBeCloseTo(0.006, 9);
  });

  it("draws a wire the frame has no voltage for in the zero colour", () => {
    const items = flowItems(plan, strokes, spots, frame({}), 5, tokens);
    expect(items.every((i) => i.colour === "grey")).toBe(true);
  });

  it("counts a current under the smallest as none", () => {
    const a = frame({ pinAmps: { brd_uno: { P5V: -1e-9, GND: 1e-9 } } });
    expect(flowItems(plan, strokes, spots, a, 5, tokens).every((i) => i.amps === 0)).toBe(true);
  });

  it("adds a line through each two pin part, uncoloured, running from its first pin to its second", () => {
    const a = frame({ pinAmps: { cmp_r1: { P1: 0.002, P2: -0.002 } } });
    const inside = flowItems(plan, strokes, spots, a, 5, tokens).find((i) => i.key === "part:cmp_r1")!;
    expect(inside.colour).toBeNull();
    expect(Array.from(inside.xy)).toEqual([0, 20, 5, 20]);
    expect(inside.amps).toBe(0.002);
  });
});
