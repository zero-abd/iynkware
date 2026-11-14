// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Project } from "../../project/generated/types.ts";
import { resolvePart } from "../parts-view.ts";
import { blinkCircuit } from "../testing/blink-circuit.ts";
import { buildDrawList } from "./draw-list.ts";
import type { DrawList } from "./types.ts";
import { stubArt } from "./testing/mini-scene.ts";
import type { Viewport } from "./types.ts";

const VIEW: Viewport = { cx_mm: 0, cy_mm: 30, k: 5, w: 1000, h: 600, dpr: 1 };

const build = (state: Project, viewport: Viewport = VIEW) =>
  buildDrawList({ state, viewId: "vw_bb", viewport, art: stubArt, resolve: (ref) => resolvePart(state, ref), index: null, prev: null, mode: "illustrated", overlays: [] }).scene;

/** What a template or a lesson stores: a part with legs sits at 0, 0 and its legs say where it is. */
function unplaced(state: Project): Project {
  return {
    ...state,
    views: state.views.map((v) => ({ ...v, placements: v.placements.map((p) => (p.legs ? { ...p, x_mm: 0, y_mm: 0 } : p)) })),
  };
}

describe("the breadboard view of a seated circuit", () => {
  const { project, uno, breadboard, led, r1 } = blinkCircuit();

  it("draws the board next to the breadboard and every wire", () => {
    const scene = build(project);
    expect(scene.items.find((i) => i.id === uno)).toMatchObject({ kind: "part", xMm: -80, yMm: 0 });
    expect(scene.items.filter((i) => i.kind === "wire")).toHaveLength(6);
    expect(scene.stats.dropped).toBe(0);
  });

  it("puts a part with legs where its legs are, whatever x and y it stores", () => {
    const stored = build(project);
    const derived = build(unplaced(project));
    for (const c of [led, r1]) {
      expect(derived.items.find((i) => i.id === c)?.bbox).toEqual(stored.items.find((i) => i.id === c)?.bbox);
    }
  });

  it("hits a leg at its hole", () => {
    const scene = build(unplaced(project));
    const leg = scene.targets.find((t) => t.hit.kind === "pin" && t.hit.c === led && t.hit.p === "A")!;
    const hole = scene.targets.find((t) => t.hit.kind === "hole" && t.hit.surface === breadboard && t.hit.hole === "b11")!;
    expect(leg.bbox).toEqual(hole.bbox);
  });

  it("draws a dot for every hole once they are 4 px apart, and none before", () => {
    const dots = (k: number) => build(project, { ...VIEW, k }).items.find((i) => i.id === breadboard)!.elements.filter((e) => e.t === "circle").length;
    expect(dots(5)).toBe(400);
    expect(dots(1.8)).toBe(400);
    expect(dots(1.5)).toBe(0);
  });
});

describe("a view that follows another", () => {
  it("removes what the last view drew and the new one does not, even under an id both use", () => {
    const { project, led } = blinkCircuit();
    const first = build(project);
    const fixed: DrawList = {
      items: [{ id: led, kind: "part", z: 10, lod: 2, xMm: 0, yMm: 0, rotation: 0, bbox: { x0: 0, y0: 0, x1: 5, y1: 5 }, elements: [], title: "D1" }],
      targets: [],
    };
    const { scene, diff } = buildDrawList({
      state: { ...project, views: [...project.views, { id: "vw_sch", kind: "schematic", name: "Schematic", placements: [], wires: [] }] },
      viewId: "vw_sch",
      viewport: VIEW,
      art: stubArt,
      resolve: () => ({ widthMm: 1, heightMm: 1, pins: [], known: true }),
      index: null,
      prev: first,
      mode: "illustrated",
      overlays: [],
      fixed,
    });
    expect(scene.items.map((i) => i.id)).toEqual([led]);
    expect(diff.added).toEqual([led]);
    expect(diff.removed.toSorted()).toEqual(first.items.map((i) => i.id).filter((id) => id !== led).toSorted());
  });
});
