// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PartInput } from "../../sim/engine.ts";
import type { Scene } from "../engine/types.ts";
import { createPartOperator } from "./operate.ts";

function rig(running = true) {
  const state = {
    simulation: { world: { inputs: [] } },
    components: [
      { id: "ldr", definition: { ref: "core.ldr", version: "1.0.0" }, params: { lux: 300 } },
      { id: "sonar", definition: { ref: "core.hc-sr04", version: "1.0.0" } },
    ],
  };
  const sent: PartInput[] = [];
  const box = (i: number) => ({ x0: i * 30, y0: 0, x1: i * 30 + 10, y1: 10 });
  const scene = { targets: state.components.map((c, i) => ({ item: c.id, hit: { kind: "part", c: c.id }, bbox: box(i) })) } as unknown as Scene;
  const operator = createPartOperator({ doc: { getState: () => ({ state }) } as never, running: () => running, input: (i) => sent.push(i), scene: () => scene });
  return { operator, sent };
}

const labels = (operator: ReturnType<typeof rig>["operator"]) =>
  operator.overlays().flatMap((o) => o.elements.flatMap((e) => (e.t === "text" ? [`${o.id} ${e.s}`] : [])));

describe("sensor dials", () => {
  it("show what each sensor senses while the run goes, from the part's setting or the sensor's default", () => {
    expect(labels(rig().operator)).toEqual(["operate:ldr 300 lux", "operate:sonar 25 cm"]);
    expect(labels(rig(false).operator)).toEqual([]);
  });

  it("move the sensed value as the pointer sweeps round the part, and send it under the part's own setting", () => {
    const { operator, sent } = rig();
    expect(operator.hover({ kind: "part", c: "sonar" }, { x: 35, y: 5 })).toBe("grab");
    operator.down({ kind: "part", c: "sonar" }, { x: 40, y: 5 });
    operator.move({ x: 35, y: 10 });
    operator.move({ x: 30, y: 5 });
    operator.up();
    const last = sent.at(-1)!;
    expect(last.part).toBe("sonar");
    expect(last.param).toBe("distance");
    expect(last.value).toBeGreaterThan(25);
    expect(labels(operator)).toContain(`operate:sonar ${Math.round(last.value * 10) / 10} cm`);
  });
});
