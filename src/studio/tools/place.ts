import { newId } from "../../core/ids.ts";
import { LIMITS } from "../../core/limits.ts";
import type { Board, Component, Op, ParamValue, Project as ProjectState } from "../../project/generated/types.ts";
import type { Descriptor } from "../../parts/descriptor.ts";
import { interfaceOf, type InterfaceSnapshot } from "../../parts/pins.ts";
import type { PartRegistry } from "../../parts/registry.ts";
import { PIN_RADIUS_MM } from "../engine/constants.ts";
import type { ArtElement, Overlay, PointMm, ResolvedPartShape, Rotation } from "../engine/types.ts";
import { legRecipe, legsShort } from "../rules/connect.ts";
import type { SessionStore } from "../stores/session.ts";
import { holeGridOf, legsFit, turn } from "../views/breadboard.ts";
import type { IdSource } from "../views/breadboard.ts";
import type { Tool, ToolCtx, ToolKeyEvent, ToolPointerEvent, ToolResult } from "./types.ts";

export type PlaceRefusal = "quota" | "unknown-definition" | "board-view";

export type PlaceDeps = {
  registry: Pick<PartRegistry, "latest">;
  session: Pick<SessionStore, "getState" | "armPart" | "setTool" | "setSelection" | "setStatus">;
  ids?: IdSource;
};

export interface PlaceTool extends Tool {
  /** Picks the part the next click, tap or Enter puts down; null puts it away. */
  armPart(ref: string | null): void;
}

/** `loose` is a part that waits on the canvas because no breadboard holes were under it; `chip` says it is one that needs the centre channel. */
export type Placed = { batch: Op[]; label: string; id: string; refdes: string; loose: boolean; chip: boolean };

const HOLE_PITCH_MM = 2.54;
const SNAP_REACH_MM = HOLE_PITCH_MM * 1.5;
/** How far a part that does not fit under the pointer looks for a place where it does: a chip dropped on the wrong side of the centre channel goes across it. */
const STRADDLE_REACH_MM = HOLE_PITCH_MM * 4;
/** A part with this many legs is a chip: every pin is a signal of its own, so two of them in one strip is a mistake and not a way to use a part (a resistor stood on end, a button's paired legs). */
const CHIP_LEGS = 6;
const RING_MM = PIN_RADIUS_MM + 0.6;
const SW = 0.3;
const INK = "var(--studio-ink)";

/** The refdes letters of parts whose descriptor does not say. */
const PREFIX_OF_TAG: Record<string, string> = { led: "D", diode: "D" };
const FALLBACK_PREFIX = "U";

const REFUSAL_KEY: Record<PlaceRefusal, string> = { quota: "quota", "unknown-definition": "unknownDefinition", "board-view": "boardView" };

const randomIds: IdSource = (prefix) => newId(prefix);
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function refdesPrefix(d: Descriptor): string {
  if (d.identity.refdes_prefix) return d.identity.refdes_prefix;
  const tag = d.identity.tags?.find((t) => PREFIX_OF_TAG[t]);
  return tag ? PREFIX_OF_TAG[tag]! : FALLBACK_PREFIX;
}

/** The lowest number after `prefix` that no board or part in the project uses. */
export function nextRefdes(state: ProjectState, prefix: string): string {
  const used = new Set([...state.boards, ...state.components].map((item) => item.refdes));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

function defaultParams(d: Descriptor): Record<string, ParamValue> | undefined {
  const entries = (d.parameters ?? []).flatMap((p): [string, ParamValue][] => (p.default === undefined ? [] : [[p.id, p.default as ParamValue]]));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

type Seat = { x: number; y: number; legs?: Record<string, string> };

/** What finding holes for a part needs: the view, the document state and the part shapes. */
export type SeatCtx = Pick<ToolCtx, "view" | "resolve"> & { doc: Pick<ToolCtx["doc"], "state"> };

/**
 * Where the part goes when its first pin is put at `at` on the breadboard: the nearest hole, within a pitch and a half,
 * that takes every leg, is free and keeps the part's legs out of one strip. When the legs fit under the point but not
 * that way (a chip with both rows of pins on one side of the centre channel), the nearest hole within four pitches that does.
 * The part `keep` may use the holes it already holds, which is how a seated part is moved or turned.
 */
export function seatOnSurface(ctx: SeatCtx, shape: ResolvedPartShape, at: PointMm, { rotation = 0, keep, iface }: { rotation?: Rotation; keep?: string; iface?: InterfaceSnapshot } = {}): Seat | null {
  const { view } = ctx;
  const surfacePlacement = view.placements.find((p) => p.c === view.surface);
  const surfaceItem = ctx.doc.state.components.find((c) => c.id === view.surface);
  if (!surfacePlacement || !surfaceItem) return null;
  const grid = holeGridOf(ctx.resolve(surfaceItem.definition.ref));

  const legs = shape.pins.filter((p) => !p.mechanical);
  const anchor = legs[0];
  if (!anchor) return null;
  const offsets = Object.fromEntries(legs.map((p) => [p.id, { x: p.xMm - anchor.xMm, y: p.yMm - anchor.yMm }]));
  const taken = new Set(view.placements.filter((p) => p.c !== keep).flatMap((p) => Object.values(p.legs ?? {})));

  const local = { x: at.x - surfacePlacement.x_mm, y: at.y - surfacePlacement.y_mm };
  const byDistance = grid.holes.map((h) => ({ h, d: Math.hypot(h.xMm - local.x, h.yMm - local.y) })).sort((a, b) => a.d - b.d);
  const turnedAnchor = turn({ x: anchor.xMm, y: anchor.yMm }, rotation);
  let shorted = false;
  for (const { h, d } of byDistance) {
    if (d > (shorted ? STRADDLE_REACH_MM : SNAP_REACH_MM)) break;
    const fit = legsFit(grid, offsets, { x: h.xMm, y: h.yMm }, rotation);
    if (!fit || Object.values(fit).some((hole) => taken.has(hole))) continue;
    if (legs.length >= CHIP_LEGS && legsShort(ctx.doc.state, view.id, fit, iface)) {
      shorted = true;
      continue;
    }
    return { x: round2(surfacePlacement.x_mm + h.xMm - turnedAnchor.x), y: round2(surfacePlacement.y_mm + h.yMm - turnedAnchor.y), legs: fit };
  }
  return null;
}

const isChip = (shape: ResolvedPartShape): boolean => shape.pins.filter((p) => !p.mechanical).length >= CHIP_LEGS;

const needsSurface = (ctx: ToolCtx, d: Descriptor): boolean => ctx.view.surface !== undefined && d.identity.kind !== "board";

/** Where a part lies when it is not over holes: on the grid, its middle at `at`. */
function looseSeat(ctx: ToolCtx, shape: ResolvedPartShape, at: PointMm): Seat {
  const snap = (v: number) => round2(Math.round(v / ctx.snapMm) * ctx.snapMm);
  return { x: snap(at.x - shape.widthMm / 2), y: snap(at.y - shape.heightMm / 2) };
}

function seatFor(ctx: ToolCtx, d: Descriptor, shape: ResolvedPartShape, at: PointMm): Seat {
  return (needsSurface(ctx, d) ? seatOnSurface(ctx, shape, at, { iface: interfaceOf(d) }) : null) ?? looseSeat(ctx, shape, at);
}

function overQuota(ctx: ToolCtx, d: Descriptor): boolean {
  const { state } = ctx.doc;
  const full = d.identity.kind === "board" ? state.boards.length >= LIMITS.boards : state.components.length >= LIMITS.components;
  return full || ctx.view.placements.length >= LIMITS.placementsPerView;
}

/**
 * The batch that puts one part into the open view: the dependency when the project does not pin the part yet, the part,
 * its placement and, on a breadboard, the net ops for its legs. It is all one batch, so one undo takes the part away.
 * A part that needs holes and finds none under `at` lies on the canvas, to be wired pin to pin or dragged onto the board.
 */
export function placeBatch(ctx: ToolCtx, deps: PlaceDeps, ref: string, at: PointMm): Placed | { refused: PlaceRefusal } {
  // a board view holds its one board and nothing else
  if (ctx.view.kind === "board") return { refused: "board-view" };
  const d = deps.registry.latest(ref);
  if (!d) return { refused: "unknown-definition" };
  if (overQuota(ctx, d)) return { refused: "quota" };
  const seat = seatFor(ctx, d, ctx.resolve(ref), at);

  const { state } = ctx.doc;
  const ids = deps.ids ?? randomIds;
  const refdes = nextRefdes(state, refdesPrefix(d));
  const definition = { ref: d.id, version: d.version };
  const id = d.identity.kind === "board" ? ids("brd") : ids("cmp");
  const pinned = state.dependencies.components.some((dep) => dep.ref === d.id && dep.version === d.version);
  const params = defaultParams(d);

  const batch: Op[] = [];
  if (!pinned) batch.push({ k: "dep.set", dependency: { ref: d.id, version: d.version, origin: "builtin", interface: interfaceOf(d) } });
  if (d.identity.kind === "board") {
    const board: Board = { id, definition, refdes, ...(params && { params }) };
    batch.push({ k: "board.add", board });
  } else {
    const component: Component = { id, definition, refdes, ...(params && { params }) };
    batch.push({ k: "component.add", component });
  }
  batch.push({ k: "view.place", view: ctx.view.id, placement: { c: id, x_mm: seat.x, y_mm: seat.y, rotation_deg: 0, ...(seat.legs && { legs: seat.legs }) } });
  if (seat.legs) batch.push(...legRecipe(state, ctx.view.id, id, seat.legs, ids));
  return { batch, label: `Place ${refdes}`, id, refdes, loose: seat.legs === undefined && needsSurface(ctx, d), chip: isChip(ctx.resolve(ref)) };
}

function ghost(shape: ResolvedPartShape, seat: Seat): Overlay {
  const elements: ArtElement[] = [{ t: "rect", x: 0, y: 0, w: shape.widthMm, h: shape.heightMm, fill: "none", stroke: INK, sw: SW }];
  for (const pin of shape.pins) {
    if (!pin.mechanical) elements.push({ t: "circle", cx: pin.xMm, cy: pin.yMm, r: RING_MM, fill: "none", stroke: INK, sw: SW });
  }
  return { id: "place:ghost", xMm: seat.x, yMm: seat.y, elements };
}

/**
 * R-055: pick a part in the palette, then click, tap or press Enter. A click puts the part where it points, Enter puts
 * it at the middle of the view. A part that needs the breadboard snaps into the holes under the pointer and lies on the
 * canvas when there are none. The tool puts the part away after one placement, so a double click makes one part.
 */
export function createPlaceTool(deps: PlaceDeps): PlaceTool {
  const { session } = deps;
  let hover: PointMm | null = null;

  const armed = (): string | null => session.getState().armedPart;

  function putAway() {
    hover = null;
    session.armPart(null);
  }

  function drop(ctx: ToolCtx, at: PointMm): ToolResult {
    const ref = armed()!;
    if (ctx.doc.readOnly) {
      session.setStatus({ key: "edit.place.readOnly" });
      return { kind: "cancel" };
    }
    const placed = placeBatch(ctx, deps, ref, at);
    if ("refused" in placed) {
      session.setStatus({ key: `edit.place.${REFUSAL_KEY[placed.refused]}` });
      return { kind: "cancel" };
    }
    putAway();
    session.setTool("select");
    session.setSelection([{ kind: "part", view: ctx.view.id, id: placed.id }]);
    session.setStatus({ key: placed.loose ? (placed.chip ? "edit.place.placedLooseChip" : "edit.place.placedLoose") : "edit.place.placed", params: { refdes: placed.refdes } });
    return { kind: "commit", batch: placed.batch, label: placed.label };
  }

  return {
    id: "place",

    armPart(ref) {
      hover = null;
      session.armPart(ref);
    },

    cursor: () => "copy",

    pointer(ev: ToolPointerEvent, ctx) {
      if (armed() === null) return { kind: "none" };
      const at = { x: ev.xMm, y: ev.yMm };
      switch (ev.type) {
        case "move":
        case "down":
          hover = at;
          return { kind: "preview" };
        case "up":
          return ev.button === 0 ? drop(ctx, at) : { kind: "none" };
        case "cancel":
          hover = null;
          return { kind: "cancel" };
      }
    },

    key(ev: ToolKeyEvent, ctx) {
      if (armed() === null) return { kind: "none" };
      if (ev.key === "Enter") return drop(ctx, { x: ctx.viewport.cx_mm, y: ctx.viewport.cy_mm });
      if (ev.key !== "Escape") return { kind: "none" };
      putAway();
      session.setTool("select");
      session.setStatus({ key: "edit.place.cancelled" });
      return { kind: "cancel" };
    },

    preview(ctx) {
      const ref = armed();
      const d = ref === null ? undefined : deps.registry.latest(ref);
      if (ref === null || !d || hover === null) return [];
      const shape = ctx.resolve(ref);
      return [ghost(shape, seatFor(ctx, d, shape, hover))];
    },
  };
}
