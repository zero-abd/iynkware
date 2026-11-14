import { canonicalize } from "../../core/canonical.ts";
import { fail, ok } from "../../core/result.ts";
import type { Failure, Result } from "../../core/result.ts";
import { sha256Hex } from "../../core/sha256.ts";
import type { Check, Project } from "../../project/generated/types.ts";
import { forkProject } from "../../project/fork.ts";
import { validateValue } from "../../project/validate.ts";
import { AUTHOR_CHECK_KINDS, DEFAULT_TEST_ID, isAuthorCheck } from "../checks.ts";
import { starterFrom, type StarterOptions } from "./starter.ts";
import {
  ANALOG_KINDS,
  ASSIGNMENT_EXT,
  MAX_CHECKS,
  MAX_HINT,
  MAX_INSTRUCTIONS,
  MAX_TITLE,
  type AssignmentCheck,
  type AssignmentInfo,
  type AssignmentProject,
  type PartRef,
} from "./types.ts";

const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
const PIN_ID = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const REFDES = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;
const DEF_REF = /^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const KNOWN_KINDS: readonly string[] = [...AUTHOR_CHECK_KINDS, ...ANALOG_KINDS];
const MAX_RUN_MS = 60_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const isMs = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_RUN_MS;
const isRange = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n)) && v[0] <= v[1];
const isVisibility = (v: unknown) => v === undefined || v === "visible" || v === "hidden";

const bad = (message: string, path = ""): Result<never, Failure> => fail({ code: "assignment", message, path });

/** The four checks the assignment adds to the project's own. The project's kinds are checked by the schema. */
function analogShape(c: Record<string, unknown>): boolean {
  const named = c.refdes === undefined || (typeof c.refdes === "string" && REFDES.test(c.refdes));
  const defined = c.ref === undefined || (typeof c.ref === "string" && DEF_REF.test(c.ref));
  const part = isText(c.part, 64) && c.part !== "" && named && defined;
  const pin = typeof c.pin === "string" && PIN_ID.test(c.pin);
  switch (c.kind) {
    case "pin-volts":
      return part && pin && isRange(c.volts) && isMs(c.atMs);
    case "part-amps":
      return part && isRange(c.amps) && isMs(c.atMs);
    case "pin-frequency":
      return part && pin && isRange(c.hz) && c.hz[0] >= 0 && isMs(c.atMs) && isMs(c.windowMs) && c.windowMs > 0 && c.windowMs <= c.atMs;
    default:
      return true;
  }
}

/** The shape of what `ext` holds. The project's own kinds of check are only named here; `checkAssignment` hands them to the schema. */
export function parseInfo(raw: unknown): Result<AssignmentInfo, Failure> {
  if (!isRecord(raw) || raw.v !== 1) return bad("the assignment is not version 1");
  if (typeof raw.id !== "string" || !/^[0-9a-f]{32}$/.test(raw.id)) return bad("the assignment has no id", "/id");
  if (!isText(raw.title, MAX_TITLE) || raw.title.trim() === "") return bad("the title is empty or too long", "/title");
  if (!isText(raw.instructions, MAX_INSTRUCTIONS)) return bad("the instructions are too long", "/instructions");
  if (!Array.isArray(raw.checks) || raw.checks.length > MAX_CHECKS) return bad(`an assignment holds at most ${MAX_CHECKS} checks`, "/checks");
  const ids = new Set<string>();
  for (const [i, c] of raw.checks.entries()) {
    const at = `/checks/${i}`;
    if (!isRecord(c) || typeof c.kind !== "string" || !KNOWN_KINDS.includes(c.kind)) return bad("unknown kind of check", at);
    if (typeof c.id !== "string" || !LOCAL_ID.test(c.id) || ids.has(c.id)) return bad("a check id is missing or used twice", at);
    ids.add(c.id);
    if (c.hint !== undefined && !isText(c.hint, MAX_HINT)) return bad("a hint is too long", at);
    if (!isVisibility(c.visibility)) return bad("visibility is not visible or hidden", at);
    if (!analogShape(c)) return bad(`the ${c.kind} check has a bad field`, at);
  }
  return ok({ v: 1, id: raw.id, title: raw.title, instructions: raw.instructions, checks: raw.checks as AssignmentCheck[] });
}

const infos = new WeakMap<object, AssignmentInfo | null>();

/** The assignment a project carries, or null. A project that was validated on the way in needs no more than this. */
export function readAssignment(project: Project): AssignmentInfo | null {
  const raw = (project.ext as Record<string, unknown> | undefined)?.[ASSIGNMENT_EXT];
  if (!isRecord(raw)) return null;
  if (!infos.has(raw)) {
    const parsed = parseInfo(raw);
    infos.set(raw, parsed.ok ? parsed.value : null);
  }
  return infos.get(raw) ?? null;
}

/** The part a check reads in this project: the one with its id, or else the only part of its definition. Null when neither is there. */
export function resolvePart(project: Pick<Project, "boards" | "components">, c: Pick<PartRef, "part" | "ref">): string | null {
  const all = [...project.boards, ...project.components];
  if (all.some((p) => p.id === c.part)) return c.part;
  const same = c.ref === undefined ? [] : all.filter((p) => p.definition.ref === c.ref);
  return same.length === 1 ? same[0]!.id : null;
}

/** What identifies an assignment: the same title, instructions and checks give the same id, whoever holds the copy. */
export function assignmentId(parts: Pick<AssignmentInfo, "title" | "instructions" | "checks">): string {
  return sha256Hex(canonicalize({ title: parts.title, instructions: parts.instructions, checks: parts.checks })).slice(0, 32);
}

/** The project's own kinds of check, as the schema reads them: one test that holds them. */
function schemaView(project: Project, checks: readonly AssignmentCheck[]): Project {
  const own = checks.filter((c) => (AUTHOR_CHECK_KINDS as readonly string[]).includes(c.kind));
  const stripped = own.map((c) => {
    const copy = { ...c };
    delete copy.hint;
    return copy;
  });
  return { ...project, tests: stripped.length === 0 ? [] : [{ id: "assignment", name: "Assignment", runMs: 1000, checks: stripped as never }] };
}

/** The whole check: the project is valid, the assignment is well formed and its id matches what it holds. */
export function checkAssignment(value: unknown): Result<AssignmentProject, Failure> {
  const report = validateValue(value);
  if (!report.ok || !report.doc) return bad(report.first20[0]?.message ?? "the project is not valid");
  const info = readAssignment(report.doc);
  if (!info) {
    const raw = (report.doc.ext as Record<string, unknown> | undefined)?.[ASSIGNMENT_EXT];
    const parsed = parseInfo(raw);
    return parsed.ok ? bad("the project holds no assignment") : parsed;
  }
  if (assignmentId(info) !== info.id) return bad("the assignment does not match its id", "/ext");
  const schema = validateValue(schemaView(report.doc, info.checks));
  if (!schema.ok) return bad(schema.first20[0]?.message ?? "a check is not valid", "/ext");
  return ok(report.doc as AssignmentProject);
}

export interface AssignmentDraft extends StarterOptions {
  title: string;
  instructions: string;
  checks: AssignmentCheck[];
}

export interface Ids {
  id: string;
  now: string;
  actor: string;
}

/** The assignment as a project: the starter the student gets and the checks that grade it, in `ext`. The source is not touched. */
export function buildAssignment(source: Project, draft: AssignmentDraft, ids: Ids): AssignmentProject {
  const starter = starterFrom(source, draft);
  const made = forkProject(starter, { id: ids.id, now: ids.now, actor: ids.actor, title: draft.title.trim() });
  const title = draft.title.trim();
  const info: AssignmentInfo = { v: 1, id: assignmentId({ title, instructions: draft.instructions, checks: draft.checks }), title, instructions: draft.instructions, checks: draft.checks };
  delete made.guide;
  return { ...made, tests: [], ext: { [ASSIGNMENT_EXT]: info } };
}

/** The student's own copy: a new project that keeps the assignment, so the checks and the locked parts go with it. */
export function startAssignment(assignment: Project, ids: Ids): Project {
  return forkProject(assignment, ids);
}

/** The components the assignment locks that the submitted project lost, unlocked or changed. */
export function lockedViolations(assignment: Project, submitted: Project): string[] {
  return assignment.components
    .filter((c) => c.locked === true)
    .filter((c) => {
      const now = submitted.components.find((s) => s.id === c.id);
      return !now || now.locked !== true || now.definition.ref !== c.definition.ref || now.definition.version !== c.definition.version;
    })
    .map((c) => c.id);
}

/** How long a run has to be for the checks to find what they read, and no more than a check may ask for. */
export function runMsFor(checks: readonly AssignmentCheck[], floorMs: number): number {
  let ms = floorMs;
  for (const c of checks) {
    if ("atMs" in c) ms = Math.max(ms, c.atMs);
    if (c.kind === "runs") ms = Math.max(ms, c.minMs);
    if (c.kind === "responds") ms = Math.max(ms, c.after.t + c.withinMs);
    if (c.kind === "serial" && c.byMs !== undefined) ms = Math.max(ms, c.byMs);
  }
  return Math.min(ms, MAX_RUN_MS);
}

/** The checks of the project's own Checks tab, which an assignment takes along. */
export function projectChecks(project: Pick<Project, "tests">): AssignmentCheck[] {
  const own: readonly Check[] = project.tests.find((t) => t.id === DEFAULT_TEST_ID)?.checks ?? [];
  return own.filter(isAuthorCheck);
}
