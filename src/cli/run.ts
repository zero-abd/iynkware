import { lessonJobFor } from "@/components/studio/lessonJob";
import { CHECK_BUDGET_MS, LIMIT_MESSAGE, runChecks } from "@/lib/interp";
import type { Project } from "@/project/generated/types";
import type { Flags, Io } from "./io";
import { parseDuration } from "./duration";
import type { Words } from "./messages";

const MS_PER_SECOND = 1000;

const stamp = (ms: number, words: Words): string => `${new Intl.NumberFormat(words.lang, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(ms / MS_PER_SECOND)} s`;

const secondsOf = (ms: number): number => Number((ms / MS_PER_SECOND).toFixed(3));

/** `iynk run`: one run of the project's code, its serial output and then every pin event, in time order. Returns the exit code. */
export function runCommand(project: Project, flags: Flags, io: Io, words: Words): number {
  const { t } = words;
  const requested = flags.for === undefined ? undefined : parseDuration(flags.for);
  if (flags.for !== undefined && requested === null) {
    io.err(t("error.badDuration", { value: flags.for }));
    return 2;
  }
  if (flags.test !== undefined && !project.tests.some((test) => test.id === flags.test)) {
    io.err(t("error.unknownTest", { id: flags.test }));
    return 2;
  }
  const job = lessonJobFor(project, { testId: flags.test });
  if ("error" in job) {
    io.err(job.error === "unsupported-language" ? t("error.unsupportedRun") : t("error.noCode"));
    return 1;
  }

  const { trace } = runChecks({ ...job, checks: [], runMs: requested ?? job.runMs }, { budgetMs: CHECK_BUDGET_MS });
  const pins = Object.entries(trace.pins)
    .flatMap(([net, events]) => events.map((e) => ({ net, ...e })))
    .sort((a, b) => a.t - b.t);

  if (flags.json) {
    io.out(JSON.stringify({ simulatedMs: trace.ms, error: trace.error, serial: trace.serial, pins }, null, 2));
  } else {
    io.out(t("run.heading", { seconds: secondsOf(trace.ms) }));
    io.out("");
    io.out(t("run.serial"));
    if (trace.serial.length === 0) io.out(`  ${t("run.noSerial")}`);
    for (const line of trace.serial) io.out(`  ${stamp(line.t, words)}  ${line.text.replace(/\r?\n$/, "")}`);
    io.out("");
    io.out(t("run.pins"));
    if (pins.length === 0) io.out(`  ${t("run.noPins")}`);
    for (const e of pins) io.out(`  ${stamp(e.t, words)}  ${e.net}  ${e.mode}  ${e.v}`);
  }

  if (trace.error) {
    const stopped = trace.error.message === LIMIT_MESSAGE ? t("check.runLimit") : trace.error.message;
    io.err(trace.error.line > 0 ? t("check.runError", { seconds: secondsOf(trace.ms), line: trace.error.line, message: stopped }) : t("check.runErrorNoLine", { seconds: secondsOf(trace.ms), message: stopped }));
    return 1;
  }
  return 0;
}
