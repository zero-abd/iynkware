import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createStaticChecker } from "./static";
import { failed, gradeReportFor, loadFailure, reportFor, runProject } from "./check";
import { exportCommand } from "./export";
import type { Flags, Io } from "./io";
import { gradeFile, isSubmissionFile, loadAssignment } from "./grade";
import { expandPatterns, loadProject } from "./load";
import { languageOf, loadWords, type Words } from "./messages";
import { formatText, toJson, toJunit } from "./report";
import { runCommand } from "./run";
import type { Project } from "@/project/generated/types";
import pkg from "../../package.json";

const OPTIONS = {
  json: { type: "boolean" },
  junit: { type: "string" },
  strict: { type: "boolean" },
  for: { type: "string" },
  test: { type: "string" },
  format: { type: "string" },
  out: { type: "string" },
  assignment: { type: "string" },
  lang: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

/** Exit codes: 0 all good, 1 a project failed, 2 the command line itself was wrong. */
const OK = 0;
const FAILED = 1;
const USAGE = 2;

function usage({ t }: Words): string[] {
  const row = (flag: string, text: string) => `  ${flag.padEnd(26)}${text}`;
  return [
    `iynk ${pkg.version}`,
    "",
    t("usage.heading"),
    row("iynk check <files|globs>", t("usage.check")),
    row("iynk run <file>", t("usage.run")),
    row("iynk export <file>", t("usage.export")),
    "",
    t("usage.options"),
    row("--json", t("usage.json")),
    row("--junit <file>", t("usage.junit")),
    row("--strict", t("usage.strict")),
    row("--for <5s|500ms>", t("usage.for")),
    row("--test <id>", t("usage.test")),
    row("--format <ino|bom>", t("usage.format")),
    row("--out <path>", t("usage.out")),
    row("--assignment <file>", t("usage.assignment")),
    row("--lang <code>", t("usage.lang")),
  ];
}

async function checkCommand(patterns: string[], flags: Flags, io: Io, words: Words): Promise<number> {
  const files = expandPatterns(patterns, io.cwd);
  if (files.length === 0) {
    io.err(words.t("error.noFiles", { patterns: patterns.join(" ") }));
    return USAGE;
  }
  const assignment = flags.assignment === undefined ? undefined : loadAssignment(resolve(io.cwd, flags.assignment), io.now);
  if (assignment && !assignment.ok) {
    io.err(words.t("error.badAssignment", { file: flags.assignment!, detail: assignment.detail }));
    return USAGE;
  }
  const checker = createStaticChecker();
  try {
    const reports = [];
    for (const file of files) {
      if (isSubmissionFile(file)) {
        if (!assignment) {
          reports.push(loadFailure(file, { kind: "submission", detail: "" }));
          continue;
        }
        const graded = await gradeFile(file, assignment.assignment, words, io.now);
        reports.push(graded.ok ? gradeReportFor(file, graded.report) : loadFailure(file, { kind: "invalid", detail: graded.detail }));
        continue;
      }
      const loaded = await loadProject(file, io.now, words.lang);
      if (!loaded.ok) {
        reports.push(loadFailure(file, { kind: loaded.kind, detail: loaded.detail }));
        continue;
      }
      reports.push(reportFor(file, loaded.project, await checker.check(loaded.project), runProject(loaded.project), loaded.loss));
    }
    if (flags.junit !== undefined) {
      const xml = toJunit(reports, words, flags.strict, io.cwd);
      if (flags.junit === "-") io.out(xml);
      else {
        const target = resolve(io.cwd, flags.junit);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, xml);
      }
    }
    if (flags.json) io.out(JSON.stringify(toJson(reports, words, flags.strict, io.cwd), null, 2));
    else if (flags.junit !== "-") for (const line of formatText(reports, words, flags.strict, io.cwd)) io.out(line);
    return reports.some((r) => failed(r, flags.strict)) ? FAILED : OK;
  } finally {
    await checker.close();
  }
}

async function oneProject(command: string, positionals: string[], io: Io, words: Words): Promise<{ code: number } | { project: Project }> {
  if (positionals.length !== 1) {
    io.err(words.t("error.oneFile", { command: `iynk ${command}` }));
    return { code: USAGE };
  }
  const [file] = expandPatterns(positionals, io.cwd);
  if (!file) {
    io.err(words.t("error.noFiles", { patterns: positionals[0]! }));
    return { code: USAGE };
  }
  const loaded = await loadProject(file, io.now, words.lang);
  if (!loaded.ok) {
    io.err(words.t(`error.load.${loaded.kind}`, { file: positionals[0]!, detail: loaded.detail }));
    return { code: FAILED };
  }
  return { project: loaded.project };
}

/** The whole command line. `argv` is what follows `iynk`. Returns the exit code. */
export async function main(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    io.err((await loadWords(languageOf(undefined, io.env) ?? "en")).t("error.badOption", { detail: error instanceof Error ? error.message : String(error) }));
    return USAGE;
  }
  const { values, positionals } = parsed;
  const lang = languageOf(values.lang, io.env);
  if (lang === null) {
    io.err((await loadWords("en")).t("error.badLang", { value: values.lang ?? "" }));
    return USAGE;
  }
  const words = await loadWords(lang);
  if (values.version) {
    io.out(pkg.version);
    return OK;
  }
  const [command, ...rest] = positionals;
  if (values.help || command === undefined || command === "help") {
    for (const line of usage(words)) io.out(line);
    return OK;
  }

  const flags: Flags = { json: values.json ?? false, junit: values.junit, strict: values.strict ?? false, for: values.for, test: values.test, format: values.format, out: values.out, assignment: values.assignment };
  if (command === "check") return checkCommand(rest, flags, io, words);
  if (command === "run" || command === "export") {
    const loaded = await oneProject(command, rest, io, words);
    if (!("project" in loaded)) return loaded.code;
    return command === "run" ? runCommand(loaded.project, flags, io, words) : exportCommand(loaded.project, flags, io, words, { version: pkg.version, exportedAt: new Date(io.now()).toISOString() });
  }
  io.err(words.t("error.unknownCommand", { name: command }));
  return USAGE;
}
