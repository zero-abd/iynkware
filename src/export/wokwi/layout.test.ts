// @vitest-environment node
import { describe, expect, it } from "vitest";
import { spreadApart, type Box } from "./layout.ts";

const box = (id: string, x: number, y: number, w = 6, h = 6): Box => ({ id, x, y, w, h });
const UNO = box("uno", 0, 0, 68.58, 53.34);

const clear = (a: Box, b: Box) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

describe("spreadApart", () => {
  it("leaves parts that are already apart where they are", () => {
    const parts = [box("led", 80, 10), box("res", 95, 10)];
    expect([...spreadApart([UNO], parts)]).toEqual([["led", { x: 80, y: 10 }], ["res", { x: 95, y: 10 }]]);
  });

  it("moves a part lying on the board out beside it", () => {
    const moved = spreadApart([UNO], [box("btn", 53, 5)]).get("btn")!;
    expect(clear({ ...box("btn", 0, 0), ...moved }, UNO)).toBe(true);
  });

  it("gives every part of a pile a spot of its own, in the same places each time", () => {
    const pile = ["a", "b", "c", "d", "e"].map((id) => box(id, 40, 20));
    const first = spreadApart([UNO], pile);
    const placed = pile.map((p) => ({ ...p, ...first.get(p.id)! }));
    for (const p of placed) {
      expect(clear(p, UNO)).toBe(true);
      for (const q of placed) if (p !== q) expect(clear(p, q)).toBe(true);
    }
    expect([...spreadApart([UNO], [...pile].reverse())]).toEqual([...first]);
  });
});
