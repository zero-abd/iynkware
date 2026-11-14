import type { Scene } from "../../engine/types.ts";
import type { FlowPlan } from "./plan.ts";

/** A wire or link as a polyline in sheet millimetres, x and y alternating. */
export interface Stroke {
  edge: number;
  xy: Float64Array;
  /** Where it lies, for a quick test against the view. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type PinSpots = ReadonlyMap<string, { x: number; y: number }>;

const NUMBER = /-?\d*\.?\d+(?:e[+-]?\d+)?/gi;

/** The points of a path made of `M` and `L` only, which is all a wire or a link is. */
function pointsOf(d: string): Float64Array {
  return Float64Array.from(d.match(NUMBER) ?? [], Number);
}

/** The strokes of the wires and links of `plan` that `scene` draws; culled ones are not in the scene. */
export function strokesOf(scene: Scene, plan: FlowPlan): Stroke[] {
  const strokes: Stroke[] = [];
  for (const item of scene.items) {
    if (item.kind !== "wire") continue;
    const edge = plan.edgeOf.get(item.id);
    const path = item.elements[0];
    if (edge === undefined || path?.t !== "path") continue;
    const xy = pointsOf(path.d);
    if (xy.length >= 4) strokes.push({ edge, xy, x0: item.bbox.x0, y0: item.bbox.y0, x1: item.bbox.x1, y1: item.bbox.y1 });
  }
  return strokes;
}

/** The centre of every part pin the scene has a target for, by `part/pin`. */
export function pinSpotsOf(scene: Scene): PinSpots {
  const spots = new Map<string, { x: number; y: number }>();
  for (const { hit, bbox } of scene.targets) {
    if (hit.kind === "pin") spots.set(`${hit.c}/${hit.p}`, { x: (bbox.x0 + bbox.x1) / 2, y: (bbox.y0 + bbox.y1) / 2 });
  }
  return spots;
}
