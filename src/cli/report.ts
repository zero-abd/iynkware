import { relative } from "node:path";
import { failed, gradeFailed, type CheckLine, type ProjectReport, type RunReport } from "./check";
import type { GradeReport } from "./grade";
import type { Words } from "./messages";
import type { Finding } from "@/sim/faults/types";

const SIMULATED_SECONDS_DECIMALS = 3;

const seconds = (ms: number): number => Number((ms / 1000).toFixed(SIMULATED_SECONDS_DECIMALS));

const targetsOf = (f: Finding): string => f.targets.map((t) => (t.pin === undefined ? t.id : `${t.id}.${t.pin}`)).join(", ");

export interface Summary {
  projects: number;
  passed: number;
  failed: number;
}

export function summarize(reports: readonly ProjectReport[], strict: boolean): Summary {
  const failures = reports.filter((r) => failed(r, strict)).length;
  return { projects: reports.length, passed: reports.length - failures, failed: failures };
}

function loadMessage(report: ProjectReport, { t }: Words): string {
  const load = report.load!;
  return t(`error.load.${load.kind}`, { file: report.file, detail: load.detail });
}

function circuitSummary(findings: readonly Finding[], { t }: Words): string {
  const parts = (["error", "warning", "note"] as const).flatMap((severity) => {
    const count = findings.filter((f) => f.severity === severity).length;
    return count > 0 ? [t(`count.${severity}`, { count })] : [];
  });
  return parts.length > 0 ? parts.join(", ") : t("check.circuitClean");
}

function runSummary(run: RunReport, { t }: Words): string {
  if (run.skipped) return t("check.runSkipped", { reason: t(`check.skip.${run.skipped}`) });
  if (run.limit) return t("check.runLimit");
  const secs = seconds(run.ms);
  if (!run.error) return t("check.runOk", { seconds: secs });
  return run.error.line > 0 ? t("check.runError", { seconds: secs, line: run.error.line, message: run.error.message }) : t("check.runErrorNoLine", { seconds: secs, message: run.error.message });
}

const SKIP_REASONS = ["needs-analog", "no-source", "no-board", "unsupported-language"] as const;

const isSkipReason = (detail: string): detail is (typeof SKIP_REASONS)[number] => (SKIP_REASONS as readonly string[]).includes(detail);

function checkDetail(line: CheckLine, { t }: Words): string {
  if (line.detail === undefined) return "";
  return isSkipReason(line.detail) ? t(`check.skip.${line.detail}`) : line.detail;
}

function gradeLines(grade: GradeReport, { t }: Words): string[] {
  const lines = [`  ${t("check.graded", { assignment: grade.assignment, student: grade.student })}`];
  if (!grade.assignmentOk) lines.push(`  ${t("check.otherAssignment")}`);
  if (!grade.hashOk) lines.push(`  ${t("check.edited")}`);
  if (grade.lockedLost.length > 0) lines.push(`  ${t("check.lockedLost", { parts: grade.lockedLost.join(", ") })}`);
  lines.push(`  ${t("check.checks")}: ${t("check.checksCount", { passed: grade.passed, total: grade.total })}`);
  for (const line of grade.lines) {
    lines.push(`    ${t(`check.mark.${line.ok ? "ok" : "fail"}`)}  ${line.label}${line.detail ? ` (${line.detail})` : ""}${line.mismatched ? `  [${t("check.mismatch")}]` : ""}`);
  }
  return lines;
}

/** The readable report: one block per project, then a summary line. */
export function formatText(reports: readonly ProjectReport[], words: Words, strict: boolean, cwd: string): string[] {
  const { t } = words;
  const lines: string[] = [];
  for (const report of reports) {
    const name = relative(cwd, report.file) || report.file;
    const status = failed(report, strict) ? t("check.fail") : t("check.pass");
    lines.push(`${status}  ${name}${report.title ? `  (${report.title})` : ""}`);
    if (report.load) {
      lines.push(`  ${loadMessage({ ...report, file: name }, words)}`);
      continue;
    }
    if (report.grade) {
      lines.push(...gradeLines(report.grade, words));
      continue;
    }
    for (const item of report.loss) lines.push(`  ${t("check.imported")}  ${words.loss(item)}`);
    lines.push(`  ${t("check.circuit")}: ${circuitSummary(report.findings, words)}`);
    for (const f of report.findings) {
      lines.push(`    ${t(`check.severity.${f.severity}`)}  ${words.finding(f)} (${targetsOf(f)})`);
      for (const fix of f.fixes ?? []) lines.push(`      ${t("check.fix")}  ${words.fix(fix)}`);
    }
    for (const e of report.ruleErrors) lines.push(`    ${t("check.ruleFailed", { rule: e.ruleId, message: e.message })}`);
    for (const run of report.runs) {
      lines.push(`  ${t("check.run")} (${run.id}): ${runSummary(run, words)}`);
      const passed = run.checks.filter((c) => c.status === "pass").length;
      if (run.checks.length === 0) continue;
      lines.push(`  ${t("check.checks")} (${run.id}): ${t("check.checksCount", { passed, total: run.checks.length })}`);
      for (const c of run.checks) {
        const detail = checkDetail(c, words);
        lines.push(`    ${t(`check.mark.${c.status === "pass" ? "ok" : c.status === "fail" ? "fail" : "skip"}`)}  ${words.label(c.label)}${detail && c.status !== "pass" ? ` (${detail})` : ""}`);
      }
    }
  }
  const sum = summarize(reports, strict);
  lines.push("", t("check.summary", { passed: sum.passed, count: sum.projects }));
  return lines;
}

/** The report as plain data. Text is in the language of `words`; ids and statuses never change with it. */
export function toJson(reports: readonly ProjectReport[], words: Words, strict: boolean, cwd: string) {
  const sum = summarize(reports, strict);
  return {
    passed: sum.failed === 0,
    summary: sum,
    projects: reports.map((r) => ({
      file: relative(cwd, r.file) || r.file,
      title: r.title,
      status: failed(r, strict) ? "fail" : "pass",
      ...(r.load ? { load: { kind: r.load.kind, message: loadMessage({ ...r, file: relative(cwd, r.file) || r.file }, words) } } : {}),
      findings: r.findings.map((f) => ({
        ruleId: f.ruleId,
        causeId: f.causeId,
        severity: f.severity,
        message: words.finding(f),
        targets: f.targets,
        fixes: (f.fixes ?? []).map((fix) => ({ kind: fix.kind, safe: fix.safe ?? false, message: words.fix(fix) })),
      })),
      imported: r.loss.map((item) => ({ code: item.code, severity: item.severity, message: words.loss(item) })),
      ...(r.grade ? { grade: { ...r.grade, failed: gradeFailed(r.grade) } } : {}),
      ruleErrors: r.ruleErrors,
      runs: r.runs.map((run) => ({
        id: run.id,
        simulatedMs: run.ms,
        error: run.error,
        limit: run.limit,
        skipped: run.skipped ?? null,
        checks: run.checks.map((c) => ({ id: c.id, kind: c.kind, label: words.label(c.label), status: c.status, detail: c.detail ?? null })),
      })),
    })),
  };
}

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

// Characters XML 1.0 cannot carry are dropped; the rest of the text is kept.
const xml = (text: string): string => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);

interface Case {
  name: string;
  suite: string;
  seconds?: number;
  outcome: "pass" | "fail" | "skip";
  type?: string;
  message?: string;
}

function gradeCases(grade: GradeReport, { t }: Words, suite: string): Case[] {
  const cases: Case[] = grade.lines.map((l) => ({ name: l.label, suite, outcome: l.ok ? "pass" : "fail", type: "assignment-check", message: l.detail ?? "" }));
  const integrity = (name: string, bad: boolean, type: string): Case[] => (bad ? [{ name, suite, outcome: "fail", type, message: name }] : []);
  return [
    ...cases,
    ...integrity(t("check.otherAssignment"), !grade.assignmentOk, "assignment"),
    ...integrity(t("check.edited"), !grade.hashOk, "hash"),
    ...integrity(t("check.lockedLost", { parts: grade.lockedLost.join(", ") }), grade.lockedLost.length > 0, "locked"),
  ];
}

function casesOf(report: ProjectReport, words: Words, strict: boolean, name: string): Case[] {
  const { t } = words;
  const suite = name;
  if (report.load) return [{ name: t("check.fail"), suite, outcome: "fail", type: report.load.kind, message: loadMessage({ ...report, file: name }, words) }];
  if (report.grade) return gradeCases(report.grade, words, suite);
  const cases: Case[] = report.findings.map((f) => {
    const counts = f.severity === "error" || (strict && f.severity === "warning");
    return { name: `${t("check.circuit")}: ${words.finding(f)} (${targetsOf(f)})`, suite, outcome: counts ? "fail" : "pass", type: f.ruleId, message: `${t(`check.severity.${f.severity}`)}: ${words.finding(f)}` };
  });
  if (report.findings.length === 0) cases.push({ name: `${t("check.circuit")}: ${t("check.circuitClean")}`, suite, outcome: "pass" });
  for (const run of report.runs) {
    const bad = run.error !== null || run.limit;
    cases.push({
      name: `${t("check.run")} (${run.id})`,
      suite,
      seconds: seconds(run.ms),
      outcome: run.skipped ? "skip" : bad ? "fail" : "pass",
      type: "run",
      message: runSummary(run, words),
    });
    for (const c of run.checks) {
      const detail = checkDetail(c, words);
      cases.push({ name: `${run.id}: ${words.label(c.label)}`, suite, outcome: c.status, type: c.kind, message: detail });
    }
  }
  return cases;
}

/** JUnit XML, one testsuite per project. `time` is simulated seconds, so the file is the same on every machine. */
export function toJunit(reports: readonly ProjectReport[], words: Words, strict: boolean, cwd: string): string {
  const built = reports.map((report) => {
    const name = relative(cwd, report.file) || report.file;
    return { report, name, cases: casesOf(report, words, strict, name) };
  });
  const suites = built.map(({ report, name, cases }) => {
    const count = (outcome: Case["outcome"]) => cases.filter((c) => c.outcome === outcome).length;
    const body = cases.map((c) => {
      const time = c.seconds === undefined ? "" : ` time="${c.seconds}"`;
      const open = `    <testcase classname="${xml(c.suite)}" name="${xml(c.name)}"${time}`;
      if (c.outcome === "fail") return `${open}>\n      <failure type="${xml(c.type ?? "")}" message="${xml(c.message ?? "")}"/>\n    </testcase>`;
      if (c.outcome === "skip") return `${open}>\n      <skipped message="${xml(c.message ?? "")}"/>\n    </testcase>`;
      return `${open}/>`;
    });
    const total = seconds(report.runs.reduce((sum, r) => sum + r.ms, 0));
    return `  <testsuite name="${xml(name)}" tests="${cases.length}" failures="${count("fail")}" errors="0" skipped="${count("skip")}" time="${total}">\n${body.join("\n")}\n  </testsuite>`;
  });
  const all = built.flatMap((b) => b.cases);
  const head = `<testsuites name="iynk" tests="${all.length}" failures="${all.filter((c) => c.outcome === "fail").length}" errors="0" skipped="${all.filter((c) => c.outcome === "skip").length}">`;
  return [`<?xml version="1.0" encoding="UTF-8"?>`, head, ...suites, "</testsuites>", ""].join("\n");
}
