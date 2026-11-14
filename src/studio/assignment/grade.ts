import { checkJobFor } from "@/components/studio/checkJob";
import { LIMIT_MESSAGE, check as interpCheck, runChecks } from "@/lib/interp";
import { builtinRegistry } from "@/parts/builtin";
import type { Project } from "@/project/generated/types";
import { boardIdOf } from "@/sim/boards/profiles";
import { extractCodeFacts } from "@/sim/faults/code-facts";
import { buildNetView } from "@/sim/faults/netlist-view";
import { defaultRules, runRules } from "@/sim/faults/rules";
import { AUTHOR_CHECK_KINDS } from "../checks";
import { firstFirmwareSource } from "../code/sources";
import { collectProblems, staticProblems } from "../problems";
import { emptyAnalog } from "../run/analog";
import { staticFlags } from "../rules/connect";
import { resolvePart, runMsFor } from "./assignment";
import { runCircuit, type CircuitOutcome, type CircuitPlan, type Read, type Series, type Window } from "./circuit";
import type { AssignmentCheck, AuthorCheck, Verdict } from "./types";

export interface GradeOptions {
  /** Wall clock each of the two runs may use. */
  budgetMs: number;
  now(): number;
}

const TEST_ID = "assignment";
/** A swing smaller than this is not a signal, whatever its frequency. */
const MIN_SWING_V = 0.1;
/** The share of the swing a crossing has to clear on both sides of the middle, so noise on the edge counts once. */
const HYSTERESIS = 0.1;

const isAuthor = (c: AssignmentCheck): c is AssignmentCheck & AuthorCheck => (AUTHOR_CHECK_KINDS as readonly string[]).includes(c.kind);

const inRange = (v: number, [lo, hi]: readonly number[]): boolean => v >= lo && v <= hi;

const three = (n: number): string => String(Number(n.toPrecision(3)));

/** Rising crossings of the middle of the swing, with a dead band either side; the frequency is the mean over the whole of them. */
export function frequencyOf({ tMs, volts }: Series): { hz: number; swing: number } | null {
  if (volts.length < 2) return null;
  const lo = Math.min(...volts);
  const hi = Math.max(...volts);
  const swing = hi - lo;
  if (swing < MIN_SWING_V) return { hz: 0, swing };
  const mid = (lo + hi) / 2;
  const up = mid + HYSTERESIS * swing;
  const down = mid - HYSTERESIS * swing;
  const rises: number[] = [];
  let low = volts[0]! < mid;
  for (let i = 1; i < volts.length; i++) {
    const v = volts[i]!;
    if (v <= down) low = true;
    else if (low && v >= up) {
      const before = volts[i - 1]!;
      rises.push(before >= up ? tMs[i]! : tMs[i - 1]! + ((tMs[i]! - tMs[i - 1]!) * (mid - before)) / (v - before));
      low = false;
    }
  }
  if (rises.length < 2) return { hz: 0, swing };
  return { hz: ((rises.length - 1) * 1000) / (rises[rises.length - 1]! - rises[0]!), swing };
}

function authorVerdicts(project: Project, checks: readonly (AssignmentCheck & AuthorCheck)[], runMs: number, o: GradeOptions): Verdict[] {
  if (checks.length === 0) return [];
  const own = checks.map((c) => {
    const copy: Record<string, unknown> = { ...c };
    delete copy.hint;
    return copy as AuthorCheck;
  });
  const state: Project = { ...project, tests: [{ id: TEST_ID, name: TEST_ID, runMs, checks: own as never }] };
  const job = checkJobFor(state, TEST_ID, project.boards[0]?.id ?? "");
  if ("error" in job) return checks.map((c) => ({ id: c.id, ok: false, detail: job.error }));
  const outcome = runChecks(job, { budgetMs: o.budgetMs });
  const limit = outcome.trace.error?.message === LIMIT_MESSAGE;
  return checks.map((c, i) => {
    const r = outcome.results[i] ?? { ok: false };
    return { id: c.id, ok: r.ok && !limit, ...(limit ? { detail: "limit" } : r.detail === undefined ? {} : { detail: r.detail }) };
  });
}

function errorCount(project: Project, outcome: CircuitOutcome): number {
  const registry = builtinRegistry();
  const describe = (id: string) => {
    const at = id.lastIndexOf("@");
    return registry.get(id.slice(0, at), id.slice(at + 1));
  };
  const source = firstFirmwareSource(project);
  const board = project.boards[0];
  const language = board?.firmware?.language;
  const diagnostics = source && language === "arduino-cpp" ? interpCheck({ board: "uno-r3", language: "arduino", source: source.content }) : [];
  const burnt = Object.fromEntries(outcome.burnt.map(({ part, why }) => [part, { watts: 0, state: "burnt" as const, why }]));
  const flags = staticFlags(project, project.nets.map((n) => n.id));
  const problems = collectProblems({
    diagnostics,
    run: { limit: outcome.halted === "limit" ? { which: "time", text: "" } : null, frame: null, analog: { ...emptyAnalog(), parts: burnt } },
    flags,
  });
  if (outcome.net) {
    const view = buildNetView(outcome.net, describe);
    const entry = board && source ? [source.path] : [];
    const code = entry.length === 0 ? undefined : extractCodeFacts(Object.fromEntries(project.sources.map((s) => [s.path, s.content])), entry, { variant: boardIdOf(outcome.net.parts.find((p) => p.kind === "board")?.descriptor ?? "") });
    const { findings } = runRules(defaultRules(), { view, code });
    problems.push(...staticProblems(project, findings, { sealedUnrevealed: false }).problems);
  }
  return problems.filter((p) => p.severity === "error").length;
}

type Analog = Exclude<AssignmentCheck, AuthorCheck>;

function planOf(project: Project, checks: readonly Analog[], endMs: number, o: GradeOptions): CircuitPlan {
  const reads: Read[] = [];
  const windows: Window[] = [];
  for (const c of checks) {
    if (c.kind === "no-errors") continue;
    const part = resolvePart(project, c) ?? c.part;
    if (c.kind === "pin-volts") reads.push({ key: c.id, atMs: c.atMs, what: { kind: "volts", part, pin: c.pin } });
    else if (c.kind === "part-amps") reads.push({ key: c.id, atMs: c.atMs, what: { kind: "amps", part } });
    else windows.push({ key: c.id, part, pin: c.pin, fromMs: c.atMs - c.windowMs, toMs: c.atMs });
  }
  return { endMs, reads, windows, budgetMs: o.budgetMs, now: o.now };
}

function analogVerdict(c: Analog, project: Project, outcome: CircuitOutcome): Verdict {
  if (c.kind === "no-errors") {
    if (outcome.status === "refused") return { id: c.id, ok: false, detail: "refused" };
    const n = errorCount(project, outcome);
    return { id: c.id, ok: n === 0 && outcome.status !== "limit", ...(n > 0 ? { detail: String(n) } : outcome.status === "limit" ? { detail: "limit" } : {}) };
  }
  if (outcome.status !== "ok") return { id: c.id, ok: false, detail: outcome.status };
  if (c.kind === "pin-frequency") {
    const found = frequencyOf(outcome.series.get(c.id) ?? { tMs: [], volts: [] });
    if (!found) return { id: c.id, ok: false, detail: "no-reading" };
    return { id: c.id, ok: found.hz > 0 && inRange(found.hz, c.hz), detail: `${three(found.hz)} Hz` };
  }
  const value = outcome.reads.get(c.id) ?? null;
  if (value === null) return { id: c.id, ok: false, detail: "no-reading" };
  return c.kind === "pin-volts" ? { id: c.id, ok: inRange(value, c.volts), detail: `${three(value)} V` } : { id: c.id, ok: inRange(value, c.amps), detail: `${three(value)} A` };
}

/** One verdict for each check, in the order of `checks`. Pure in the project and the checks: the same ones give the same verdicts. */
export function gradeProject(project: Project, checks: readonly AssignmentCheck[], o: GradeOptions): Verdict[] {
  const runMs = runMsFor(checks, project.simulation.duration_ms);
  const analog = checks.filter((c): c is Analog => !isAuthor(c));
  const done = new Map<string, Verdict>();
  for (const v of authorVerdicts(project, checks.filter(isAuthor), runMs, o)) done.set(v.id, v);
  if (analog.length > 0) {
    const outcome = runCircuit(project, planOf(project, analog, runMs, o));
    for (const c of analog) done.set(c.id, analogVerdict(c, project, outcome));
  }
  return checks.map((c) => done.get(c.id) ?? { id: c.id, ok: false });
}

export const scoreOf = (verdicts: readonly Verdict[]): { passed: number; total: number } => ({ passed: verdicts.filter((v) => v.ok).length, total: verdicts.length });
