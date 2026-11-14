import { verdictsById } from "@/components/studio/checkJob";
import { withoutPinChecks } from "@/components/studio/lessonChecks";
import { lessonJobFor, type JobError } from "@/components/studio/lessonJob";
import { CHECK_BUDGET_MS, LIMIT_MESSAGE, runChecks } from "@/lib/interp";
import type { Project } from "@/project/generated/types";
import type { Finding } from "@/sim/faults/types";
import type { LossItem } from "@/export/loss";
import type { GradeReport } from "./grade";
import type { LoadErrorKind } from "./load";
import type { StaticResult } from "./static";

export type CheckStatus = "pass" | "fail" | "skip";

/** Why a run did not happen. */
export type SkipReason = Exclude<JobError, "unknown-test">;

export interface CheckLine {
  id: string;
  kind: string;
  label: string | Record<string, string | undefined>;
  status: CheckStatus;
  /** The evaluator's reason, or why the check was skipped. */
  detail?: string;
}

export interface RunReport {
  /** The test's id; `run` for the plain run of a project that has no tests. */
  id: string;
  name?: string | Record<string, string | undefined>;
  /** Simulated milliseconds. */
  ms: number;
  error: { line: number; message: string } | null;
  limit: boolean;
  /** Set when the run did not happen. */
  skipped?: SkipReason;
  checks: CheckLine[];
}

export interface ProjectReport {
  file: string;
  title?: string;
  load?: { kind: LoadErrorKind; detail: string };
  findings: Finding[];
  ruleErrors: StaticResult["ruleErrors"];
  runs: RunReport[];
  /** What a Wokwi import could not carry over. */
  loss: LossItem[];
  /** Set for a submission: the assignment's checks run on the submitted project. */
  grade?: GradeReport;
}

export interface CheckOptions {
  /** Wall-clock limit of one run, in milliseconds. */
  budgetMs?: number;
}

const SKIPPED_DETAILS: ReadonlySet<string> = new Set(["needs-analog", "unsupported-language"]);

const DEFAULT_RUN = "run";

function skippedRun(project: Project, id: string, name: RunReport["name"], reason: SkipReason): RunReport {
  const checks = project.tests.find((t) => t.id === id)?.checks ?? [];
  // A project with checks and nothing to run them on has not passed them.
  const status: CheckStatus = reason === "no-source" || reason === "no-board" ? "fail" : "skip";
  return {
    id,
    name,
    ms: 0,
    error: null,
    limit: false,
    skipped: reason,
    checks: checks.map((c) => ({ id: c.id, kind: c.kind, label: c.label, status, detail: reason })),
  };
}

/** Runs one test of a project (or its plain run) in the headless interpreter and pairs each check with its verdict. */
export function runTest(project: Project, testId: string | undefined, opts: CheckOptions = {}): RunReport {
  const test = project.tests.find((t) => t.id === testId);
  const id = test?.id ?? DEFAULT_RUN;
  const name = test?.name;
  let used = project;
  let job = lessonJobFor(used, { testId: test?.id });
  if ("error" in job && job.error === "unsupported-language" && test) {
    const pruned = withoutPinChecks(project, test.id);
    if (pruned) {
      used = pruned;
      job = lessonJobFor(used, { testId: test?.id });
    }
  }
  if ("error" in job) return skippedRun(project, id, name, job.error as SkipReason);

  const outcome = runChecks(job, { budgetMs: opts.budgetMs ?? CHECK_BUDGET_MS });
  const ran = verdictsById(used.tests.find((t) => t.id === id)?.checks ?? [], outcome.results);
  const limit = outcome.trace.error?.message === LIMIT_MESSAGE;
  const checks = (test?.checks ?? []).map((c): CheckLine => {
    const verdict = ran.get(c.id);
    if (!verdict) return { id: c.id, kind: c.kind, label: c.label, status: "skip", detail: "unsupported-language" };
    if (verdict.ok) return { id: c.id, kind: c.kind, label: c.label, status: "pass" };
    const status = verdict.detail !== undefined && SKIPPED_DETAILS.has(verdict.detail) ? "skip" : "fail";
    return { id: c.id, kind: c.kind, label: c.label, status, ...(verdict.detail === undefined ? {} : { detail: verdict.detail }) };
  });
  return { id, name, ms: outcome.trace.ms, error: limit ? null : outcome.trace.error, limit, checks };
}

/** Every test of the project, in order, or its plain run when it has none. */
export function runProject(project: Project, opts: CheckOptions = {}): RunReport[] {
  const ids = project.tests.length > 0 ? project.tests.map((t) => t.id) : [undefined];
  return ids.map((id) => runTest(project, id, opts));
}

export function reportFor(file: string, project: Project, found: StaticResult, runs: RunReport[], loss: LossItem[]): ProjectReport {
  return { file, title: project.meta.title, findings: found.findings, ruleErrors: found.ruleErrors, runs, loss };
}

export const gradeReportFor = (file: string, grade: GradeReport): ProjectReport => ({ file, title: grade.student, findings: [], ruleErrors: [], runs: [], loss: [], grade });

export const loadFailure = (file: string, load: NonNullable<ProjectReport["load"]>): ProjectReport => ({ file, load, findings: [], ruleErrors: [], runs: [], loss: [] });

/** A submission fails when a check fails, the file names another assignment, a locked part is gone or the file was edited after it was made. */
export const gradeFailed = (g: GradeReport): boolean => !g.assignmentOk || !g.hashOk || g.lockedLost.length > 0 || g.passed < g.total;

/** Whether the project fails CI: an error finding (a warning too when `strict`), a run that stopped, or a check that failed. */
export function failed(report: ProjectReport, strict: boolean): boolean {
  if (report.load) return true;
  if (report.grade) return gradeFailed(report.grade);
  if (report.findings.some((f) => f.severity === "error" || (strict && f.severity === "warning"))) return true;
  return report.runs.some((r) => r.error !== null || r.limit || r.checks.some((c) => c.status === "fail"));
}
