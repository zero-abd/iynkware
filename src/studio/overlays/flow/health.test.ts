import { describe, expect, it } from "vitest";
import type { Overlay, Scene } from "../../engine/types.ts";
import { healthOverlays, type FlowLabels } from "./health.ts";

const labels = { state: { hot: "hot", reversed: "reversed", burnt: "burnt" } } as unknown as FlowLabels;
const box = { x0: 10, y0: 10, x1: 20, y1: 14 };
const scene = { targets: [{ item: "part:c", hit: { kind: "part", c: "C1" }, bbox: box }, { item: "part:r", hit: { kind: "part", c: "R1" }, bbox: box }, { item: "pin", hit: { kind: "pin", c: "C1", p: "A" }, bbox: box }] } as unknown as Scene;

const textOf = (o: Overlay) => o.elements.find((e) => e.t === "text" && "s" in e)?.s;

describe("healthOverlays", () => {
  it("marks nothing for parts that are fine or that the frame does not mention", () => {
    expect(healthOverlays(scene, { C1: { watts: 0, state: "ok" } }, labels)).toEqual([]);
    expect(healthOverlays(scene, {}, labels)).toEqual([]);
  });

  it("outlines a hot or reversed part and names the state in words", () => {
    const [hot, reversed] = [healthOverlays(scene, { C1: { watts: 1, state: "hot" } }, labels), healthOverlays(scene, { R1: { watts: 1, state: "reversed" } }, labels)];
    expect(hot).toHaveLength(1);
    expect(textOf(hot[0]!)).toBe("hot");
    expect(textOf(reversed[0]!)).toBe("reversed");
    expect(hot[0]!.elements.some((e) => e.t === "path")).toBe(false);
  });

  it("covers a burnt part with a scorch and a cross, and says so", () => {
    const [burnt] = healthOverlays(scene, { C1: { watts: 0, state: "burnt" } }, labels);
    expect(textOf(burnt!)).toBe("burnt");
    expect(burnt!.elements.some((e) => e.t === "path")).toBe(true);
    expect(burnt!.id).toBe("health:C1");
  });
});
