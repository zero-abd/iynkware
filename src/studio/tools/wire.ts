import { newId } from "../../core/ids.ts";
import type { Overlay, PointMm } from "../engine/types.ts";
import { canConnect, endLabel, sameEnd, wireRecipe } from "../rules/connect.ts";
import type { Refusal, Verdict, WireEndRef } from "../rules/connect.ts";
import type { StatusMessage } from "../stores/session.ts";
import type { IdSource } from "../views/breadboard.ts";
import { endOfHit, INK, pointOf, refusedRing, ring, ringTag, WARN } from "./pin-ring.ts";
import type { Tool, ToolCtx, ToolKeyEvent, ToolPointerEvent, ToolResult } from "./types.ts";

export type WireToolState = "idle" | "armed" | "targeting" | "committed" | "rejected";

export interface WireTool extends Tool {
  /** `committed` and `rejected` last until the next event, which finds the tool idle again. */
  state(): WireToolState;
  /** Why the last gesture was refused, until the next event. */
  refusal(): { code: Refusal; args: Record<string, string> } | null;
}

export type WireToolDeps = {
  setStatus(status: StatusMessage | null): void;
  ids?: IdSource;
};

const BAND_SW = 0.5;

const randomIds: IdSource = (prefix) => newId(prefix);

/** Straight, with one elbow when the ends are not in line, like the wire it will become. */
function band(from: PointMm, to: PointMm): string {
  const elbow = from.x !== to.x && from.y !== to.y ? `L${to.x} ${from.y}` : "";
  return `M${from.x} ${from.y}${elbow}L${to.x} ${to.y}`;
}

type Hover = { end: WireEndRef; verdict: Verdict; at: PointMm | null; label: string };

/**
 * UX 10.2: press a pin and drag to another, or tap one pin and then another. One gesture makes one wire, and a
 * gesture that cannot make one says why and leaves the document alone.
 */
export function createWireTool({ setStatus, ids = randomIds }: WireToolDeps): WireTool {
  let state: WireToolState = "idle";
  let from: WireEndRef | null = null;
  let anchor: PointMm | null = null;
  let tapping = false;
  let cursor: PointMm = { x: 0, y: 0 };
  let hover: Hover | null = null;
  let refused: { code: Refusal; args: Record<string, string> } | null = null;

  const accessOf = (ctx: ToolCtx) => (ctx.doc.readOnly ? "read-only" : "edit");

  function finish(next: WireToolState) {
    state = next;
    from = null;
    anchor = null;
    tapping = false;
    hover = null;
  }

  function reject(verdict: Extract<Verdict, { ok: false }>): ToolResult {
    refused = { code: verdict.code, args: verdict.args };
    setStatus({ key: `wire.refuse.${verdict.code}`, params: verdict.args });
    finish("rejected");
    return { kind: "cancel" };
  }

  function cancel(): ToolResult {
    if (from === null) return { kind: "none" };
    finish("idle");
    setStatus({ key: "wire.cancelled" });
    return { kind: "cancel" };
  }

  function follow(ev: ToolPointerEvent, ctx: ToolCtx) {
    cursor = { x: ev.xMm, y: ev.yMm };
    const end = endOfHit(ctx.hit(ev));
    if (end === null || (from !== null && sameEnd(end, from))) {
      hover = null;
    } else if (hover === null || !sameEnd(hover.end, end)) {
      hover = {
        end,
        verdict: canConnect(ctx.doc.state, ctx.view.id, from!, end, accessOf(ctx)),
        at: pointOf(ctx.scene, end),
        label: endLabel(ctx.doc.state, end),
      };
    }
  }

  function press(ev: ToolPointerEvent, ctx: ToolCtx): ToolResult {
    const end = endOfHit(ctx.hit(ev));
    if (end === null) return { kind: "none" };
    const start = canConnect(ctx.doc.state, ctx.view.id, end, null, accessOf(ctx));
    if (!start.ok && start.code !== "empty-target") return reject(start);
    from = end;
    anchor = pointOf(ctx.scene, end);
    cursor = { x: ev.xMm, y: ev.yMm };
    state = "armed";
    return { kind: "preview" };
  }

  function release(ev: ToolPointerEvent, ctx: ToolCtx): ToolResult {
    const a = from!;
    const end = endOfHit(ctx.hit(ev));
    if (!tapping && end !== null && sameEnd(end, a)) {
      tapping = true;
      hover = null;
      state = "armed";
      return { kind: "preview" };
    }
    const verdict = canConnect(ctx.doc.state, ctx.view.id, a, end, accessOf(ctx));
    if (!verdict.ok) return reject(verdict);

    const { batch, label } = wireRecipe(ctx.doc.state, ctx.view.id, a, end!, ids);
    setStatus({ key: "wire.added", params: { from: endLabel(ctx.doc.state, a), to: endLabel(ctx.doc.state, end!) } });
    finish("committed");
    return { kind: "commit", batch, label };
  }

  function settle() {
    if (state === "committed" || state === "rejected") {
      state = "idle";
      refused = null;
    }
  }

  return {
    id: "wire",
    state: () => state,
    refusal: () => refused,

    reset: () => finish("idle"),

    cursor: () => (hover !== null && !hover.verdict.ok ? "not-allowed" : "crosshair"),

    pointer(ev, ctx) {
      settle();
      switch (ev.type) {
        case "cancel":
          return cancel();
        case "down":
          if (ev.button !== 0) return { kind: "none" };
          if (from === null) return press(ev, ctx);
          follow(ev, ctx);
          return { kind: "preview" };
        case "move":
          if (from === null) return { kind: "none" };
          follow(ev, ctx);
          state = "targeting";
          return { kind: "preview" };
        case "up":
          return from === null ? { kind: "none" } : release(ev, ctx);
      }
    },

    key(ev: ToolKeyEvent) {
      settle();
      return ev.key === "Escape" ? cancel() : { kind: "none" };
    },

    preview() {
      if (from === null || anchor === null) return [];
      const end = hover?.at ?? cursor;
      const overlays: Overlay[] = [
        { id: "wire:band", xMm: 0, yMm: 0, elements: [{ t: "path", d: band(anchor, end), stroke: INK, sw: BAND_SW }] },
        ring("wire:from", anchor, INK),
      ];
      if (hover?.at) {
        const valid = hover.verdict.ok;
        const tag = ringTag(valid ? hover.label : `× ${hover.label}`);
        overlays.push(ring("wire:target", hover.at, valid ? INK : WARN, valid ? [tag] : [refusedRing(), tag]));
      }
      return overlays;
    },
  };
}
