/**
 * The agent's tools: what a brain (the scripted one, or a voice model through the bridge) may do, each a function
 * declaration from `declarations.json` (Gemini Live's `functionDeclarations` shape, also importable by a Worker) plus
 * an executor onto the app's own seams. Pure TypeScript over a narrow host, so it runs headless in tests.
 *
 *   read  look, list_targets
 *   show  point_at, show_text, clear_callouts                 (bubbles only)
 *   act   propose_build, propose_edit, accept_step, reject_step, undo_step
 *                                                             (the co-builder: plan, preview, accept; nothing else
 *                                                              touches the project. propose_edit runs the agent's own
 *                                                              bench edits through it: edit.ts)
 *         open_lab, leave_lab, start_experiment, set_lab_control, request_item, next_step_hint
 *                                                             (the lab's own context and store, undoable, seen by the tutor)
 *
 * Every result is a small JSON object: `{ ok: true, ... }` or `{ ok: false, error }`. Arguments are checked against the
 * declaration (unknown keys, missing or mistyped ones are refused). In an exam the acting lab tools and hints refuse.
 */
import { TEMPLATES } from '@content/projects';
import type { AssistantService, CoBuildSession } from '../../contracts/assistant';
import { LANGS, pickText, type Lang } from '../../contracts/common';
import type { LessonGuideState } from '../../contracts/lesson';
import type { ProjectStore } from '../../contracts/project';
import type { BoardTarget } from '../../contracts/space';
import { benchView } from '../../assistant/snapshot';
import type { LabContext } from '../../lab/context';
import { notesOf, refusalText } from '../../lab/model/catalogue';
import { modelOf } from '../../lab/model/registry';
import { LAB_IDS, type LabId, type Prim } from '../../lab/model/types';
import { EXPERIMENTS } from '../../lab/experiments/list';
import { say as sayL6 } from '../../lab/text';
import type { CalloutList, CalloutTone, Conversation, PointTarget } from '../bubbles/model';
import type { Observation } from '../coach/coach';
import DECLARATIONS from './declarations.json';
import { createEditBuilder, planEdits, type EditSpec } from './edit';

export type SchemaType = 'OBJECT' | 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY';
export interface Schema {
  readonly type: SchemaType;
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly required?: readonly string[];
  readonly items?: Schema;
}
export interface FunctionDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parameters: Schema;
}
export type ToolKind = 'read' | 'show' | 'act';
export type ToolResult = { readonly ok: boolean; readonly error?: string; readonly [k: string]: unknown };
export type Args = Readonly<Record<string, unknown>>;

export interface AgentTool extends FunctionDeclaration {
  readonly kind: ToolKind;
  run(args: Args): Promise<ToolResult>;
}

/** What the tools reach in the app. */
export interface ToolHost {
  lang(): Lang;
  readonly assistant: AssistantService;
  readonly project: Pick<ProjectStore, 'doc' | 'selection'>;
  guide(): LessonGuideState | null;
  lab(): LabContext | undefined;
  readonly callouts: CalloutList;
  readonly conversation: Conversation;
  observations(n: number): readonly Observation[];
  /** World point of a bench target, or null when it is not on the bench; absent in tests without a bench. */
  locate?(t: BoardTarget): unknown;
}

export const DECLS = DECLARATIONS as unknown as readonly FunctionDeclaration[];
export const functionDeclarations = (): readonly FunctionDeclaration[] => DECLS;

export const KIND_OF: Readonly<Record<string, ToolKind>> = {
  look: 'read',
  list_targets: 'read',
  point_at: 'show',
  show_text: 'show',
  clear_callouts: 'show',
  propose_build: 'act',
  propose_edit: 'act',
  accept_step: 'act',
  reject_step: 'act',
  undo_step: 'act',
  open_lab: 'act',
  leave_lab: 'act',
  start_experiment: 'act',
  set_lab_control: 'act',
  request_item: 'act',
  next_step_hint: 'act',
};

/** How long a callout from `point_at` stays, ms. */
export const POINT_TTL_MS = 30_000;
const fail = (error: string, extra: Record<string, unknown> = {}): ToolResult => ({ ok: false, error, ...extra });

// ---- argument checks ------------------------------------------------------------------------------------------------

/** Null when `args` fits `schema` (an OBJECT), else what is wrong. */
export function checkArgs(args: unknown, schema: Schema): string | null {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return 'arguments must be an object';
  const props = schema.properties ?? {};
  for (const k of Object.keys(args)) if (!(k in props)) return `unknown argument "${k}"`;
  for (const k of schema.required ?? []) {
    const v = (args as Record<string, unknown>)[k];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return `missing argument "${k}"`;
  }
  for (const [k, s] of Object.entries(props)) {
    const v = (args as Record<string, unknown>)[k];
    if (v === undefined || v === null) continue;
    const bad = checkValue(v, s);
    if (bad) return `argument "${k}" ${bad}`;
  }
  return null;
}

function checkValue(v: unknown, s: Schema): string | null {
  switch (s.type) {
    case 'STRING':
      if (typeof v !== 'string') return 'must be a string';
      if (s.enum && !s.enum.includes(v)) return `must be one of ${s.enum.join(', ')}`;
      return null;
    case 'NUMBER':
    case 'INTEGER':
      return typeof v === 'number' && Number.isFinite(v) && (s.type === 'NUMBER' || Number.isInteger(v)) ? null : `must be a ${s.type.toLowerCase()}`;
    case 'BOOLEAN':
      return typeof v === 'boolean' ? null : 'must be true or false';
    case 'ARRAY':
      if (!Array.isArray(v)) return 'must be an array';
      for (const x of v) if (s.items && checkValue(x, s.items)) return `items ${checkValue(x, s.items)}`;
      return null;
    case 'OBJECT':
      return checkArgs(v, s);
  }
}

// ---- targets ----------------------------------------------------------------------------------------------------------

function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length]!;
}

/** The candidates closest to `wanted` (at most 5). */
export function closeMatches(wanted: string, candidates: readonly string[]): string[] {
  const w = wanted.toLowerCase();
  return [...new Set(candidates)]
    .map((c) => ({ c, d: c.toLowerCase().includes(w) || w.includes(c.toLowerCase()) ? 0 : distance(w, c.toLowerCase()) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map((x) => x.c);
}

const isExam = (lab: LabContext | undefined): boolean => {
  const r = lab?.runner.state.value;
  return !!r && r.mode === 'exam' && !r.done;
};
const labOpen = (h: ToolHost): LabContext | undefined => {
  const lab = h.lab();
  return lab?.store.lab ? lab : undefined;
};
const itemName = (lab: LabContext, id: string, lang: Lang): string => {
  const it = lab.store.get(id);
  return it?.label ?? (it ? sayL6(notesOf(it.kind).name, lang) : id);
};

/** A lab item by id, kind or name (any of the six languages), or null. */
export function findLabItem(lab: LabContext, spec: string): string | null {
  const s = spec.trim().toLowerCase();
  const items = lab.store.items();
  const exact = items.find((i) => i.id.toLowerCase() === s || i.kind === s || i.label?.toLowerCase() === s);
  if (exact) return exact.id;
  const asked = lab.inventory.request(spec);
  if (asked.found) return lab.store.byKind(asked.kind)?.id ?? null;
  const named = items.find((i) => LANGS.some((l) => notesOf(i.kind).name[l].toLowerCase() === s));
  return named?.id ?? null;
}

interface BenchPart {
  readonly id: string;
  readonly refdes: string;
  readonly def: string;
  readonly board: boolean;
}
const benchParts = (h: ToolHost): BenchPart[] =>
  h.assistant
    .snapshot()
    .project.parts.filter((p) => p.at)
    .map((p) => ({ id: p.id, refdes: p.refdes, def: p.def, board: p.kind === 'board' }));
/** Everyday words for a bench part's definition. */
const PART_WORDS: ReadonlyArray<readonly [RegExp, (p: BenchPart) => boolean]> = [
  [/^(arduino|uno|board|microcontroller|mcu)$/, (p) => p.board],
  [/^(bread ?board|protoboard)$/, (p) => p.def.includes('breadboard')],
];
const pinsOf = (h: ToolHost, partId: string, refdes: string): string[] => {
  const snap = h.assistant.snapshot();
  const keys = [...snap.project.nets.flatMap((n) => n.pins), ...snap.project.wires.flatMap((w) => [w.from, w.to])];
  return [...new Set(keys.filter((k) => k.startsWith(`${partId}.`)).map((k) => `${refdes}.${k.slice(partId.length + 1)}`))];
};

export type Resolved = { readonly ok: true; readonly target: PointTarget } | { readonly ok: false; readonly error: string; readonly suggestions: readonly string[] };

/** A `point_at` target: a lab item (when a lab is open), else a bench part, pin (`<refdes>.<pin>`) or part word. */
export function resolveTarget(h: ToolHost, spec: string): Resolved {
  const lang = h.lang();
  const lab = labOpen(h);
  if (lab) {
    const id = findLabItem(lab, spec);
    if (id) return { ok: true, target: { kind: 'lab', id, itemKind: lab.store.get(id)!.kind, name: itemName(lab, id, lang) } };
    const ids = lab.store.items().flatMap((i) => [i.id, i.kind]);
    return { ok: false, error: `no lab item "${spec}" on the bench`, suggestions: closeMatches(spec, ids) };
  }
  const parts = benchParts(h);
  const s = spec.trim();
  const byName = (x: string) => parts.find((p) => p.refdes.toLowerCase() === x.toLowerCase() || p.id === x);
  const dot = s.lastIndexOf('.');
  if (dot > 0 && !byName(s)) {
    const part = byName(s.slice(0, dot));
    const pin = s.slice(dot + 1);
    if (part && pin) {
      const target: BoardTarget = { kind: 'pin', part: part.id, pin };
      if (!h.locate || h.locate(target)) return { ok: true, target: { kind: 'bench', target, name: `${part.refdes}.${pin}` } };
      return { ok: false, error: `${part.refdes} has no pin "${pin}" on the bench`, suggestions: closeMatches(s, pinsOf(h, part.id, part.refdes)) };
    }
  }
  const word = s.toLowerCase().replace(/^the\s+/, '');
  const part =
    byName(s) ??
    parts.find((p) => PART_WORDS.some(([re, is]) => re.test(word) && is(p))) ??
    (word.length >= 3 ? parts.find((p) => p.def.toLowerCase().split('@')[0]!.includes(word.replace(/\s+/g, '-'))) : undefined);
  if (part) return { ok: true, target: { kind: 'bench', target: { kind: 'part', part: part.id }, name: part.refdes } };
  return { ok: false, error: `no part "${spec}" on the bench`, suggestions: closeMatches(spec, parts.map((p) => p.refdes)) };
}

// ---- reading ----------------------------------------------------------------------------------------------------------

export interface StepNow {
  readonly source: 'experiment' | 'lesson' | 'build';
  readonly text: string;
  readonly hint?: string | null;
  /** What it is about: a lab kind, or a bench target. */
  readonly focus?: string | BoardTarget;
}

/** The step to do now: the experiment's, else the lesson's, else the co-build proposal's. */
export function stepNow(h: ToolHost): StepNow | null {
  const lang = h.lang();
  const run = h.lab()?.runner.state.value;
  if (run && !run.done && run.step) {
    return { source: 'experiment', text: sayL6(run.step.text, lang), hint: isExam(h.lab()) ? null : sayL6(run.step.hint, lang), focus: run.step.focus };
  }
  const g = h.guide();
  const gs = g && !g.done ? g.steps[g.current] : undefined;
  if (gs) return { source: 'lesson', text: pickText(gs.text, lang), focus: gs.highlights[0]?.target };
  const cur = h.assistant.session.value?.state.value;
  if (cur?.status === 'proposing' && cur.current) return { source: 'build', text: `${cur.current.label}: ${cur.current.reason}`, focus: cur.current.anchors[0] };
  return null;
}

/** `look`'s JSON. */
export function lookNow(h: ToolHost): Record<string, unknown> {
  const lang = h.lang();
  const lab = labOpen(h);
  const out: Record<string, unknown> = { mode: lab ? 'lab' : 'bench', lang };
  if (lab) {
    const snap = lab.feed.snapshot(lang);
    out.lab = { ...snap, notes: Object.fromEntries(Object.entries(snap.notes).map(([k, n]) => [k, { name: n.name, hazards: n.hazards, actions: modelOf(k).actions }])) };
  } else {
    const snap = h.assistant.snapshot();
    out.bench = { ...snap, project: { ...snap.project, sources: snap.project.sources.map((s) => ({ path: s.path, language: s.language, chars: s.text.length })) } };
  }
  out.selection = h.project.selection.ids;
  out.step = stepNow(h);
  const st = h.assistant.session.value?.state.value;
  out.cobuild = st ? { status: st.status, current: st.current ? { key: st.current.key, label: st.current.label, reason: st.current.reason } : null, performed: st.performed.length } : null;
  out.callouts = h.callouts.list.map((c) => ({ id: c.id, target: c.target.name, text: c.text }));
  out.observations = h.observations(5).map((o) => ({ kind: o.kind, text: o.text }));
  return out;
}

// ---- building -------------------------------------------------------------------------------------------------------

const STOP = new Set(['build', 'help', 'with', 'the', 'and', 'make', 'let', 'lets', 'please', 'want', 'project', 'circuit']);

/** A template id for a free request, by its words (blink, button, fade), preferring the Uno; null when none fits. */
export function templateFor(request: string): string | null {
  const words = request.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
  if (words.length === 0) return null;
  let best: { id: string; score: number } | null = null;
  for (const t of TEMPLATES) {
    const hay = `${t.id} ${t.catalogue.child ?? ''} ${t.title.en ?? ''}`.toLowerCase();
    const score = words.filter((w) => hay.includes(w)).length * 10 + (t.id.includes('uno-r3') ? 1 : 0);
    if (score >= 10 && (!best || score > best.score)) best = { id: t.id, score };
  }
  return best?.id ?? null;
}

const sessionOf = (h: ToolHost): CoBuildSession | null => h.assistant.session.value;
/** The most edits one `propose_edit` takes: a guided change, not a whole build (that is propose_build). */
const MAX_EDITS = 12;
const stepJson = (s: CoBuildSession) => {
  const st = s.state.value;
  return { status: st.status, step: st.current ? { key: st.current.key, label: st.current.label, reason: st.current.reason } : null, performed: st.performed.length, message: st.message };
};

// ---- the tools --------------------------------------------------------------------------------------------------------

type Run = (h: ToolHost, a: Args) => Promise<ToolResult> | ToolResult;

const coerce = (v: unknown): Prim | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') return v as Prim;
  if (v === 'true' || v === 'false') return v === 'true';
  return v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
};

const RUNS: Readonly<Record<string, Run>> = {
  look: (h) => ({ ok: true, ...lookNow(h) }),
  list_targets(h) {
    const lab = labOpen(h);
    if (lab) return { ok: true, mode: 'lab', targets: lab.store.items().map((i) => ({ id: i.id, kind: i.kind, name: itemName(lab, i.id, h.lang()) })) };
    const parts = benchParts(h);
    return { ok: true, mode: 'bench', targets: parts.map((p) => ({ id: p.refdes, def: p.def, pins: pinsOf(h, p.id, p.refdes) })) };
  },
  point_at(h, a) {
    const r = resolveTarget(h, a.target as string);
    if (!r.ok) return fail(r.error, { suggestions: r.suggestions });
    const id = h.callouts.add(r.target, (a.text as string).slice(0, 140), (a.tone as CalloutTone | undefined) ?? 'info', POINT_TTL_MS);
    return { ok: true, id, target: r.target.name };
  },
  show_text(h, a) {
    h.conversation.say('', { final: true });
    h.conversation.say(a.text as string, { final: true, suggestions: (a.suggestions as string[] | undefined) ?? [] });
    return { ok: true };
  },
  clear_callouts(h) {
    h.callouts.clear();
    return { ok: true };
  },
  async propose_build(h, a) {
    const asked = (a.template as string | undefined) ?? templateFor(a.request as string);
    const doc = h.project.doc;
    const generic = /build it with me|with me$/i.test(a.request as string);
    let target: string | typeof doc | null = asked;
    if (!target && generic) target = (benchView(doc)?.placements?.length ?? 0) > 0 ? doc : 'prj_uno-r3-blink';
    if (!target) {
      return fail('only templates can be built today (the co-builder plans no free requests yet); name a template', {
        templates: TEMPLATES.filter((t) => t.id.includes('uno-r3')).map((t) => ({ id: t.id, title: t.title.en })),
      });
    }
    if (typeof target === 'string' && !TEMPLATES.some((t) => t.id === target)) return fail(`unknown template "${target}"`, { suggestions: closeMatches(target, TEMPLATES.map((t) => t.id)) });
    try {
      const s = await h.assistant.buildWithMe(target);
      return { ok: true, template: typeof target === 'string' ? target : doc.id, summary: s.state.value.plan?.summary ?? null, ...stepJson(s) };
    } catch (err) {
      return fail(`the build did not start: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
  async propose_edit(h, a) {
    if (labOpen(h)) return fail('a lab is open: propose_edit changes the circuit bench only');
    const edits = a.steps as EditSpec[];
    if (edits.length === 0) return fail('no steps');
    if (edits.length > MAX_EDITS) return fail(`at most ${MAX_EDITS} steps at once`);
    const summary = (a.summary as string).trim();
    const doc = h.project.doc;
    const preview = planEdits(doc, edits, summary);
    if (preview.steps.length === 0) {
      return fail(preview.unreachable.length > 0 ? 'none of the edits can be done here' : 'the bench already shows every edit', { unreachable: preview.unreachable });
    }
    try {
      const s = await h.assistant.buildWithMe(doc, { from: 'bench', builder: createEditBuilder(edits, summary) });
      return { ok: true, summary, steps: preview.steps.map((x) => x.label), unreachable: preview.unreachable, ...stepJson(s) };
    } catch (err) {
      return fail(`the edit did not start: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
  async accept_step(h, a) {
    const s = sessionOf(h);
    const st = s?.state.value;
    if (!s || st?.status !== 'proposing' || !st.current) return fail('no co-build step is waiting');
    const label = st.current.label;
    if (a.all === true) {
      void s.acceptAll();
      return { ok: true, performing: 'all remaining steps', first: label };
    }
    const before = st.performed.length;
    await s.accept();
    const after = s.state.value;
    if (after.performed.length <= before) return fail(after.message ?? 'the step was not performed', stepJson(s));
    return { ...stepJson(s), ok: true, performed: label };
  },
  async reject_step(h) {
    const s = sessionOf(h);
    const st = s?.state.value;
    if (!s || st?.status !== 'proposing' || !st.current) return fail('no co-build step is waiting');
    const skipped = st.current.label;
    await s.reject();
    return { ok: true, skipped, ...stepJson(s) };
  },
  async undo_step(h) {
    const s = sessionOf(h);
    const st = s?.state.value;
    if (!s || !st || st.performed.length === 0) return fail('the co-builder has performed nothing to undo');
    const label = st.performed[st.performed.length - 1]!.label;
    await s.undo();
    if (s.state.value.performed.length >= st.performed.length) return fail('nothing was undone', stepJson(s));
    return { ok: true, undone: label, ...stepJson(s) };
  },
  open_lab(h, a) {
    const lab = h.lab();
    if (!lab) return fail('the lab is not available');
    lab.open(a.lab as LabId);
    return { ok: true, lab: a.lab, items: lab.store.items().map((i) => ({ id: i.id, kind: i.kind })), experiments: EXPERIMENTS.filter((e) => e.lab === a.lab).map((e) => e.id) };
  },
  leave_lab(h) {
    const lab = h.lab();
    if (!lab?.store.lab) return fail('no lab is open');
    lab.leave();
    return { ok: true };
  },
  start_experiment(h, a) {
    const lab = h.lab();
    if (!lab) return fail('the lab is not available');
    const mode = (a.mode as 'practice' | 'exam' | undefined) ?? 'practice';
    if (!lab.start(a.id as string, mode)) return fail(`unknown experiment "${a.id}"`);
    return { ok: true, id: a.id, mode, step: stepNow(h) };
  },
  set_lab_control(h, a) {
    const lab = labOpen(h);
    if (!lab) return fail('no lab is open');
    if (isExam(lab)) return fail('refused: this is an exam, the person works the equipment');
    const id = findLabItem(lab, a.item as string);
    if (!id) return fail(`no lab item "${a.item}"`, { suggestions: closeMatches(a.item as string, lab.store.items().flatMap((i) => [i.id, i.kind])) });
    const kind = lab.store.get(id)!.kind;
    const actions = modelOf(kind).actions;
    if (!actions.includes(a.action as string)) return fail(`${kind} has no action "${a.action}"`, { actions });
    const value = coerce(a.value);
    const res = lab.store.apply(id, value === undefined ? { type: a.action as string } : { type: a.action as string, value });
    if (!res.ok) return fail(`refused by the item: ${res.reason}`, { reason: res.reason, say: sayL6(refusalText(res.reason), h.lang()) });
    return { ok: true, item: id, report: lab.store.report(id) };
  },
  request_item(h, a) {
    const lab = labOpen(h);
    if (!lab) return fail('no lab is open: open_lab first');
    if (isExam(lab)) return fail('refused: this is an exam');
    const r = lab.request(a.name as string);
    return { ok: true, ...r };
  },
  next_step_hint(h) {
    const lab = h.lab();
    if (isExam(lab)) return fail('refused: no hints in an exam');
    const step = stepNow(h);
    if (!step) return fail('no lesson, experiment or build step is running');
    let hint = step.hint ?? null;
    if (step.source === 'experiment' && lab) {
      const l6 = lab.runner.hint();
      hint = l6 ? sayL6(l6, h.lang()) : hint;
    }
    let pointed: string | null = null;
    if (step.focus) {
      const target = typeof step.focus === 'string' ? (labOpen(h) ? resolveTarget(h, step.focus) : null) : ({ ok: true, target: { kind: 'bench', target: step.focus, name: step.source } } as const);
      if (target?.ok) {
        h.callouts.add(target.target, hint ?? step.text, 'do', POINT_TTL_MS);
        pointed = target.target.name;
      }
    }
    return { ok: true, ...step, hint, pointed };
  },
};

/** Every tool, in declaration order. */
export function createTools(h: ToolHost): AgentTool[] {
  return DECLS.map((d) => {
    const run = RUNS[d.name];
    if (!run) throw new Error(`[agent] no executor for ${d.name}`);
    return { ...d, kind: KIND_OF[d.name] ?? 'act', run: async (args: Args) => run(h, args) };
  });
}

/** Runs a tool by name with checked arguments; never throws (a failure is `{ ok: false, error }`). */
export async function callTool(tools: readonly AgentTool[], name: string, args: unknown): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return fail(`unknown tool "${name}"`, { tools: tools.map((t) => t.name) });
  const a = args ?? {};
  const bad = checkArgs(a, tool.parameters);
  if (bad) return fail(bad);
  try {
    return await tool.run(a as Args);
  } catch (err) {
    return fail(`${name} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const RUN_NAMES = Object.keys(RUNS);
export { LAB_IDS };
