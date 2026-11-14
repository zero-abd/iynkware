import type { EntityId, EntityPrefix } from "../../core/ids.ts";
import type { Op, Project as ProjectState } from "../../project/generated/types.ts";
import type { Descriptor } from "../../parts/descriptor.ts";
import { interfaceOf } from "../../parts/pins.ts";
import type { PartRegistry } from "../../parts/registry.ts";
import type { PointMm, ResolvedPartShape, Rotation } from "../engine/types.ts";
import { resolvePart } from "../parts-view.ts";

export const BREADBOARD_REF = "core.breadboard-half";
const BREADBOARD_VIEW = "vw_bb";
const BREADBOARD_REFDES = "BB1";
const BOARD_GAP_MM = 10;
const BOARD_STACK_MM = 100;
const HOLE_PITCH_MM = 2.54;
const EPS = 1e-6;

/** A hole in the surface frame: origin top-left, x right, y down, like the art. */
export type HoleGeom = { hole: string; xMm: number; yMm: number; strip: string };

/** The holes of a surface bucketed by grid cell, which is all that finding the hole under a point needs. */
export type HoleGrid = {
  holes: readonly Pick<HoleGeom, "hole" | "xMm" | "yMm">[];
  cells: ReadonlyMap<string, readonly Pick<HoleGeom, "hole" | "xMm" | "yMm">[]>;
};

export type SurfaceGeom = HoleGrid & {
  widthMm: number;
  heightMm: number;
  holes: readonly HoleGeom[];
  byName: ReadonlyMap<string, HoleGeom>;
  strips: ReadonlyMap<string, readonly HoleGeom[]>;
  cells: ReadonlyMap<string, readonly HoleGeom[]>;
};

const grids = new WeakMap<ResolvedPartShape, HoleGrid>();

/** The holes of a surface as the canvas draws them: every pin of its shape that is not mechanical, in the y-down frame of the art. */
export function holeGridOf(shape: ResolvedPartShape): HoleGrid {
  let grid = grids.get(shape);
  if (!grid) {
    const holes = shape.pins.filter((p) => !p.mechanical).map((p) => ({ hole: p.id, xMm: p.xMm, yMm: p.yMm }));
    const cells = new Map<string, (typeof holes)[number][]>();
    for (const h of holes) {
      const key = cellKey(cellOf(h.xMm), cellOf(h.yMm));
      const inCell = cells.get(key);
      if (inCell) inCell.push(h);
      else cells.set(key, [h]);
    }
    grids.set(shape, (grid = { holes, cells }));
  }
  return grid;
}

export type IdSource = <P extends EntityPrefix>(prefix: P) => EntityId<P>;

const cellKey = (cx: number, cy: number): string => `${cx},${cy}`;
const cellOf = (v: number): number => Math.floor(v / HOLE_PITCH_MM);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The holes of a surface part. A descriptor stores pin positions bottom-left with +y up; this module flips them to
 * the y-down frame of the art, so a hole drawn at `xMm`, `yMm` is the one a pointer lands on.
 */
export function holesOf(desc: Descriptor): HoleGeom[] {
  const height = desc.dimensions?.body?.h ?? 0;
  const stripOfPin = new Map<string, string>();
  for (const g of desc.groups ?? []) {
    if (g.kind !== "strip") continue;
    for (const p of g.pins) stripOfPin.set(p, g.id);
  }
  const holes: HoleGeom[] = [];
  for (const pin of desc.pins) {
    const strip = stripOfPin.get(pin.id);
    if (!pin.position || strip === undefined) continue;
    holes.push({ hole: pin.id, xMm: pin.position.x, yMm: round2(height - pin.position.y), strip });
  }
  return holes;
}

export function surfaceGeom(desc: Descriptor): SurfaceGeom {
  const holes = holesOf(desc);
  const byName = new Map<string, HoleGeom>();
  const strips = new Map<string, HoleGeom[]>();
  const cells = new Map<string, HoleGeom[]>();
  for (const h of holes) {
    byName.set(h.hole, h);
    const inStrip = strips.get(h.strip);
    if (inStrip) inStrip.push(h);
    else strips.set(h.strip, [h]);
    const key = cellKey(cellOf(h.xMm), cellOf(h.yMm));
    const inCell = cells.get(key);
    if (inCell) inCell.push(h);
    else cells.set(key, [h]);
  }
  return { widthMm: desc.dimensions?.body?.w ?? 0, heightMm: desc.dimensions?.body?.h ?? 0, holes, byName, strips, cells };
}

/** The hole nearest to `p` (surface frame) within `maxMm`, or null. Looks at the few cells around `p`, so it does not grow with the hole count. */
export function holeAt(surface: Pick<HoleGrid, "cells">, p: PointMm, maxMm: number): string | null {
  const reach = Math.ceil(maxMm / HOLE_PITCH_MM);
  const cx = cellOf(p.x);
  const cy = cellOf(p.y);
  let best: HoleGrid["holes"][number] | null = null;
  let bestDistance = maxMm + EPS;
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      for (const h of surface.cells.get(cellKey(cx + dx, cy + dy)) ?? []) {
        const d = Math.hypot(h.xMm - p.x, h.yMm - p.y);
        if (d < bestDistance) {
          best = h;
          bestDistance = d;
        }
      }
    }
  }
  return best?.hole ?? null;
}

export function stripOf(surface: SurfaceGeom, hole: string): string {
  const geom = surface.byName.get(hole);
  if (!geom) throw new RangeError(`no hole ${hole} on this surface`);
  return geom.strip;
}

/** The other holes of the strip the hole is in, in descriptor order. An unknown hole has none. */
export function stripPeers(surface: SurfaceGeom, hole: string): string[] {
  const geom = surface.byName.get(hole);
  if (!geom) return [];
  return (surface.strips.get(geom.strip) ?? []).filter((h) => h.hole !== hole).map((h) => h.hole);
}

/** Counter-clockwise in a y-down frame, like the art. */
export function turn(p: PointMm, rotation: Rotation): PointMm {
  switch (rotation) {
    case 90:
      return { x: p.y, y: -p.x };
    case 180:
      return { x: -p.x, y: -p.y };
    case 270:
      return { x: -p.y, y: p.x };
    default:
      return p;
  }
}

/**
 * The hole under each leg when the part sits at `origin` (surface frame) turned by `rotation`, or null when a leg is
 * more than half a pitch from a hole or two legs land in one hole.
 */
export function legsFit(
  surface: Pick<HoleGrid, "cells">,
  legOffsetsMm: Record<string, PointMm>,
  origin: PointMm,
  rotation: Rotation,
): Record<string, string> | null {
  const fit: Record<string, string> = {};
  const taken = new Set<string>();
  for (const [leg, offset] of Object.entries(legOffsetsMm)) {
    const turned = turn(offset, rotation);
    const hole = holeAt(surface, { x: origin.x + turned.x, y: origin.y + turned.y }, HOLE_PITCH_MM / 2);
    if (hole === null || taken.has(hole)) return null;
    taken.add(hole);
    fit[leg] = hole;
  }
  return fit;
}

/**
 * Where a part with legs sits: its first leg that lands in a known hole goes there, so the part origin is that hole less
 * the leg's offset in the part turned by `rotation`. Null when no leg lands in a hole of the surface.
 */
export function seatedAt(
  shape: ResolvedPartShape,
  rotation: Rotation,
  legs: Record<string, string | undefined>,
  holes: ReadonlyMap<string, { xMm: number; yMm: number }>,
  surfaceAt: PointMm,
): PointMm | null {
  for (const pin of shape.pins) {
    const hole = holes.get(legs[pin.id] ?? "");
    if (!hole || pin.mechanical) continue;
    const turned = turn({ x: pin.xMm, y: pin.yMm }, rotation);
    return { x: round2(surfaceAt.x + hole.xMm - turned.x), y: round2(surfaceAt.y + hole.yMm - turned.y) };
  }
  return null;
}

/**
 * The one place that adds a breadboard to a project: pins the part's interface, adds it as BB1, makes it the surface
 * of the breadboard view and places it at `at`.
 */
export function breadboardBatch(registry: PartRegistry, ids: IdSource, at: PointMm, view = BREADBOARD_VIEW): { batch: Op[]; component: string } {
  const desc = registry.latest(BREADBOARD_REF);
  if (!desc) throw new Error(`${BREADBOARD_REF} is not in the registry`);
  const component = ids("cmp");
  const batch: Op[] = [
    { k: "dep.set", dependency: { ref: desc.id, version: desc.version, origin: "builtin", interface: interfaceOf(desc) } },
    { k: "component.add", component: { id: component, definition: { ref: desc.id, version: desc.version }, refdes: BREADBOARD_REFDES } },
    { k: "view.set", id: view, surface: component },
    { k: "view.place", view, placement: { c: component, x_mm: at.x, y_mm: at.y } },
  ];
  return { batch, component };
}

const unused = (taken: ReadonlySet<string>, base: string): string => {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}${n}`;
  return id;
};

/**
 * A document with no breadboard view gets one, laid out like a new project: the board where its board view has it and
 * a half breadboard to its right. Most Board lab lessons ship with only a board view, which takes no parts.
 */
export function ensureBreadboardView(state: ProjectState, registry: PartRegistry): Op[] {
  if (state.views.some((v) => v.kind === "breadboard")) return [];
  const view = unused(new Set(state.views.map((v) => v.id)), BREADBOARD_VIEW);
  const shown = state.views.find((v) => v.kind === "board")?.placements ?? [];
  let right = 0;
  const placements = state.boards.map((board, i) => {
    const at = shown.find((p) => p.c === board.id) ?? { c: board.id, x_mm: 0, y_mm: i * BOARD_STACK_MM };
    right = Math.max(right, at.x_mm + resolvePart(state, board.definition.ref, registry).widthMm);
    return { ...at };
  });
  const ops: Op[] = [{ k: "view.add", view: { id: view, kind: "breadboard", name: "Breadboard", placements, wires: [] } }];
  if (!registry.latest(BREADBOARD_REF) || state.components.some((c) => c.refdes === BREADBOARD_REFDES)) return ops;
  const component = unused(new Set(state.components.map((c) => c.id)), "cmp_bb") as EntityId<"cmp">;
  const ids = (() => component) as IdSource;
  return [...ops, ...breadboardBatch(registry, ids, { x: round2(right + BOARD_GAP_MM), y: 0 }, view).batch];
}
