/**
 * `propose_edit`: bench edits the companion names in bench words ("move LED1 to e12", "wire U1.D13 to a10"), run as a
 * "Build it with me" session with a co-builder of their own (`createEditBuilder`). So every edit is first a ghost on
 * the bench (the visual cue), then performed only when the person accepts, by voice or on the card, on the
 * companion's own undo stack. If the person makes the move themselves, the session plans again and the edit counts
 * as done (`isDone`), so the same steps guide by hand or act for them.
 *
 * Each step's ops come from the bench's build actions (the ops the person's hands make), worked out in order on a
 * dry run of the document, so a later step sees the earlier ones. Pure over the document: tested headless.
 */
import { applyBatch } from '@/project/apply';
import type { Author } from '@/project/apply';
import type { Rotation } from '@/studio/engine/types';
import type { WireEndRef } from '@/studio/rules/connect';
import { resolvePart } from '@/studio/parts-view';
import type { PartRegistry } from '@/parts/registry';
import { localized } from '../../assistant/copy';
import { addWire, breadboardViewOf, pullPart, removePart, removeWire, seatPart, turnPart } from '../../bench/core/actions';
import type { ActionEnv, ActionResult } from '../../bench/core/actions';
import type { BuildPlan, CoBuilder, PlanStep, PlanStepKind } from '../../contracts/assistant';
import type { Op, Project } from '../../contracts/project';
import type { BoardTarget } from '../../contracts/space';

export const EDIT_ACTIONS = ['move', 'place', 'turn', 'pull', 'remove', 'wire', 'unwire'] as const;
export type EditAction = (typeof EDIT_ACTIONS)[number];

/** One edit as the companion names it. `part` is a refdes (or, for `place`, a part definition ref); ends and holes are `REF.PIN` or a hole like `e12`. */
export interface EditSpec {
  readonly action: EditAction;
  readonly part?: string;
  /** `move`, `place`: the hole the part's first leg goes in. `wire`, `unwire`: the second end. */
  readonly to?: string;
  /** `wire`, `unwire`: the first end. */
  readonly from?: string;
  /** `turn` (and optionally `place`): the rotation to end at, 0, 90, 180 or 270. */
  readonly deg?: number;
  /** Why, in one short sentence in the person's language; shown on the card. */
  readonly reason?: string;
}

type Compiled =
  | { ok: true; ops: Op[]; label: string; kind: PlanStepKind; part?: string; anchors: BoardTarget[] }
  | { ok: false; why: string };

const DRY_RUN_AUTHOR = { actor: 'usr_companion', kind: 'ai' } as Author;

const placedItems = (doc: Project) => {
  const view = breadboardViewOf(doc);
  const placed = new Set((view?.placements ?? []).map((p) => p.c));
  return [...doc.boards, ...doc.components].filter((x) => placed.has(x.id));
};

/** A part on the bench by refdes (any case) or entity id. */
export function partIdOf(doc: Project, spec: string | undefined): string | null {
  if (!spec) return null;
  const s = spec.trim().toLowerCase();
  return placedItems(doc).find((x) => x.id.toLowerCase() === s || x.refdes?.toLowerCase() === s)?.id ?? null;
}

/** A pin name as people say it, folded: `+5V` is `5V`, `3.3V` and `3V3` are `3V3`. */
const pinKey = (s: string): string => {
  const k = s.toUpperCase().replace(/[^A-Z0-9.]/g, '');
  const volts = /^(\d+)\.(\d+)V?$/.exec(k);
  return volts ? `${volts[1]}V${volts[2]}` : k.replace(/\./g, '');
};

/** The pin ids of a part on the bench. */
export function pinsOf(doc: Project, id: string, registry?: PartRegistry): string[] {
  const item = [...doc.boards, ...doc.components].find((x) => x.id === id);
  if (!item) return [];
  const shape = registry ? resolvePart(doc, item.definition.ref, registry) : resolvePart(doc, item.definition.ref);
  return shape.pins.map((p) => p.id);
}

/**
 * `REF.PIN` as a pin end, else a hole name on the breadboard's surface. A pin matches its id in any case or the way
 * people say it: `5V` and `+5V` find `P5V`, `3.3V` finds `P3V3`.
 */
export function endOf(doc: Project, spec: string | undefined, registry?: PartRegistry): WireEndRef | null {
  if (!spec) return null;
  const s = spec.trim();
  for (let dot = s.indexOf('.'); dot > 0; dot = s.indexOf('.', dot + 1)) {
    const id = partIdOf(doc, s.slice(0, dot));
    if (!id) continue;
    const want = pinKey(s.slice(dot + 1));
    const pins = pinsOf(doc, id, registry);
    const pin = pins.find((p) => pinKey(p) === want) ?? pins.find((p) => pinKey(p) === `P${want}`);
    return pin ? { kind: 'pin', c: id, p: pin } : null;
  }
  const surface = breadboardViewOf(doc)?.surface;
  return surface && /^[a-z]+\d+$/i.test(s) ? { kind: 'hole', surface, hole: s.toLowerCase() } : null;
}

/** Why an end did not resolve, with the pins it could have meant. */
function missingEnd(doc: Project, spec: string | undefined, registry?: PartRegistry): string {
  const s = (spec ?? '').trim();
  const dot = s.indexOf('.');
  const id = dot > 0 ? partIdOf(doc, s.slice(0, dot)) : null;
  if (id) return `no pin "${s.slice(dot + 1)}" on ${s.slice(0, dot)}; its pins: ${pinsOf(doc, id, registry).filter((p) => !/^ICSP|^NC$|^POWER_/.test(p)).join(', ')}`;
  return `no pin or hole "${s}" on the bench (a pin is REF.PIN, a hole is like e12)`;
}

const targetOf = (end: WireEndRef): BoardTarget =>
  end.kind === 'pin' ? { kind: 'pin', part: end.c, pin: end.p } : { kind: 'hole', surface: end.surface, hole: end.hole };

type DocEnd = { kind: string; c?: string; p?: string; surface?: string; hole?: string };
const sameEnd = (a: DocEnd, b: WireEndRef): boolean =>
  a.kind === b.kind && (b.kind === 'pin' ? a.c === b.c && a.p === b.p : a.surface === b.surface && a.hole === b.hole);

/** The bench wire between two ends, in either direction. */
function wireBetween(doc: Project, a: WireEndRef, b: WireEndRef): string | null {
  const wires = (breadboardViewOf(doc)?.wires ?? []) as ReadonlyArray<{ id: string; from: DocEnd; to: DocEnd }>;
  return wires.find((w) => (sameEnd(w.from, a) && sameEnd(w.to, b)) || (sameEnd(w.from, b) && sameEnd(w.to, a)))?.id ?? null;
}

const placementOf = (doc: Project, id: string) => breadboardViewOf(doc)?.placements.find((p) => p.c === id);
/** A rotation to the nearest quarter turn, or null when there is none. */
const quarter = (deg: number | undefined): Rotation | null => {
  if (deg === undefined || !Number.isFinite(deg)) return null;
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as Rotation;
};
const sameSeat = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const fromAction = (r: ActionResult<object>, kind: PlanStepKind, anchors: BoardTarget[], part?: string): Compiled =>
  r.ok ? { ok: true, ops: r.ops, label: r.label, kind, anchors, ...(part && { part }) } : { ok: false, why: `${r.reason} ${JSON.stringify(r.args)}` };

/** The ops for one edit on `doc`, or why it cannot be done there. */
export function compileEdit(doc: Project, e: EditSpec, env: ActionEnv = {}): Compiled {
  const surface = breadboardViewOf(doc)?.surface;
  switch (e.action) {
    case 'move':
    case 'place': {
      if (!e.to || !surface) return { ok: false, why: 'needs a hole to go to (to: "e12")' };
      const hole = e.to.trim().toLowerCase();
      const anchors: BoardTarget[] = [{ kind: 'hole', surface, hole }];
      if (e.action === 'move') {
        const id = partIdOf(doc, e.part);
        if (!id) return { ok: false, why: `no part "${e.part}" on the bench` };
        const rotation = quarter(e.deg) ?? quarter(placementOf(doc, id)?.rotation_deg ?? 0) ?? 0;
        const r = seatPart(doc, { part: id, fit: { anchorHole: hole, rotation } }, env);
        return r.ok ? fromAction(r, 'place', anchors, id) : fromAction(r, 'place', anchors);
      }
      const ref = e.part?.trim();
      if (!ref) return { ok: false, why: 'needs a part definition ref (part: "core.led-5mm")' };
      const r = seatPart(doc, { ref, fit: { anchorHole: hole, rotation: quarter(e.deg) ?? 0 } }, env);
      return r.ok ? fromAction(r, 'place', anchors, r.id) : fromAction(r, 'place', anchors);
    }
    case 'turn':
    case 'pull':
    case 'remove': {
      const id = partIdOf(doc, e.part);
      if (!id) return { ok: false, why: `no part "${e.part}" on the bench` };
      const anchors: BoardTarget[] = [{ kind: 'part', part: id }];
      if (e.action === 'turn') {
        const deg = quarter(e.deg);
        if (deg === null) return { ok: false, why: 'needs deg: 0, 90, 180 or 270' };
        return fromAction(turnPart(doc, { part: id, deg }, env), 'set', anchors);
      }
      return fromAction(e.action === 'pull' ? pullPart(doc, { part: id }, env) : removePart(doc, { part: id }, env), 'set', anchors);
    }
    case 'wire':
    case 'unwire': {
      const a = endOf(doc, e.from, env.registry);
      const b = endOf(doc, e.to, env.registry);
      if (!a || !b) return { ok: false, why: missingEnd(doc, !a ? e.from : e.to, env.registry) };
      if (e.action === 'wire') return fromAction(addWire(doc, { from: a, to: b }, env), 'wire', [targetOf(a), targetOf(b)]);
      const wire = wireBetween(doc, a, b);
      if (!wire) return { ok: false, why: `no wire from ${e.from} to ${e.to}` };
      return fromAction(removeWire(doc, { wire }, env), 'set', [{ kind: 'wire', wire }]);
    }
  }
}

/**
 * Whether the bench already shows this edit (the person did it, or it was performed). `start` is the bench when the
 * edits were first planned: a remove or an unwire is done only if what it takes away was there then.
 */
export function isDone(doc: Project, e: EditSpec, env: ActionEnv = {}, start: Project = doc): boolean {
  switch (e.action) {
    case 'move': {
      const id = partIdOf(doc, e.part);
      const now = id && placementOf(doc, id);
      if (!id || !now || !e.to) return false;
      const c = compileEdit(doc, e, env);
      if (!c.ok) return Object.values(now.legs ?? {}).includes(e.to.trim().toLowerCase());
      const next = c.ops.find((op): op is Extract<Op, { k: 'view.place' }> => op.k === 'view.place' && op.placement.c === id);
      return !next || sameSeat({ ...next.placement }, { ...now });
    }
    case 'place': {
      const ref = e.part?.trim();
      const hole = e.to?.trim().toLowerCase();
      if (!ref || !hole) return false;
      return placedItems(doc).some((x) => (x.definition.ref === ref || x.definition.ref === `core.${ref}`) && Object.values(placementOf(doc, x.id)?.legs ?? {}).includes(hole));
    }
    case 'turn': {
      const id = partIdOf(doc, e.part);
      const deg = quarter(e.deg);
      return !!id && deg !== null && quarter(placementOf(doc, id)?.rotation_deg ?? 0) === deg;
    }
    case 'pull': {
      const id = partIdOf(doc, e.part);
      return !!id && placementOf(doc, id)?.legs === undefined;
    }
    case 'remove':
      return partIdOf(start, e.part) !== null && partIdOf(doc, e.part) === null;
    case 'wire':
    case 'unwire': {
      const a = endOf(doc, e.from, env.registry);
      const b = endOf(doc, e.to, env.registry);
      if (!a || !b) return false;
      const there = wireBetween(doc, a, b) !== null;
      if (e.action === 'wire') return there;
      const s = endOf(start, e.from, env.registry);
      const t = endOf(start, e.to, env.registry);
      return !there && !!s && !!t && wireBetween(start, s, t) !== null;
    }
  }
}

/** A step key stable across re-plans, so a declined edit stays declined. */
export const editKey = (i: number, e: EditSpec): string => `edit:${i}:${e.action}:${e.part ?? e.from ?? ''}:${e.to ?? ''}`;

/**
 * The plan for the edits not yet on the bench: each one dry-run in order, so later edits see the earlier ones. `start`
 * is the bench when the edits were first planned (see `isDone`).
 */
export function planEdits(
  doc: Project,
  edits: readonly EditSpec[],
  summary: string,
  declined: readonly string[] = [],
  env: ActionEnv = {},
  start: Project = doc,
): BuildPlan {
  let working = doc;
  const steps: PlanStep[] = [];
  const unreachable: { key: string; why: string }[] = [];
  edits.forEach((e, i) => {
    const key = editKey(i, e);
    if (declined.includes(key) || isDone(working, e, env, start)) return;
    const c = compileEdit(working, e, env);
    if (!c.ok) return void unreachable.push({ key, why: c.why });
    const applied = applyBatch(working, c.ops, { author: DRY_RUN_AUTHOR, at: new Date().toISOString() });
    if (!applied.ok) return void unreachable.push({ key, why: applied.reject.message });
    working = applied.state;
    steps.push({ key, kind: c.kind, ops: c.ops, reason: e.reason?.trim() || c.label, label: c.label, anchors: c.anchors, needs: [], ...(c.part && { part: c.part }) });
  });
  const id = `prp_${Math.random().toString(36).slice(2, 12)}`;
  return { id, baseRevision: doc.revision, summary, steps, unreachable };
}

/** A co-builder that proposes exactly these edits, re-planned against the bench every time it is asked. */
export function createEditBuilder(edits: readonly EditSpec[], summary: string, env: ActionEnv = {}): CoBuilder {
  let start: Project | null = null;
  return {
    actor: 'usr_cobuilder',
    model: 'agent-edit@1',
    name: localized('name'),
    propose: async (ctx) => planEdits(ctx.doc, edits, summary, ctx.request.declined, env, (start ??= ctx.doc)),
  };
}
