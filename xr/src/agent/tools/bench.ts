/**
 * The agent's hands on the circuit bench: change things, take changes back, and say what is wrong.
 *
 *   bench_actions    the build actions edit_bench runs (bench/core/actions.ts `ACTIONS`), with their arguments
 *   edit_bench       one build action on the project, applied as one undo entry the person can take back
 *   undo / redo      the last bench change (the person's or the agent's), a lab item's last change, or the co-builder's
 *   explain_problems the circuit check (the simulator's fault rules, no run needed) plus any run findings: each problem's
 *                    title, why and fix in the person's language, with callouts on the parts; in a lab, the tutor's
 *                    active mistakes
 *   apply_fix        a problem's ready-made fix (iynk's fix plans, as the 2D Studio's Problems panel applies them)
 *   run_circuit      run, pause or stop the simulation, so run-time problems show
 *
 * Parts and wires may be named by refdes (LED1, RES1) or id (cmp_led1); the tools map refdes to ids.
 */
import { builtinRegistry } from '@/parts/builtin';
import type { PartRegistry } from '@/parts/registry';
import { messageAt } from '@/i18n/translate';
import { resolveFixes } from '@/studio/fixes';
import type { Finding } from '@/sim/faults/types';
import faultsDe from '@/i18n/messages/de/faults.json';
import faultsEn from '@/i18n/messages/en/faults.json';
import faultsEs from '@/i18n/messages/es/faults.json';
import faultsFr from '@/i18n/messages/fr/faults.json';
import faultsHi from '@/i18n/messages/hi/faults.json';
import faultsZh from '@/i18n/messages/zh/faults.json';
import { ACTIONS, refusalText, runAction } from '../../bench/core/actions';
import type { Lang } from '../../contracts/common';
import type { Project, ProjectStore } from '../../contracts/project';
import type { SimBridge } from '../../contracts/sim';
import type { Args, ToolHost, ToolResult } from './catalog';

/** What the bench tools need beyond the base host; absent in hosts without a project store (some tests). */
export interface BenchToolHost {
  readonly project: ProjectStore;
  readonly sim?: Pick<SimBridge, 'check' | 'state' | 'findings' | 'load' | 'run' | 'pause' | 'stop' | 'step'>;
  readonly registry?: PartRegistry;
}

const FAULTS: Readonly<Record<Lang, unknown>> = { en: faultsEn, de: faultsDe, es: faultsEs, fr: faultsFr, hi: faultsHi, zh: faultsZh };
const fail = (error: string, extra: Record<string, unknown> = {}): ToolResult => ({ ok: false, error, ...extra });

// ---- names ----------------------------------------------------------------------------------------------------------

/** id -> refdes for every board and component, and the reverse (case-insensitive). */
function namesOf(doc: Project) {
  const toName = new Map<string, string>();
  const toId = new Map<string, string>();
  for (const x of [...doc.boards, ...doc.components] as Array<{ id: string; refdes?: string }>) {
    const name = x.refdes ?? x.id;
    toName.set(x.id, name);
    toId.set(name.toLowerCase(), x.id);
    toId.set(x.id.toLowerCase(), x.id);
  }
  return { name: (id: string) => toName.get(id) ?? id, id: (s: string) => toId.get(s.trim().toLowerCase()) };
}

/** `cmp_led1` -> `LED1`, `brd_main.D13` -> `UNO.D13`, inside any string argument. */
function named(doc: Project, v: string | number): string | number {
  if (typeof v !== 'string') return v;
  const n = namesOf(doc);
  return v.replace(/\b((?:cmp|brd)_[a-z0-9_]+)\b/gi, (id) => n.name(id));
}

/** Part and wire ids named by refdes in an action's arguments become ids. */
function idsIn(doc: Project, args: Record<string, unknown>): Record<string, unknown> {
  const n = namesOf(doc);
  const out: Record<string, unknown> = { ...args };
  for (const k of ['part']) if (typeof out[k] === 'string') out[k] = n.id(out[k] as string) ?? out[k];
  for (const k of ['from', 'to'] as const) {
    const e = out[k] as Record<string, unknown> | undefined;
    if (e && typeof e === 'object') {
      const end = { ...e };
      for (const f of ['c', 'surface']) if (typeof end[f] === 'string') end[f] = n.id(end[f] as string) ?? end[f];
      out[k] = end;
    }
  }
  return out;
}

// ---- wording ----------------------------------------------------------------------------------------------------------

function fmt(text: string, args: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (args[k] !== undefined ? String(args[k]) : m));
}
/** A `faults` message in `lang` (English when missing), filled with `args`, or null. */
function faultText(lang: Lang, key: string, args: Readonly<Record<string, string | number>> = {}): string | null {
  const t = messageAt(FAULTS[lang], key) ?? messageAt(FAULTS.en, key);
  return typeof t === 'string' ? fmt(t, args) : null;
}

export interface Problem {
  readonly n: number;
  readonly severity: Finding['severity'];
  readonly title: string;
  readonly why: string | null;
  readonly fix: string | null;
  /** What it is about, by refdes: `LED1`, `UNO.D13`. */
  readonly about: readonly string[];
  readonly fixes: ReadonlyArray<{ readonly n: number; readonly text: string; readonly canApply: boolean; readonly safe: boolean }>;
}

function describe(doc: Project, f: Finding, n: number, lang: Lang, reg: PartRegistry): Problem {
  const args = Object.fromEntries(Object.entries(f.args).map(([k, v]) => [k, named(doc, v)]));
  const title = faultText(lang, `cause.${f.causeId}.title`) ?? faultText(lang, f.messageKey, args) ?? f.ruleId;
  const resolved = resolveFixes(doc, f.fixes, { reg });
  return {
    n,
    severity: f.severity,
    title,
    why: faultText(lang, `cause.${f.causeId}.why`),
    fix: faultText(lang, `cause.${f.causeId}.fix`),
    about: f.targets.map((t) => (t.pin ? `${namesOf(doc).name(t.id)}.${t.pin}` : namesOf(doc).name(t.id))),
    fixes: resolved.map((r, i) => ({
      n: i + 1,
      text: faultText(lang, r.messageKey, Object.fromEntries(Object.entries(r.args).map(([k, v]) => [k, named(doc, v)]))) ?? r.messageKey,
      canApply: r.ops.length > 0,
      safe: r.safe,
    })),
  };
}

/** Static findings for the document now, plus the last run's findings (deduplicated by rule and targets). */
async function findingsNow(b: BenchToolHost): Promise<Finding[]> {
  if (!b.sim) return [];
  const doc = b.project.doc;
  const checked = (await b.sim.check(doc)).findings;
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of [...checked, ...b.sim.findings]) {
    const key = `${f.ruleId}|${JSON.stringify(f.targets)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  const rank = { error: 0, warning: 1, note: 2 } as const;
  return out.sort((a, c) => rank[a.severity] - rank[c.severity]);
}

// ---- the executors ----------------------------------------------------------------------------------------------------

type Run = (h: ToolHost, a: Args) => Promise<ToolResult> | ToolResult;

const benchOf = (h: ToolHost): BenchToolHost | null => h.bench ?? null;
const labOpen = (h: ToolHost) => {
  const lab = h.lab();
  return lab?.store.lab ? lab : undefined;
};
const examOn = (h: ToolHost) => {
  const r = h.lab()?.runner.state.value;
  return !!r && r.mode === 'exam' && !r.done;
};

export const BENCH_RUNS: Readonly<Record<string, Run>> = {
  bench_actions() {
    return { ok: true, actions: ACTIONS.map((a) => ({ name: a.name, args: a.args, does: a.does })), note: 'Name parts by refdes (LED1) or id (cmp_led1). Use look or list_targets for what is on the bench.' };
  },

  edit_bench(h, a) {
    const b = benchOf(h);
    if (!b) return fail('the bench is not available');
    if (labOpen(h)) return fail('a lab is open: leave_lab first to change the circuit bench');
    let parsed: unknown;
    try {
      parsed = a.args_json === undefined ? {} : JSON.parse(a.args_json as string);
    } catch {
      return fail('args_json is not valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fail('args_json must be a JSON object');
    const doc = b.project.doc;
    const r = runAction(doc, a.action as string, idsIn(doc, parsed as Record<string, unknown>));
    if (!r.ok) {
      return fail(`refused: ${r.reason}`, { reason: r.reason, args: r.args, say: refusalText(h.lang(), r) });
    }
    const res = b.project.apply(r.ops, { label: r.label });
    if (!res.ok) return fail('the change did not apply', { detail: res });
    const { ok: _ok, ops: _ops, label, ...result } = r as typeof r & Record<string, unknown>;
    return { ok: true, did: label, result, undo: 'say "undo" or call undo to take it back' };
  },

  undo(h, a) {
    const times = Math.max(1, Math.min(10, (a.times as number | undefined) ?? 1));
    const lab = labOpen(h);
    if (lab) {
      if (examOn(h)) return fail('refused: this is an exam');
      let n = 0;
      while (n < times && lab.store.undo()) n++;
      return n > 0 ? { ok: true, undone: n, where: 'lab' } : fail('nothing to undo in the lab');
    }
    const b = benchOf(h);
    let n = 0;
    while (b && n < times && b.project.canUndo() && b.project.undo()?.ok) n++;
    if (n > 0) return { ok: true, undone: n, where: 'bench', canRedo: b!.project.canRedo() };
    // nothing of the person's: the co-builder's last step, if any
    const s = h.assistant.session.value;
    if (s && s.state.value.performed.length > 0) {
      const label = s.state.value.performed.at(-1)!.label;
      return s.undo().then(() => ({ ok: true, undone: 1, where: 'co-builder', step: label }));
    }
    return fail('nothing to undo');
  },

  redo(h, a) {
    const times = Math.max(1, Math.min(10, (a.times as number | undefined) ?? 1));
    if (labOpen(h)) return fail('the lab has no redo');
    const b = benchOf(h);
    if (!b) return fail('the bench is not available');
    let n = 0;
    while (n < times && b.project.canRedo() && b.project.redo()?.ok) n++;
    return n > 0 ? { ok: true, redone: n, canRedo: b.project.canRedo() } : fail('nothing to redo');
  },

  async explain_problems(h, a) {
    const lang = h.lang();
    const point = a.point !== false;
    const lab = labOpen(h);
    if (lab) {
      if (examOn(h)) return fail('refused: no help in an exam');
      const snap = lab.feed.snapshot(lang);
      const problems = snap.mistakes.map((m, i) => ({ n: i + 1, severity: m.severity, title: m.say, about: [m.kind], item: m.itemId }));
      if (point) for (const m of snap.mistakes) h.callouts.add({ kind: 'lab', id: m.itemId, itemKind: m.kind, name: m.kind }, m.say.slice(0, 140), 'warn', 30_000);
      return { ok: true, mode: 'lab', count: problems.length, problems };
    }
    const b = benchOf(h);
    if (!b?.sim) return fail('the circuit check is not available');
    const reg = b.registry ?? builtinRegistry();
    const doc = b.project.doc;
    const problems = (await findingsNow(b)).map((f, i) => describe(doc, f, i + 1, lang, reg));
    if (point) {
      for (const p of problems.slice(0, 3)) {
        const part = p.about.find((x) => !x.includes('.')) ?? p.about[0]?.split('.')[0];
        const id = part ? namesOf(doc).id(part) : undefined;
        if (id) h.callouts.add({ kind: 'bench', target: { kind: 'part', part: id }, name: part! }, `${p.title}${p.fix ? ` — ${p.fix}` : ''}`.slice(0, 140), 'warn', 30_000);
      }
    }
    return { ok: true, mode: 'bench', count: problems.length, problems, run: b.sim.state };
  },

  async apply_fix(h, a) {
    const b = benchOf(h);
    if (!b?.sim) return fail('the circuit check is not available');
    if (labOpen(h)) return fail('a lab is open: fixes apply to the circuit bench');
    const reg = b.registry ?? builtinRegistry();
    const doc = b.project.doc;
    const findings = await findingsNow(b);
    const picks: Array<{ f: Finding; fix: number | null }> =
      a.all_safe === true
        ? findings.map((f) => ({ f, fix: null }))
        : findings[((a.problem as number | undefined) ?? 1) - 1]
          ? [{ f: findings[((a.problem as number | undefined) ?? 1) - 1]!, fix: (a.fix as number | undefined) ?? null }]
          : [];
    if (picks.length === 0) return fail(findings.length === 0 ? 'no problems found: nothing to fix' : `no problem ${a.problem}; there are ${findings.length}`);
    const applied: string[] = [];
    for (const { f, fix } of picks) {
      const now = b.project.doc;
      const resolved = resolveFixes(now, f.fixes, { reg });
      const chosen = fix !== null ? resolved[fix - 1] : resolved.find((r) => r.ops.length > 0 && (a.all_safe !== true || r.safe));
      if (!chosen || chosen.ops.length === 0) continue;
      const res = b.project.apply(chosen.ops, { label: faultText('en', chosen.messageKey, chosen.args) ?? 'Fix' });
      if (res.ok) applied.push(faultText(h.lang(), chosen.messageKey, Object.fromEntries(Object.entries(chosen.args).map(([k, v]) => [k, named(doc, v)]))) ?? chosen.messageKey);
    }
    if (applied.length === 0) return fail('no fix here can be applied automatically; explain the fix to the person instead');
    return { ok: true, applied, undo: 'each fix is one undo' };
  },

  async run_circuit(h, a) {
    const b = benchOf(h);
    if (!b?.sim) return fail('the simulator is not available');
    if (labOpen(h)) return fail('a lab is open');
    const action = a.action as 'run' | 'pause' | 'stop' | 'step' | 'restart';
    if (action === 'restart') await b.sim.stop();
    if (action === 'run' || action === 'restart') {
      // the run is built from the document as it is now: a run of an older version is started again
      if (b.sim.state === 'paused' || b.sim.state === 'idle') await b.sim.stop();
      if (b.sim.state !== 'running') {
        const loaded = await b.sim.load(b.project.doc);
        if (!loaded.ok) return fail('the circuit did not load', { detail: loaded });
      }
      await b.sim.run();
    } else if (action === 'step') {
      if (b.sim.state !== 'paused' && b.sim.state !== 'idle') {
        if (b.sim.state === 'running') await b.sim.pause();
        else if (!(await b.sim.load(b.project.doc)).ok) return fail('the circuit did not load');
      }
      await b.sim.step(Math.max(1, Math.min(10_000, (a.ms as number | undefined) ?? 100)));
    } else if (action === 'pause') await b.sim.pause();
    else await b.sim.stop();
    return { ok: true, state: b.sim.state };
  },
};

export const BENCH_KINDS = {
  bench_actions: 'read',
  edit_bench: 'act',
  undo: 'act',
  redo: 'act',
  explain_problems: 'read',
  apply_fix: 'act',
  run_circuit: 'act',
} as const;
