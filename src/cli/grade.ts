import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { readIynk } from "@/export/iynk";
import { checkText, detailText, partNameIn } from "@/components/studio/assignment/describe";
import { getAppRegistry } from "@/parts/builtin";
import type { Clock } from "@/core/ids";
import { gradeProject } from "@/studio/assignment/grade";
import { checkAssignment } from "@/studio/assignment/assignment";
import { gradeSubmission } from "@/studio/assignment/verify";
import { readSubmission } from "@/studio/assignment/submission";
import { ASSIGNMENT_EXT, SUBMISSION_FORMAT, type AssignmentProject } from "@/studio/assignment/types";
import type { Words } from "./messages";

/** Wall clock one grading run may use, as in the Studio's grader. */
const GRADE_BUDGET_MS = 60_000;

export interface GradeLine {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
  /** The student's device said the opposite of what the re-run found. */
  mismatched: boolean;
}

/** A submission graded against its assignment: the checks run again here, on the submitted project. */
export interface GradeReport {
  student: string;
  assignment: string;
  /** The submission names this assignment. */
  assignmentOk: boolean;
  hashOk: boolean;
  /** Ids of the locked parts the submitted project lost or changed. */
  lockedLost: string[];
  passed: number;
  total: number;
  lines: GradeLine[];
}

export type GradeResult = { ok: true; report: GradeReport } | { ok: false; detail: string };

/** Whether a file is an iynk submission, by what it says it is, not by its name. */
export function isSubmissionFile(file: string): boolean {
  if (extname(file).toLowerCase() !== ".json") return false;
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as { format?: unknown }).format === SUBMISSION_FORMAT;
  } catch {
    return false;
  }
}

/** The teacher's assignment file: an .iynk that carries an assignment. */
export function loadAssignment(file: string, clock: Clock): { ok: true; assignment: AssignmentProject } | { ok: false; detail: string } {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
  const read = readIynk(bytes, clock);
  if (!read.ok) return { ok: false, detail: read.error.message };
  const checked = checkAssignment(read.project);
  return checked.ok ? { ok: true, assignment: checked.value } : { ok: false, detail: checked.error.message };
}

export async function gradeFile(file: string, assignment: AssignmentProject, words: Words, now: () => number): Promise<GradeResult> {
  const parts = getAppRegistry();
  const read = await readSubmission(readFileSync(file, "utf8"), parts);
  if (!read.ok) return { ok: false, detail: read.error.message };
  const graded = await gradeSubmission(assignment, read.value, async (project, checks) => gradeProject(project, checks, { budgetMs: GRADE_BUDGET_MS, now }));
  const info = assignment.ext[ASSIGNMENT_EXT];
  const part = partNameIn(graded.project);
  const lines = info.checks.map((check): GradeLine => {
    const verdict = graded.verdicts.find((v) => v.id === check.id);
    const detail = detailText(words.assignment, check, verdict?.detail);
    return { id: check.id, label: checkText(words.assignment, check, part), ok: verdict?.ok ?? false, ...(detail === undefined ? {} : { detail }), mismatched: graded.mismatched.includes(check.id) };
  });
  return {
    ok: true,
    report: { student: graded.student, assignment: info.title, assignmentOk: graded.assignmentOk, hashOk: graded.hashOk, lockedLost: graded.lockedLost, passed: graded.passed, total: graded.total, lines },
  };
}
