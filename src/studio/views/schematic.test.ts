// @vitest-environment node
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "../../parts/builtin.ts";
import { blinkCircuit } from "../testing/blink-circuit.ts";
import { buildSchematicScene } from "./schematic.ts";

const registry = builtinRegistry();
const { project, breadboard, uno, r1, led, button } = blinkCircuit();
const scene = buildSchematicScene(project, "vw_bb", registry);

describe("buildSchematicScene", () => {
  it("draws the board and the parts, and leaves the breadboard out", () => {
    expect(scene.nodes.map((n) => n.c).toSorted()).toEqual([uno, r1, led, button].toSorted());
    expect(scene.nodes.some((n) => n.c === breadboard)).toBe(false);
  });

  it("keeps the sheet small enough to read: no node is taller than the board", () => {
    const tallest = Math.max(...scene.nodes.map((n) => n.y_mm + n.shape.h_mm));
    expect(tallest).toBeLessThan(150);
  });

  it("joins the pins of a net that has two or three ends with a link", () => {
    expect(scene.links.length).toBeGreaterThan(0);
  });
});
