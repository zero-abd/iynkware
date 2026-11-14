import type { Project } from "../../project/generated/types.ts";
import { lockedViolations } from "./assignment.ts";
import type { ReadSubmission } from "./submission.ts";
import { ASSIGNMENT_EXT, type AssignmentCheck, type AssignmentProject, type Verdict } from "./types.ts";

/** Runs the checks on a project. In the browser that is a worker; a test passes `gradeProject` itself. */
export type Grader = (project: Project, checks: readonly AssignmentCheck[]) => Promise<Verdict[]>;

export interface Graded {
  student: string;
  at: string;
  project: Project;
  /** The file names this assignment. Another assignment's submission is not graded. */
  assignmentOk: boolean;
  hashOk: boolean;
  /** Locked parts of the assignment that the project lost, unlocked or changed. */
  lockedLost: string[];
  /** What the student's device said. */
  claimed: Verdict[];
  /** What the checks found when the teacher's side ran them; the only results that count. */
  verdicts: Verdict[];
  /** Checks where the student's device and the re-run disagree. */
  mismatched: string[];
  passed: number;
  total: number;
}

/** Runs the assignment's own checks, from the teacher's copy, on the submitted project and compares them with what the file claims. */
export async function gradeSubmission(assignment: AssignmentProject, { submission, hashOk }: ReadSubmission, grade: Grader): Promise<Graded> {
  const info = assignment.ext[ASSIGNMENT_EXT];
  const assignmentOk = submission.assignment === info.id;
  const verdicts = assignmentOk ? await grade(submission.project, info.checks) : [];
  const claimed = new Map(submission.results.map((r) => [r.id, r.ok]));
  return {
    student: submission.student,
    at: submission.at,
    project: submission.project,
    assignmentOk,
    hashOk,
    lockedLost: lockedViolations(assignment, submission.project),
    claimed: submission.results,
    verdicts,
    mismatched: verdicts.filter((v) => claimed.get(v.id) !== v.ok).map((v) => v.id),
    passed: verdicts.filter((v) => v.ok).length,
    total: info.checks.length,
  };
}
