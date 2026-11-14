import type { Op, Project } from "../generated/types.ts";
import { validateRoboticsRefs, type RefError } from "../robotics-refs.ts";

/** Runs after the generic handler has applied a `domain.patch` or `domain.set`; `state` is the document it produced. */
export function afterDomainOp(
  state: Project,
  op: Extract<Op, { k: "domain.patch" | "domain.set" }>,
): { ok: true } | { ok: false; errors: RefError[] } {
  if (op.domain !== "robotics") return { ok: true };
  const errors = validateRoboticsRefs(state);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
