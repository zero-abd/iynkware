import { canonicalize, prettyPrint } from "../../core/canonical.ts";
import { fail, ok } from "../../core/result.ts";
import type { Failure, Result } from "../../core/result.ts";
import { parseStrict } from "../../core/strict-json.ts";
import { sha256Hex } from "../../core/sha256.ts";
import type { PartRegistry } from "../../parts/registry.ts";
import type { Project } from "../../project/generated/types.ts";
import { validateValue } from "../../project/validate.ts";
import { compactProject, expandProject } from "./compact.ts";
import { decodeValue, encodeValue, INFLATED_CAP } from "./codec.ts";
import { MAX_STUDENT, SUBMISSION_FORMAT, type AssignmentInfo, type Submission, type Verdict } from "./types.ts";

type Parts = Pick<PartRegistry, "get">;

const bad = (message: string): Result<never, Failure> => fail({ code: "submission", message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

type Body = Omit<Submission, "hash">;

/** The hash the file carries: over everything else in it, the project in its compact form. */
export const submissionHash = (body: Body): string => sha256Hex(canonicalize(body));

export function buildSubmission(project: Project, info: Pick<AssignmentInfo, "id">, o: { student: string; at: string; results: Verdict[] }, parts: Parts): Submission {
  const body: Body = {
    format: SUBMISSION_FORMAT,
    version: 1,
    assignment: info.id,
    student: o.student.trim(),
    at: o.at,
    results: o.results,
    project: compactProject(project, parts),
  };
  return { ...body, hash: submissionHash(body) };
}

/** The file: the same JSON a reader would write by hand, with the project in its compact form. */
export const submissionFile = (s: Submission): string => prettyPrint(s);

/** The code to paste: the file's JSON, gzipped, in base64url. */
export const submissionCode = (s: Submission): Promise<string> => encodeValue(s);

export type ReadSubmission = { submission: Submission; hashOk: boolean };

function shape(raw: unknown): Result<Submission, Failure> {
  if (!isRecord(raw) || raw.format !== SUBMISSION_FORMAT || raw.version !== 1) return bad("this is not a submission from iynk");
  if (typeof raw.assignment !== "string" || typeof raw.hash !== "string" || typeof raw.at !== "string") return bad("the submission is incomplete");
  if (typeof raw.student !== "string" || raw.student === "" || raw.student.length > MAX_STUDENT) return bad("the submission names no student");
  if (!Array.isArray(raw.results) || !raw.results.every((r) => isRecord(r) && typeof r.id === "string" && typeof r.ok === "boolean")) return bad("the results are not valid");
  if (!isRecord(raw.project)) return bad("the submission holds no project");
  return ok(raw as unknown as Submission);
}

/** `expandProject` on a value nobody has checked yet: one that is not a project comes back as it is, for the schema to refuse. */
function expanded(project: unknown, parts: Parts): unknown {
  try {
    return expandProject(project as Project, parts);
  } catch {
    return project;
  }
}

/**
 * Reads a submission from a file's text or from a pasted code. `hashOk` says whether the hash matches what the file holds;
 * the project is expanded and validated either way, so a hand edited file can still be opened and graded.
 */
export async function readSubmission(text: string, parts: Parts): Promise<Result<ReadSubmission, Failure>> {
  const trimmed = text.trim();
  let raw: unknown;
  if (trimmed.startsWith("{")) {
    const parsed = parseStrict(trimmed, { maxBytes: INFLATED_CAP });
    if (!parsed.ok) return bad("the file is not valid JSON");
    raw = parsed.value;
  } else {
    const decoded = await decodeValue(trimmed);
    if (!decoded.ok) return bad("this is not a submission from iynk");
    raw = decoded.value;
  }
  const checked = shape(raw);
  if (!checked.ok) return checked;
  const { hash, ...body } = checked.value;
  const hashOk = submissionHash(body) === hash;
  const report = validateValue(expanded(body.project, parts));
  if (!report.ok || !report.doc) return bad("the project in the submission is not valid");
  return ok({ submission: { ...checked.value, project: report.doc }, hashOk });
}
