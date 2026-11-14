import { newId } from "../../core/ids.ts";
import type { Component, Op, Project, Source } from "../../project/generated/types.ts";
import { applyDetached } from "../../project/session.ts";
import type { Selectable } from "../stores/session.ts";
import { deleteBatch } from "../tools/select.ts";

/** What the student gets of the teacher's circuit. */
export type StarterMode = "as-is" | "unwired" | "board-only";

export const STARTER_MODES: readonly StarterMode[] = ["as-is", "unwired", "board-only"];

const BLANK_CODE: Partial<Record<Source["language"], string>> = {
  "arduino-cpp": "void setup() {\n}\n\nvoid loop() {\n}\n",
  micropython: "# Write your program here\n",
};

/** Whether the project has code that blanking can empty. */
export const canBlankCode = (project: Pick<Project, "sources">): boolean => project.sources.some((s) => s.role === "firmware" && BLANK_CODE[s.language] !== undefined);

const AUTHOR = { actor: "usr_local", kind: "system" } as const;

function apply(state: Project, batch: Op[]): Project {
  if (batch.length === 0) return state;
  const applied = applyDetached(state, batch, { author: AUTHOR, at: state.meta.updatedAt });
  if (!applied.ok) throw new Error(applied.reject.message);
  return applied.state;
}

/** Every wire of every view, with the net cuts that taking them out needs, so the parts stay and nothing joins them. */
function unwire(state: Project): Op[] {
  const wires: Selectable[] = state.views.flatMap((v) => v.wires.map((w): Selectable => ({ kind: "wire", view: v.id, id: w.id })));
  const deleted = deleteBatch(state, wires, "cut-connection", false, (prefix) => newId(prefix));
  return "batch" in deleted ? deleted.batch : [];
}

/** The ops that take out every part that is not a board or a surface a board view stands on. */
function clearParts(state: Project): Op[] {
  const surfaces = new Set(state.views.flatMap((v) => (v.surface === undefined ? [] : [v.surface])));
  return state.components.filter((c) => !surfaces.has(c.id)).map((c): Op => ({ k: "component.remove", id: c.id }));
}

const blankSources = (state: Project): Project => ({
  ...state,
  sources: state.sources.map((s) => (s.role === "firmware" && BLANK_CODE[s.language] !== undefined ? { ...s, content: BLANK_CODE[s.language]! } : s)),
});

function withLocked(c: Component, locked: boolean): Component {
  const { locked: was, ...rest } = c;
  if (locked) return { ...rest, locked: true };
  return was === undefined ? c : rest;
}

export interface StarterOptions {
  mode: StarterMode;
  /** Component ids the student cannot delete. An id the starter does not hold is ignored. */
  locked: readonly string[];
  blankCode: boolean;
}

/** The project the student starts from. The source is not touched. */
export function starterFrom(source: Project, { mode, locked, blankCode }: StarterOptions): Project {
  let state = mode === "as-is" ? source : apply(source, unwire(source));
  if (mode === "board-only") state = apply(state, clearParts(state));
  if (blankCode) state = blankSources(state);
  const keep = new Set(locked);
  return { ...state, components: state.components.map((c) => withLocked(c, keep.has(c.id))) };
}
