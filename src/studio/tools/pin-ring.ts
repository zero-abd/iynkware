import { PIN_RADIUS_MM } from "../engine/constants.ts";
import type { ArtElement, Hit, Overlay, PointMm, Scene } from "../engine/types.ts";
import type { WireEndRef } from "../rules/connect.ts";

export const RING_MM = PIN_RADIUS_MM + 0.6;
const RING_SW = 0.4;
const TAG_SIZE_MM = 2;
const TAG_OFFSET_MM = 1.2;
export const INK = "var(--studio-ink)";
export const WARN = "var(--studio-warn)";

/** The pin or hole a hit lands on, which is what a wire can start or end at. */
export function endOfHit(hit: Hit | null): WireEndRef | null {
  if (hit?.kind === "pin") return { kind: "pin", c: hit.c, p: hit.p };
  if (hit?.kind === "hole") return { kind: "hole", surface: hit.surface, hole: hit.hole };
  return null;
}

/** The middle of a pin or hole as the scene draws it, or null when the scene has no such target. */
export function pointOf(scene: Scene, end: WireEndRef): PointMm | null {
  for (const { hit, bbox } of scene.targets) {
    const same = end.kind === "pin" ? hit.kind === "pin" && hit.c === end.c && hit.p === end.p : hit.kind === "hole" && hit.surface === end.surface && hit.hole === end.hole;
    if (same) return { x: (bbox.x0 + bbox.x1) / 2, y: (bbox.y0 + bbox.y1) / 2 };
  }
  return null;
}

/** A ring round a pin, with `extra` art drawn in the ring's frame. */
export function ring(id: string, at: PointMm, stroke: string, extra: ArtElement[] = []): Overlay {
  return {
    id,
    xMm: at.x,
    yMm: at.y,
    elements: [{ t: "circle", cx: 0, cy: 0, r: RING_MM, fill: "none", stroke, sw: RING_SW }, ...extra],
  };
}

/** The name beside a ring, which the pin or hole answers to. */
export function ringTag(text: string): ArtElement {
  return { t: "text", x: PIN_RADIUS_MM + TAG_OFFSET_MM, y: -(PIN_RADIUS_MM + TAG_OFFSET_MM), s: text, size: TAG_SIZE_MM };
}

/** The second ring that marks an end the wire cannot take. */
export function refusedRing(): ArtElement {
  return { t: "circle", cx: 0, cy: 0, r: RING_MM + 0.5, fill: "none", stroke: WARN, sw: RING_SW };
}
