import type { Op, Placement } from "../../project/generated/types.ts";
import type { PointMm, ResolvedPartShape, Rotation } from "../engine/types.ts";
import type { InterfaceSnapshot } from "../../parts/pins.ts";
import { legRecipe } from "../rules/connect.ts";
import { turn } from "../views/breadboard.ts";
import type { IdSource } from "../views/breadboard.ts";
import { seatOnSurface } from "./place.ts";
import type { SeatCtx } from "./place.ts";
import type { ToolCtx } from "./types.ts";

const round2 = (n: number): number => Math.round(n * 100) / 100;

export type Reseat = { batch: Op[]; unseated: boolean };

type Part = { placement: Placement; origin: PointMm; rotation: Rotation; anchor: PointMm | null; shape: ResolvedPartShape; iface: InterfaceSnapshot | undefined };

const interfaceFor = (ctx: SeatCtx, ref: string, version: string): InterfaceSnapshot | undefined =>
  ctx.doc.state.dependencies.components.find((d) => d.ref === ref && d.version === version)?.interface;

/** A part on a breadboard view that can sit in holes: not the breadboard and not a board. Null for anything else. */
function seatable(ctx: ToolCtx, c: string): Part | null {
  const { view, doc } = ctx;
  const placement = view.placements.find((p) => p.c === c);
  const item = doc.state.components.find((x) => x.id === c);
  const origin = ctx.scene.items.find((i) => i.id === c);
  if (view.surface === undefined || c === view.surface || !placement || !item || !origin) return null;
  const shape = ctx.resolve(item.definition.ref);
  const first = shape.pins.find((p) => !p.mechanical);
  const rotation = ((((placement.rotation_deg ?? 0) % 360) + 360) % 360) as Rotation;
  const anchor = first ? turn({ x: first.xMm, y: first.yMm }, rotation) : null;
  return { placement, origin: { x: origin.xMm, y: origin.yMm }, rotation, anchor, shape, iface: interfaceFor(ctx, item.definition.ref, item.definition.version) };
}

function withLegs(placement: Placement, x: number, y: number, rotation: Rotation, legs: Record<string, string> | undefined): Placement {
  const next: Placement = { ...placement, x_mm: x, y_mm: y, ...(rotation !== 0 || placement.rotation_deg !== undefined ? { rotation_deg: rotation } : {}) };
  if (legs) next.legs = legs;
  else delete next.legs;
  return next;
}

/**
 * Moving one part on a breadboard view by `dx`, `dy`: it seats in the holes its first pin lands over, and when none take
 * it, it lies where it was dropped and its legs let go of the strips they were in. Null when the part cannot sit in holes
 * and the plain move applies.
 */
export function moveSeated(ctx: ToolCtx, c: string, dx: number, dy: number, ids: IdSource): Reseat | null {
  const part = seatable(ctx, c);
  if (!part?.anchor) return null;
  const { placement, origin, rotation, anchor, shape, iface } = part;
  const seat = seatOnSurface(ctx, shape, { x: origin.x + anchor.x + dx, y: origin.y + anchor.y + dy }, { rotation, keep: c, iface });
  if (seat?.legs) {
    return { batch: [{ k: "view.place", view: ctx.view.id, placement: withLegs(placement, seat.x, seat.y, rotation, seat.legs) }, ...legRecipe(ctx.doc.state, ctx.view.id, c, seat.legs, ids)], unseated: false };
  }
  const unseated = placement.legs !== undefined;
  const batch: Op[] = [{ k: "view.place", view: ctx.view.id, placement: withLegs(placement, round2(origin.x + dx), round2(origin.y + dy), rotation, undefined) }];
  if (unseated) batch.push(...legRecipe(ctx.doc.state, ctx.view.id, c, {}, ids));
  return { batch, unseated };
}

/**
 * A part seated in holes turned to `rotation` about its first leg. It seats again when every rotated leg lands on a free
 * hole, and is refused otherwise (`blocked`). Null when the part is not seated, so the plain turn applies.
 */
export function turnSeated(ctx: SeatCtx, c: string, rotation: Rotation, ids: IdSource): { batch: Op[] } | { blocked: true } | null {
  const { view, doc } = ctx;
  const placement = view.placements.find((p) => p.c === c);
  const item = doc.state.components.find((x) => x.id === c);
  const surface = view.placements.find((p) => p.c === view.surface);
  const surfaceItem = doc.state.components.find((x) => x.id === view.surface);
  if (!placement?.legs || !item || !surface || !surfaceItem) return null;
  const shape = ctx.resolve(item.definition.ref);
  const first = shape.pins.find((p) => !p.mechanical);
  const hole = first && ctx.resolve(surfaceItem.definition.ref).pins.find((p) => p.id === placement.legs![first.id]);
  if (!hole) return { blocked: true };
  const at = { x: surface.x_mm + hole.xMm, y: surface.y_mm + hole.yMm };
  const seat = seatOnSurface(ctx, shape, at, { rotation, keep: c, iface: interfaceFor(ctx, item.definition.ref, item.definition.version) });
  if (seat?.legs?.[first.id] !== hole.id) return { blocked: true };
  return { batch: [{ k: "view.place", view: view.id, placement: withLegs(placement, seat.x, seat.y, rotation, seat.legs) }, ...legRecipe(doc.state, view.id, c, seat.legs, ids)] };
}
