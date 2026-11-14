/**
 * The scripted co-builder's planner: from the bench as it is to a target project, as an ordered list of steps a person
 * would take (contracts/assistant.ts `BuildPlan`). Boards first, then the breadboard, then each part in the target's
 * order, then each wire, then any connection the target has that no leg or wire makes. Each step's ops come from the
 * same recipes the person's hands use, computed against the document as the steps before it leave it, and each is
 * checked with the project's own rules (`applyDetached` with `checkBatch`, as the store's session does) before it is
 * proposed. New nets take the target's ids, names and classes, so the built project matches the template.
 *
 * Pure and deterministic for a given id source: no store, no clock.
 */
import type { Net, Op, PinRef, Project, Wire, WireEnd } from '@/project/generated/types';
import { applyDetached } from '@/project/session';
import { checkBatch } from '@/project/semantic';
import { endLabel, type WireEndRef } from '@/studio/rules/connect';
import type { BuildPlan, BuildRecipes, CoBuilder, PlanStep, PlanStepKind } from '../contracts/assistant';
import type { Lang } from '../contracts/common';
import type { BoardTarget } from '../contracts/space';
import { localized, say } from './copy';
import { benchView } from './snapshot';
import { stringLegs } from './recipes';

export interface PlanOptions {
  readonly lang: Lang;
  readonly recipes: BuildRecipes;
  readonly declined?: readonly string[];
  /** The plan's proposal id. Default: `prp_`, a running count and the revision. */
  readonly id?: string;
}

type View = Project['views'][number];
type Placement = View['placements'][number];

const CHECK_AUTHOR = { actor: 'usr_cobuilder', kind: 'ai' as const };
const CHECK_AT = '2026-01-01T00:00:00.000Z';

const pinKey = (p: PinRef) => `${p.c}\u0000${p.p}`;

/** A step before its ops: what it is about and what it needs. */
interface Candidate {
  readonly key: string;
  readonly kind: PlanStepKind;
  readonly needs: readonly string[];
  readonly ops: (work: Project) => Op[];
  readonly describe: (work: Project, after: Project) => { reason: string; label: string; anchors: BoardTarget[]; part?: string };
}

/** Applies `ops` with the project's own batch rules, as `ProjectStore.apply` will. */
export function tryOps(doc: Project, ops: readonly Op[]): { ok: true; state: Project } | { ok: false; message: string } {
  const out = applyDetached(doc, ops, { author: CHECK_AUTHOR, at: CHECK_AT, invariants: checkBatch });
  return out.ok ? { ok: true, state: out.state } : { ok: false, message: out.reject.message };
}

/** The connections of every net as sets of pins, for comparing two documents' circuits. */
export function netPartition(doc: Project): string[][] {
  return doc.nets
    .map((n) => n.connections.map((c) => `${c.c}.${c.p}`).sort())
    .filter((g) => g.length > 0)
    .sort((a, b) => a.join().localeCompare(b.join()));
}

/**
 * Gives each net the step made the id, name and class of the target net that holds its pins, when that id is still
 * free. Only ids born in this step are renamed (an existing net cannot change id by an op).
 */
function adoptTargetNets(work: Project, ops: Op[], target: Project): Op[] {
  const before = new Set(work.nets.map((n) => n.id));
  const trial = tryOps(work, ops);
  if (!trial.ok) return ops;
  const owner = new Map<string, Net>();
  for (const n of target.nets) for (const c of n.connections) owner.set(pinKey(c), n);
  const taken = new Set(trial.state.nets.map((n) => n.id));
  const rename = new Map<string, string>();
  for (const n of trial.state.nets) {
    if (before.has(n.id)) continue;
    const t = n.connections.map((c) => owner.get(pinKey(c))).find((x) => x);
    if (!t || taken.has(t.id) || [...rename.values()].includes(t.id)) continue;
    if (!n.connections.every((c) => owner.get(pinKey(c))?.id === t.id)) continue;
    rename.set(n.id, t.id);
  }
  const swap = (id: string) => rename.get(id) ?? id;
  const renamed: Op[] = ops.map((op) => {
    switch (op.k) {
      case 'net.create':
        return { ...op, net: { ...op.net, id: swap(op.net.id) } };
      case 'net.connect':
        return { ...op, net: swap(op.net) };
      case 'net.merge':
        return { ...op, into: swap(op.into), from: swap(op.from) };
      case 'net.set':
        return { ...op, id: swap(op.id) };
      case 'net.split':
        return { ...op, net: swap(op.net), into: swap(op.into) };
      case 'wire.add':
        return { ...op, wire: { ...op.wire, net: swap(op.wire.net) } };
      default:
        return op;
    }
  });
  const after = tryOps(work, renamed);
  if (!after.ok) return ops;
  // Names and classes as the target has them, in the same step.
  const byId = new Map(target.nets.map((n) => [n.id, n]));
  for (const n of after.state.nets) {
    const t = byId.get(n.id);
    if (!t || (before.has(n.id) && !rename.has(n.id) && n.name === t.name && n.class === t.class)) continue;
    const name = t.name !== undefined && t.name !== n.name && !after.state.nets.some((o) => o.id !== n.id && o.name === t.name) ? t.name : undefined;
    const cls = t.class !== undefined && t.class !== n.class ? t.class : undefined;
    if (name !== undefined || cls !== undefined) renamed.push({ k: 'net.rename', id: n.id, ...(name !== undefined && { name }), ...(cls !== undefined && { class: cls }) });
  }
  return renamed;
}

const sameEnds = (a: Wire, b: Wire) => {
  const k = (e: WireEnd) => JSON.stringify(e);
  return (k(a.from) === k(b.from) && k(a.to) === k(b.to)) || (k(a.from) === k(b.to) && k(a.to) === k(b.from));
};

const targetOf = (end: WireEnd): BoardTarget | null =>
  end.kind === 'pin' ? { kind: 'pin', part: end.c, pin: end.p } : end.kind === 'hole' ? { kind: 'hole', surface: end.surface, hole: end.hole } : null;

const endRef = (end: WireEnd): WireEndRef =>
  end.kind === 'pin' ? { kind: 'pin', c: end.c, p: end.p } : { kind: 'hole', surface: (end as { surface: string }).surface, hole: (end as { hole: string }).hole };

const ownerOf = (end: WireEnd): string | null => (end.kind === 'pin' ? end.c : end.kind === 'hole' ? end.surface : null);

/** The ordered steps from `doc` to `target`, before ops: boards, the breadboard, parts, wires. */
function candidates(doc: Project, target: Project, tView: View, lang: Lang, recipes: BuildRecipes, unreachable: BuildPlan['unreachable'][number][]): Candidate[] {
  const out: Candidate[] = [];
  const surface = tView.surface;
  const boardIds = new Set(target.boards.map((b) => b.id));

  const place = (p: Placement): Candidate => {
    const board = target.boards.find((b) => b.id === p.c);
    const component = target.components.find((c) => c.id === p.c);
    const item = board ?? component!;
    const dependency = target.dependencies.components.find((d) => d.ref === item.definition.ref && d.version === item.definition.version);
    const legs = stringLegs(p.legs);
    const seated = Object.keys(legs).length > 0;
    return {
      key: `place:${p.c}`,
      kind: 'place',
      needs: seated && surface ? [`place:${surface}`] : [],
      ops: (work) =>
        recipes.place(work, tView.id, board ? { kind: 'board', board } : { kind: 'component', component: component! }, p, dependency ? { dependency } : undefined),
      describe: () => {
        const refdes = item.refdes;
        const reason = board
          ? say(lang, 'reasonBoard', { refdes })
          : p.c === surface
            ? say(lang, 'reasonSurface')
            : seated
              ? say(lang, 'reasonSeated', { refdes, holes: Object.values(legs).join(', ') })
              : say(lang, 'reasonLoose', { refdes });
        const anchors: BoardTarget[] = surface ? Object.values(legs).map((hole) => ({ kind: 'hole', surface, hole })) : [];
        return { reason, label: say(lang, 'labelPlace', { refdes }), anchors, part: p.c };
      },
    };
  };

  const placements = tView.placements;
  for (const p of placements) if (boardIds.has(p.c)) out.push(place(p));
  for (const p of placements) if (p.c === surface) out.push(place(p));
  for (const p of placements) if (!boardIds.has(p.c) && p.c !== surface) out.push(place(p));

  const placed = new Set(placements.map((p) => p.c));
  for (const c of target.components) {
    if (!placed.has(c.id) && !doc.components.some((x) => x.id === c.id)) {
      unreachable.push({ key: `place:${c.id}`, why: say(lang, 'whyNotOnBench', { refdes: c.refdes }) });
    }
  }

  for (const w of tView.wires) {
    const from = targetOf(w.from);
    const to = targetOf(w.to);
    if (!from || !to) {
      unreachable.push({ key: `wire:${w.id}`, why: say(lang, 'whyRefused', { message: 'junction' }) });
      continue;
    }
    const needs = [...new Set([ownerOf(w.from)!, ownerOf(w.to)!])].map((c) => `place:${c}`);
    out.push({
      key: `wire:${w.id}`,
      kind: 'wire',
      needs,
      ops: (work) => recipes.wire(work, tView.id, w.from, w.to, { id: w.id, ...(w.color && { color: w.color }) }),
      describe: (work, after) => {
        const a = endLabel(work, endRef(w.from));
        const b = endLabel(work, endRef(w.to));
        const net = after.nets.find((n) => n.id === after.views.find((v) => v.id === tView.id)?.wires.find((x) => x.id === w.id)?.net);
        const key = net?.class === 'ground' ? 'reasonWireGround' : net?.class === 'power' ? 'reasonWirePower' : 'reasonWire';
        return { reason: say(lang, key, { from: a, to: b }), label: say(lang, 'labelWire', { from: a, to: b }), anchors: [from, to] };
      },
    });
  }
  return out;
}

/**
 * Pins on the bench the target joins that no step joined: one `connect` step per target net, for connections the
 * target holds but draws nowhere (no leg or wire makes them).
 */
function connectSteps(work: Project, target: Project, viewId: string, lang: Lang): Candidate[] {
  const present = new Set(work.views.find((v) => v.id === viewId)?.placements.map((p) => p.c));
  const netOf = new Map<string, Net>();
  for (const n of work.nets) for (const c of n.connections) netOf.set(pinKey(c), n);
  const out: Candidate[] = [];
  for (const t of target.nets) {
    const pins = t.connections.filter((c) => present.has(c.c));
    const loose = pins.filter((c) => !netOf.has(pinKey(c)));
    const homes = new Set(pins.flatMap((c) => netOf.get(pinKey(c))?.id ?? []));
    if (loose.length === 0 || homes.size > 1 || (homes.size === 0 && loose.length < 2)) continue;
    const home = [...homes][0];
    const name = t.name ?? t.id;
    out.push({
      key: `connect:${t.id}`,
      kind: 'connect',
      needs: [...new Set(pins.map((c) => `place:${c.c}`))],
      ops: (w): Op[] => {
        if (home !== undefined) return loose.map((pin): Op => ({ k: 'net.connect', net: home, pin }));
        return w.nets.some((n) => n.id === t.id) ? [] : [{ k: 'net.create', net: { ...t, connections: loose as Net['connections'] } }];
      },
      describe: () => ({
        reason: say(lang, 'reasonConnect', { net: name }),
        label: say(lang, 'labelConnect', { net: name }),
        anchors: loose.map((c) => ({ kind: 'pin', part: c.c, pin: c.p })),
      }),
    });
  }
  return out;
}

const isDone = (doc: Project, viewId: string, c: Candidate, target: Project): boolean => {
  const view = doc.views.find((v) => v.id === viewId);
  if (!view) return false;
  const [kind, id] = [c.key.slice(0, c.key.indexOf(':')), c.key.slice(c.key.indexOf(':') + 1)];
  if (kind === 'place') return view.placements.some((p) => p.c === id);
  if (kind === 'wire') {
    const w = target.views.find((v) => v.id === viewId)?.wires.find((x) => x.id === id);
    return view.wires.some((x) => x.id === id || (w !== undefined && sameEnds(x, w)));
  }
  return false;
};

let plans = 0;

/** The plan from `doc` to `target`. Steps already done on the bench are left out; declined ones and their dependents too. */
export function planBuild(doc: Project, target: Project, opts: PlanOptions): BuildPlan {
  const { lang, recipes } = opts;
  const id = opts.id ?? `prp_${(++plans).toString(36)}r${doc.revision}`;
  const unreachable: { key: string; why: string }[] = [];
  const tView = benchView(target);
  const base = { id, baseRevision: doc.revision, summary: say(lang, 'summary', { title: target.meta.title }) };
  if (!tView || !doc.views.some((v) => v.id === tView.id)) {
    return { ...base, steps: [], unreachable: [{ key: 'view', why: say(lang, 'whyNoView') }] };
  }

  const declined = new Set(opts.declined ?? []);
  const blocked = new Set<string>();
  const steps: PlanStep[] = [];
  let work = doc;

  const run = (c: Candidate) => {
    if (isDone(doc, tView.id, c, target)) return;
    if (declined.has(c.key) || c.needs.some((n) => blocked.has(n))) {
      blocked.add(c.key);
      if (!declined.has(c.key)) unreachable.push({ key: c.key, why: say(lang, 'whyNeeds') });
      return;
    }
    let ops: Op[];
    try {
      ops = adoptTargetNets(work, c.ops(work), target);
    } catch (err) {
      blocked.add(c.key);
      unreachable.push({ key: c.key, why: say(lang, 'whyRefused', { message: (err as Error).message }) });
      return;
    }
    const tried = tryOps(work, ops);
    if (!tried.ok) {
      blocked.add(c.key);
      unreachable.push({ key: c.key, why: say(lang, 'whyRefused', { message: tried.message }) });
      return;
    }
    if (ops.length === 0) return;
    const d = c.describe(work, tried.state);
    steps.push({ key: c.key, kind: c.kind, ops, reason: d.reason, label: d.label, anchors: d.anchors, needs: c.needs, ...(d.part && { part: d.part }) });
    work = tried.state;
  };

  for (const c of candidates(doc, target, tView, lang, recipes, unreachable)) run(c);
  for (const c of connectSteps(work, target, tView.id, lang)) run(c);
  return { ...base, steps, unreachable };
}

/** The scripted co-builder: no model, it builds the target of a `build` goal step by step. */
export function scriptedCoBuilder(opts: { actor?: string } = {}): CoBuilder {
  return {
    actor: opts.actor ?? 'usr_cobuilder',
    model: 'scripted@1',
    name: localized('name'),
    async propose({ doc, request, snapshot, recipes }) {
      if (request.goal.kind !== 'build') {
        return { id: `prp_${(++plans).toString(36)}r${doc.revision}`, baseRevision: doc.revision, summary: say(snapshot.lang, 'nothingLeft'), steps: [], unreachable: [] };
      }
      return planBuild(doc, request.goal.target, { lang: snapshot.lang, recipes, declined: request.declined });
    },
  };
}
