import type { Overlay } from "../engine/types.ts";
import type { DocStore } from "../stores/doc.ts";
import type { SessionStore } from "../stores/session.ts";
import type { Tool, ToolCtx, ToolId, ToolKeyEvent, ToolPointerEvent, ToolResult } from "./types.ts";

type SessionStoreLike = Pick<SessionStore, "getState" | "setTool" | "setPreview" | "setStatus">;

export type ToolLogEntry = { tool: ToolId; result: ToolResult["kind"] };

const LOG_SIZE = 20;

/**
 * Routes pointer and key events to the active tool and is the one place a tool's `commit` becomes a document
 * change. A tool that throws is cancelled and the document is left alone.
 */
export interface ToolHost {
  register(tool: Tool): void;
  setTool(id: ToolId): void;
  pointer(ev: ToolPointerEvent, ctx: ToolCtx): void;
  /** True when the tool or the host used the key. */
  key(ev: ToolKeyEvent, ctx: ToolCtx): boolean;
  /** Ends a gesture in flight, as a lost pointer or a second finger does. */
  cancel(): void;
  preview(): Overlay[];
  /** The pointer the active tool wants over the canvas. */
  cursor(ctx: ToolCtx): string;
  /** The last 20 results, kept only in a build made with `NEXT_PUBLIC_STUDIO_TEST=1`. */
  recent(): readonly ToolLogEntry[];
}

export function createToolHost(deps: { doc: DocStore; session: SessionStoreLike }): ToolHost {
  const { doc, session } = deps;
  const tools = new Map<ToolId, Tool>();
  const failed = new Set<ToolId>();
  const log: ToolLogEntry[] = [];
  let overlays: Overlay[] = [];
  let gesture: { ev: ToolPointerEvent; ctx: ToolCtx } | null = null;
  /** A tool another one handed a press to; the host goes back to `back` when it is done with the gesture. */
  let borrowed: { tool: ToolId; back: ToolId } | null = null;

  const active = (): Tool | undefined => tools.get(session.getState().tool);

  function setPreview(next: Overlay[]) {
    overlays = next;
    session.setPreview(next);
  }

  function record(tool: Tool, result: ToolResult) {
    if (process.env.NEXT_PUBLIC_STUDIO_TEST !== "1") return;
    log.push({ tool: tool.id, result: result.kind });
    if (log.length > LOG_SIZE) log.shift();
  }

  function fail(tool: Tool) {
    if (!failed.has(tool.id)) {
      failed.add(tool.id);
      console.warn("[iynk] tool failed", tool.id);
    }
    gesture = null;
    setPreview([]);
  }

  function commit(result: Extract<ToolResult, { kind: "commit" }>) {
    const done = doc.commit(result.batch, { label: result.label });
    if (!done.ok) session.setStatus({ key: "ops.rejected", params: { message: done.message } });
    setPreview([]);
  }

  function apply(tool: Tool, result: ToolResult, ctx: ToolCtx) {
    record(tool, result);
    switch (result.kind) {
      case "none":
        return;
      case "preview":
        setPreview(tool.preview(ctx));
        return;
      case "commit":
        gesture = null;
        commit(result);
        return;
      case "cancel":
        gesture = null;
        setPreview([]);
        return;
      case "switch":
        gesture = null;
        setPreview([]);
        session.setTool(result.tool);
    }
  }

  function run(tool: Tool, step: () => ToolResult, ctx: ToolCtx): ToolResult | null {
    try {
      const result = step();
      apply(tool, result, ctx);
      if (borrowed?.tool === tool.id && (result.kind === "commit" || result.kind === "cancel")) {
        session.setTool(borrowed.back);
        borrowed = null;
      }
      return result;
    } catch {
      fail(tool);
      return null;
    }
  }

  /** The press that made a tool switch belongs to the tool it switched to, which takes it up as if it had come to it. */
  function handOver(from: Tool, to: ToolId, ev: ToolPointerEvent, ctx: ToolCtx) {
    const next = tools.get(to);
    if (!next) return;
    borrowed = { tool: to, back: from.id };
    gesture = { ev, ctx };
    run(next, () => next.pointer(ev, ctx), ctx);
  }

  const host: ToolHost = {
    register(tool) {
      tools.set(tool.id, tool);
    },

    setTool(id) {
      if (id === session.getState().tool) return;
      host.cancel();
      active()?.reset?.();
      borrowed = null;
      setPreview([]);
      session.setTool(id);
    },

    pointer(ev, ctx) {
      const tool = active();
      if (!tool) return;
      if (ev.type === "down") gesture = { ev, ctx };
      else if (gesture) gesture = ev.type === "move" ? { ev: gesture.ev, ctx } : null;
      const result = run(tool, () => tool.pointer(ev, ctx), ctx);
      if (ev.type === "down" && result?.kind === "switch") handOver(tool, result.tool, ev, ctx);
    },

    key(ev, ctx) {
      if (ev.key === "Escape" && gesture) {
        host.cancel();
        return true;
      }
      const tool = active();
      if (!tool) return false;
      const result = run(tool, () => tool.key(ev, ctx), ctx);
      return result !== null && result.kind !== "none";
    },

    cancel() {
      const tool = active();
      const current = gesture;
      gesture = null;
      if (!tool || !current) return;
      run(tool, () => tool.pointer({ ...current.ev, type: "cancel" }, current.ctx), current.ctx);
      setPreview([]);
    },

    cursor: (ctx) => active()?.cursor(ctx) ?? "default",
    preview: () => overlays,
    recent: () => log,
  };
  return host;
}
