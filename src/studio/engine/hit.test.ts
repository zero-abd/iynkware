// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PIN_SLOP_PX, TOUCH_TARGET_PX } from "./constants.ts";
import { linearIndex } from "./draw-list.ts";
import { GridIndex, pickAt, pickPin, slopFor } from "./hit.ts";
import type { Hit, HitTarget, RectMm, Viewport } from "./types.ts";

function random(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function randomTargets(count: number, next: () => number): HitTarget[] {
  const kinds = ["pin", "hole", "part", "wire", "label", "junction"] as const;
  return Array.from({ length: count }, (_, i): HitTarget => {
    const kind = kinds[Math.floor(next() * kinds.length)]!;
    const x0 = next() * 1000 - 200;
    const y0 = next() * 1000 - 200;
    const long = kind === "wire" && next() < 0.2;
    const w = long ? 600 + next() * 3000 : kind === "part" ? 5 + next() * 40 : 1 + next();
    const h = kind === "part" ? 5 + next() * 40 : 1 + next();
    const hit: Hit =
      kind === "pin" ? { kind, c: `cmp_${i}`, p: "1" }
      : kind === "hole" ? { kind, surface: `cmp_${i}`, hole: "a1" }
      : kind === "part" ? { kind, c: `cmp_${i}` }
      : kind === "wire" ? { kind, id: `wir_${i}`, segment: 0 }
      : { kind, id: `x_${i}` };
    return { item: `item_${i % 150}`, hit, bbox: { x0, y0, x1: x0 + w, y1: y0 + h } };
  });
}

const sorted = (ids: readonly string[]) => [...ids].sort();

describe("picking among pins closer together than the slop", () => {
  const pin = (p: string, x: number): HitTarget => ({ item: "cmp_a", hit: { kind: "pin", c: "cmp_a", p }, bbox: { x0: x - 0.5, y0: -0.5, x1: x + 0.5, y1: 0.5 } });
  const targets = [pin("1", 0), pin("2", 2.54), pin("3", 5.08)];

  it.each([
    ["linear", linearIndex(targets)],
    ["grid", new GridIndex(targets)],
  ])("goes to the pin the pointer is nearest, in the %s index", (_name, index) => {
    expect(index.pick({ x: 2.4, y: 0 }, 3)).toMatchObject({ p: "2" });
    expect(index.pick({ x: 0.6, y: 0 }, 3)).toMatchObject({ p: "1" });
    expect(index.pick({ x: 4.4, y: 0.3 }, 3)).toMatchObject({ p: "3" });
  });
});

describe("picking between a pin and the holes round it", () => {
  const box = (x: number, y: number) => ({ x0: x - 0.5, y0: y - 0.5, x1: x + 0.5, y1: y + 0.5 });
  const targets: HitTarget[] = [
    { item: "bb", hit: { kind: "hole", surface: "bb", hole: "a10" }, bbox: box(0, 0) },
    { item: "bb", hit: { kind: "hole", surface: "bb", hole: "b10" }, bbox: box(0, 2.54) },
    { item: "r1", hit: { kind: "pin", c: "r1", p: "P1" }, bbox: box(0, 2.54) },
  ];

  it.each([
    ["linear", linearIndex(targets)],
    ["grid", new GridIndex(targets)],
  ])("goes to the hole pointed at, not the pin one pitch away, and to the pin that sits in its hole, in the %s index", (_name, index) => {
    expect(index.pick({ x: 0, y: 0 }, 3.4)).toMatchObject({ kind: "hole", hole: "a10" });
    expect(index.pick({ x: 0, y: 2.54 }, 3.4)).toMatchObject({ kind: "pin", p: "P1" });
  });
});

describe("GridIndex", () => {
  it("answers pick and query like the linear index on 2,000 random queries", () => {
    const next = random(7);
    const targets = randomTargets(1500, next);
    const grid = new GridIndex(targets);
    const linear = linearIndex(targets);
    for (let i = 0; i < 2000; i++) {
      const p = { x: next() * 1200 - 300, y: next() * 1200 - 300 };
      const slop = next() * 30;
      expect(grid.pick(p, slop)).toEqual(linear.pick(p, slop));
      const rect: RectMm = { x0: p.x, y0: p.y, x1: p.x + next() * 300, y1: p.y + next() * 300 };
      expect(sorted(grid.query(rect))).toEqual(sorted(linear.query(rect)));
    }
  });

  it("matches the linear index after update swaps the targets of some items", () => {
    const next = random(11);
    const targets = randomTargets(600, next);
    const grid = new GridIndex(targets);
    const moved = ["item_3", "item_40", "item_99"];
    const fresh = randomTargets(40, next).map((t, i) => ({ ...t, item: moved[i % moved.length]! }));
    grid.update(moved, fresh);
    const linear = linearIndex([...targets.filter((t) => !moved.includes(t.item)), ...fresh]);
    for (let i = 0; i < 500; i++) {
      const p = { x: next() * 1200 - 300, y: next() * 1200 - 300 };
      expect(grid.pick(p, 6)).toEqual(linear.pick(p, 6));
      const rect: RectMm = { x0: p.x, y0: p.y, x1: p.x + 80, y1: p.y + 80 };
      expect(sorted(grid.query(rect))).toEqual(sorted(linear.query(rect)));
    }
  });

  it("forgets targets of removed items and takes a rebuild", () => {
    const part: HitTarget = { item: "cmp_1", hit: { kind: "part", c: "cmp_1" }, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } };
    const grid = new GridIndex([part]);
    grid.update(["cmp_1"], []);
    expect(grid.pick({ x: 5, y: 5 }, 1)).toBeNull();
    grid.rebuild([part]);
    expect(grid.pick({ x: 5, y: 5 }, 1)).toEqual(part.hit);
  });

  it("finds targets across cell borders and at negative coordinates", () => {
    const target: HitTarget = { item: "a", hit: { kind: "label", id: "a" }, bbox: { x0: -51, y0: -51, x1: -49, y1: -49 } };
    const grid = new GridIndex([target]);
    expect(grid.pick({ x: -50, y: -50 }, 0)).toEqual(target.hit);
    expect(grid.pick({ x: -60, y: -50 }, 0)).toBeNull();
  });

  it("ranks pins over bodies and the smaller of two equals", () => {
    const body: HitTarget = { item: "cmp_1", hit: { kind: "part", c: "cmp_1" }, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } };
    const pin: HitTarget = { item: "cmp_1", hit: { kind: "pin", c: "cmp_1", p: "1" }, bbox: { x0: 9, y0: 4, x1: 10, y1: 5 } };
    const grid = new GridIndex([body, pin]);
    expect(grid.pick({ x: 9.5, y: 4.5 }, 0)).toEqual(pin.hit);
    expect(grid.pick({ x: 2, y: 2 }, 0)).toEqual(body.hit);
  });
});

describe("pickAt", () => {
  const V: Viewport = { cx_mm: 0, cy_mm: 0, k: 2, w: 400, h: 400, dpr: 1 };
  const pin: HitTarget = { item: "cmp_1", hit: { kind: "pin", c: "cmp_1", p: "1" }, bbox: { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 } };
  const body: HitTarget = { item: "cmp_1", hit: { kind: "part", c: "cmp_1" }, bbox: { x0: -10, y0: -10, x1: 10, y1: 10 } };
  const wire: HitTarget = { item: "wir_1", hit: { kind: "wire", id: "wir_1", segment: 0 }, bbox: { x0: 30, y0: 0, x1: 60, y1: 0 } };
  const index = new GridIndex([body, pin, wire]);
  const centre = { x: 200, y: 200 };

  it("picks the pin 12 px away at any zoom", () => {
    for (const k of [0.5, 2, 10, 40]) {
      const v = { ...V, k };
      const hit = pickAt(index, v, centre.x + PIN_SLOP_PX + 0.5 * k - 0.01, centre.y, PIN_SLOP_PX);
      expect(hit).toEqual(pin.hit);
    }
  });

  it("misses a pin beyond the slop and falls back to the body", () => {
    expect(pickAt(index, V, centre.x + PIN_SLOP_PX + 3, centre.y, PIN_SLOP_PX)).toEqual(body.hit);
  });

  it("gives touch a 24 px reach", () => {
    expect(slopFor("touch")).toBe(TOUCH_TARGET_PX);
    expect(slopFor("pen")).toBe(PIN_SLOP_PX);
    const at = centre.x + 20 + 0.5 * V.k;
    expect(pickAt(index, V, at, centre.y, slopFor("mouse"))).toEqual(body.hit);
    expect(pickAt(index, V, at, centre.y, slopFor("touch"))).toEqual(pin.hit);
  });

  it("gives a finger the part under it over a hole of the board beneath", () => {
    const hole: HitTarget = { item: "bb", hit: { kind: "hole", surface: "bb", hole: "a1" }, bbox: { x0: 3, y0: -0.5, x1: 4, y1: 0.5 } };
    const board: HitTarget = { item: "bb", hit: { kind: "part", c: "bb" }, bbox: { x0: -100, y0: -100, x1: 100, y1: 100 } };
    const grid = new GridIndex([board, hole, body]);
    const at = { x: 200 + 5 * V.k, y: 200 };
    expect(pickAt(grid, V, at.x, at.y, slopFor("touch"))).toEqual(hole.hit);
    expect(pickAt(grid, V, at.x, at.y, slopFor("touch"), true)).toEqual(body.hit);
    const inside = { x: 200 + 3.5 * V.k, y: 200 };
    expect(pickAt(grid, V, inside.x, inside.y, slopFor("touch"), true)).toEqual(body.hit);
    const bare = { x: 200 + 50 * V.k, y: 200 };
    expect(pickAt(new GridIndex([board, { ...hole, bbox: { x0: 49, y0: -1, x1: 51, y1: 1 } }]), V, bare.x, bare.y, slopFor("touch"), true)).toEqual(hole.hit);
  });

  it("finds a wire only within the wire slop", () => {
    const y = 200;
    expect(pickAt(index, V, 200 + 40 * V.k, y + 5, PIN_SLOP_PX)).toEqual(wire.hit);
    expect(pickAt(index, V, 200 + 40 * V.k, y + 9, PIN_SLOP_PX)).toBeNull();
  });

  it("pickPin ignores bodies", () => {
    expect(pickPin(index, { x: 5, y: 5 }, 1)).toBeNull();
    expect(pickPin(index, { x: 0, y: 0 }, 1)).toEqual(pin.hit);
  });
});
