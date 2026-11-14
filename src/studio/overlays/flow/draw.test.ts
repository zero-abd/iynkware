import { describe, expect, it } from "vitest";
import type { Viewport } from "../../engine/types.ts";
import { DOT_SPACING_PX, drawFlow, type Ctx2D } from "./draw.ts";
import type { FlowItem } from "./model.ts";

const view: Viewport = { cx_mm: 50, cy_mm: 5, k: 4, w: 400, h: 100, dpr: 1 };
const style = { paper: "white", ink: "black" };

function fakeCtx() {
  const log: string[] = [];
  const ctx = {
    clearRect: () => log.push("clear"),
    beginPath: () => log.push("begin"),
    moveTo: () => log.push("move"),
    lineTo: () => log.push("line"),
    arc: () => log.push("arc"),
    stroke: () => log.push("stroke"),
    fill: () => log.push("fill"),
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    strokeStyle: "",
    fillStyle: "",
  } as unknown as Ctx2D;
  return { ctx, log };
}

const wire = (over: Partial<FlowItem> = {}): FlowItem => ({ key: "wire:a", xy: Float64Array.of(0, 5, 100, 5), x0: 0, y0: 5, x1: 100, y1: 5, amps: 0.01, colour: "red", ...over });

describe("drawFlow", () => {
  it("puts a dot every spacing along a wire that carries current", () => {
    const { ctx, log } = fakeCtx();
    const { dots, flowing } = drawFlow(ctx, [wire()], view, new Map(), 0, { style, motion: true });
    expect(dots).toBe(log.filter((l) => l === "arc").length);
    expect(dots).toBeGreaterThanOrEqual(Math.floor(400 / DOT_SPACING_PX));
    expect(flowing).toBe(true);
  });

  it("clears each run tag's box last, so the tag shows through the wire and its dots", () => {
    const cleared: number[][] = [];
    const { ctx, log } = fakeCtx();
    ctx.clearRect = (...box: number[]) => {
      cleared.push(box);
      log.push("clear");
    };
    drawFlow(ctx, [wire()], view, new Map(), 0, { style, motion: true, holes: [{ x: 190, y: 40, w: 30, h: 14 }] });
    expect(cleared).toEqual([
      [0, 0, 400, 100],
      [190, 40, 30, 14],
    ]);
    expect(log.at(-1)).toBe("clear");
  });

  it("draws arrowheads and no dots when motion is off", () => {
    const { ctx, log } = fakeCtx();
    const { dots } = drawFlow(ctx, [wire()], view, new Map(), 0, { style, motion: false });
    expect(dots).toBeGreaterThan(0);
    expect(log).not.toContain("arc");
  });

  it("draws the colour of a wire that carries nothing and reports it is not flowing", () => {
    const { ctx, log } = fakeCtx();
    const result = drawFlow(ctx, [wire({ amps: 0 })], view, new Map(), 0, { style, motion: true });
    expect(result).toEqual({ dots: 0, flowing: false });
    expect(log).toContain("line");
  });

  it("leaves out a line with no colour and a wire that is off the view", () => {
    const { ctx, log } = fakeCtx();
    const off = wire({ key: "wire:far", x0: 1000, x1: 1100, xy: Float64Array.of(1000, 5, 1100, 5) });
    const inside = wire({ key: "part:r", colour: null });
    drawFlow(ctx, [off, inside], view, new Map(), 0, { style, motion: true });
    expect(log.filter((l) => l === "line")).toHaveLength(0);
  });

  it("moves a dot row with the current's direction and keeps its place between frames", () => {
    const phases = new Map<string, number>();
    drawFlow(fakeCtx().ctx, [wire()], view, phases, 0, { style, motion: true });
    const start = phases.get("wire:a")!;
    drawFlow(fakeCtx().ctx, [wire()], view, phases, 0.05, { style, motion: true });
    const forward = phases.get("wire:a")!;
    drawFlow(fakeCtx().ctx, [wire({ amps: -0.01 })], view, phases, 0.05, { style, motion: true });
    const back = phases.get("wire:a")!;
    expect(forward).not.toBe(start);
    expect(back).toBeCloseTo(start, 6);
  });
});
