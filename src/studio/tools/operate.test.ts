// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PartInput } from "../../sim/engine.ts";
import type { Hit, Scene } from "../engine/types.ts";
import { createPartOperator } from "./operate.ts";

const IDS = ["btn", "sw", "pot", "res", "tied"];
const box = (c: string) => ({ x0: IDS.indexOf(c) * 30, y0: 10, x1: IDS.indexOf(c) * 30 + 10, y1: 20 });
const at = (c: string) => ({ x: IDS.indexOf(c) * 30 + 5, y: 15 });
const part = (c: string): Hit => ({ kind: "part", c });
const HOLE: Hit = { kind: "hole", surface: "bb", hole: "a1" };

function rig(running = true) {
  const state = {
    simulation: { world: { inputs: [{ id: "knob", component: "tied", min: 0, max: 1023, default: 512 }] } },
    components: [
      { id: "tied", definition: { ref: "core.potentiometer-10k", version: "1.0.0" } },
      { id: "btn", definition: { ref: "core.push-button-6mm", version: "1.0.0" } },
      { id: "sw", definition: { ref: "core.slide-switch", version: "1.0.0" } },
      { id: "pot", definition: { ref: "core.potentiometer-10k", version: "1.0.0" }, params: { pos: 0.25 } },
      { id: "res", definition: { ref: "core.resistor", version: "1.0.0" } },
    ],
  };
  const sent: PartInput[] = [];
  const live = { running };
  const scene = { targets: IDS.map((c) => ({ item: c, hit: part(c), bbox: box(c) })) } as unknown as Scene;
  const operator = createPartOperator({ doc: { getState: () => ({ state }) } as never, running: () => live.running, input: (i) => sent.push(i), scene: () => scene });
  return { operator, sent, live };
}

describe("createPartOperator", () => {
  it("presses a button while the pointer is down and lets go when it is released", () => {
    const { operator, sent } = rig();
    expect(operator.down(part("btn"), at("btn"))).toBe(true);
    expect(sent).toEqual([{ part: "btn", param: "pressed", value: 1 }]);
    expect(operator.overlays().map((o) => o.id)).toEqual(["operate:btn"]);
    operator.up();
    expect(sent.at(-1)).toEqual({ part: "btn", param: "pressed", value: 0 });
    expect(operator.overlays()).toEqual([]);
  });

  it("finds the part under the point when a breadboard hole took the hit", () => {
    const { operator, sent } = rig();
    expect(operator.hover(HOLE, at("btn"))).toBe("pointer");
    expect(operator.down(HOLE, at("btn"))).toBe(true);
    expect(sent).toHaveLength(1);
    expect(operator.hover(HOLE, { x: 200, y: 200 })).toBeNull();
  });

  it("works a button from one of its pins", () => {
    const { operator, sent } = rig();
    expect(operator.down({ kind: "pin", c: "btn", p: "P1" }, at("btn"))).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("flips a slide switch on each click and says which end it is on", () => {
    const { operator, sent } = rig();
    operator.down(part("sw"), at("sw"));
    operator.up();
    operator.down(part("sw"), at("sw"));
    operator.up();
    expect(sent.map((i) => i.value)).toEqual([1, 0]);
    expect(sent.every((i) => i.param === "closed")).toBe(true);
    operator.down(part("sw"), at("sw"));
    const label = operator.overlays()[0]!.elements.find((e) => e.t === "text");
    expect(label).toMatchObject({ s: "B" });
  });

  it("turns a pot by the angle the pointer sweeps round its body, a little at a time, from where it stood", () => {
    const { operator, sent } = rig();
    const c = at("pot");
    const quarter = Math.PI / 2 / ((270 * Math.PI) / 180);
    const around = (from: number, to: number, steps: number) => {
      for (let i = 1; i <= steps; i++) {
        const a = from + ((to - from) * i) / steps;
        operator.move({ x: c.x + 5 * Math.cos(a), y: c.y + 5 * Math.sin(a) });
      }
    };
    operator.down(part("pot"), { x: c.x + 5, y: c.y });
    expect(sent).toEqual([]);
    around(0, Math.PI / 2, 9);
    expect(sent.at(-1)!.param).toBe("pos");
    expect(sent.at(-1)!.value).toBeCloseTo(0.25 + quarter, 6);
    around(Math.PI / 2, -Math.PI / 2, 18);
    expect(sent.at(-1)!.value).toBe(0);
    around(-Math.PI / 2, Math.PI, 18);
    expect(sent.at(-1)!.value).toBeCloseTo(3 * quarter, 6);
    around(Math.PI, 5 * Math.PI, 80);
    expect(sent.at(-1)!.value).toBe(1);
    expect(sent.every((i) => i.value >= 0 && i.value <= 1)).toBe(true);
    expect(operator.overlays()[0]!.elements.find((e) => e.t === "text")).toMatchObject({ s: "100%" });
  });

  it("starts a pot where the lesson's input for it starts", () => {
    const { operator, sent } = rig();
    const c = at("tied");
    operator.down(part("tied"), { x: c.x + 5, y: c.y });
    operator.move({ x: c.x + 5 * Math.cos(0.4), y: c.y + 5 * Math.sin(0.4) });
    expect(sent.at(-1)!.value).toBeCloseTo(512 / 1023 + 0.4 / ((270 * Math.PI) / 180), 6);
  });

  it("ignores parts that have no control and does nothing when the run is not going", () => {
    const { operator, sent, live } = rig();
    expect(operator.down(part("res"), at("res"))).toBe(false);
    expect(operator.down(null, { x: 200, y: 200 })).toBe(false);
    live.running = false;
    expect(operator.down(part("btn"), at("btn"))).toBe(false);
    expect(operator.hover(part("btn"), at("btn"))).toBeNull();
    expect(sent).toEqual([]);
  });

  it("shows what the pointer would do: a pointer over buttons and switches, a hand over a pot, a ring on hover", () => {
    const { operator } = rig();
    const wake = vi.fn();
    operator.subscribe(wake);
    expect(operator.hover(part("btn"), at("btn"))).toBe("pointer");
    expect(operator.hover(part("sw"), at("sw"))).toBe("pointer");
    expect(operator.hover(part("pot"), at("pot"))).toBe("grab");
    expect(operator.hover(part("res"), at("res"))).toBeNull();
    expect(wake).toHaveBeenCalled();
    operator.hover(part("btn"), at("btn"));
    expect(operator.overlays().map((o) => o.id)).toEqual(["operate:btn"]);
    operator.hover(null, { x: 200, y: 200 });
    expect(operator.overlays()).toEqual([]);
  });

  it("forgets the values when the run ends, so the next run starts from the document", () => {
    const { operator, sent, live } = rig();
    const c = at("pot");
    operator.down(part("pot"), { x: c.x + 5, y: c.y });
    operator.move({ x: c.x + 5 * Math.cos(0.5), y: c.y + 5 * Math.sin(0.5) });
    operator.up();
    expect(operator.overlays()).toHaveLength(1);
    live.running = false;
    operator.hover(null, { x: 200, y: 200 });
    expect(operator.overlays()).toEqual([]);
    live.running = true;
    operator.down(part("pot"), { x: c.x + 5, y: c.y });
    operator.move({ x: c.x + 5 * Math.cos(0.5), y: c.y + 5 * Math.sin(0.5) });
    expect(sent.at(-1)!.value).toBeCloseTo(sent[0]!.value, 9);
  });
});
