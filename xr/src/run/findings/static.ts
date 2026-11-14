/**
 * Pure logic of the findings: which part a finding points at, how findings become pins, the order of severity, and the
 * debounce that spaces the static check after edits. Nothing here touches the scene, so it is tested in node.
 */
import type { ProblemTarget } from '@/sim/faults/types';
import type { Finding } from '../../contracts/sim';
import type { Project } from '../../contracts/project';
import { netlist } from '@/project/netlist';

export type Severity = Finding['severity'];

/** Where a pin came from: the static rules while editing, the run's rules at a pause or an end, a part that burnt. */
export type PinOrigin = 'static' | 'run' | 'burnt';

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = { error: 0, warning: 1, note: 2 };

/** Errors first, then warnings, then notes. Stable for equal severity. */
export function bySeverity(a: { severity: Severity }, b: { severity: Severity }): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
}

/** The callout tones of the look kit: an error fails, a warning warns, a note informs. */
export function toneOf(severity: Severity): 'fail' | 'warn' | 'info' {
  return severity === 'error' ? 'fail' : severity === 'warning' ? 'warn' : 'info';
}

/** The part (and pin) a target stands for in the document. */
export interface Place {
  readonly part: string;
  readonly pin?: string;
}

const isBoard = (doc: Project, id: string): boolean => doc.boards.some((b) => b.id === id);
const exists = (doc: Project, id: string): boolean => isBoard(doc, id) || doc.components.some((c) => c.id === id);

/** The pin to point at on a net: a part's pin before a board's, the first one otherwise. */
function placeOnConnections(doc: Project, pins: readonly { c: string; p: string }[]): Place | null {
  const known = pins.filter((p) => exists(doc, p.c));
  const pick = known.find((p) => !isBoard(doc, p.c) && !doc.components.find((c) => c.id === p.c)?.definition.ref.includes('breadboard')) ?? known[0];
  return pick ? { part: pick.c, pin: pick.p } : null;
}

/**
 * The part a finding's target is on, or null when it is not in the document (the finding is dropped, as the 2D
 * Studio does). A net or a wire is pointed at by one of its pins; a code file by the board that runs it.
 */
export function resolveTarget(doc: Project, t: ProblemTarget): Place | null {
  switch (t.kind) {
    case 'part':
      return exists(doc, t.id) ? { part: t.id } : null;
    case 'pin':
      return exists(doc, t.id) ? { part: t.id, ...(t.pin ? { pin: t.pin } : {}) } : null;
    case 'net': {
      const direct = doc.nets.find((n) => n.id === t.id);
      if (direct) return placeOnConnections(doc, direct.connections);
      // The rules name a net by the id of its node: a group of document nets joined by wires and shorts.
      const node = netlist(doc).nodes.find((n) => n.id === t.id);
      const nets = doc.nets.filter((n) => node?.nets.includes(n.id));
      return placeOnConnections(doc, nets.flatMap((n) => n.connections));
    }
    case 'wire': {
      const wire = doc.views.flatMap((v) => v.wires).find((w) => w.id === t.id);
      const net = wire && doc.nets.find((n) => n.id === wire.net);
      return net ? placeOnConnections(doc, net.connections) : null;
    }
    case 'file':
      return doc.boards[0] ? { part: doc.boards[0].id } : null;
    case 'hole':
    default:
      return null;
  }
}

/** One thing pinned on the bench: a finding, or a burnt part's reason. */
export interface PinSpec {
  /** Stable across checks, so a repeated finding keeps its pin. */
  readonly id: string;
  readonly severity: Severity;
  readonly origin: PinOrigin;
  readonly place: Place;
  /** The other parts the finding names (shown in the card, not pinned again). */
  readonly also: readonly string[];
  /** Present for a rule's finding. */
  readonly finding?: Finding;
  /** Present for a burnt part: the part and its reason from the analog latch. */
  readonly burnt?: { readonly part: string; readonly why: { key: string; args: Readonly<Record<string, string | number>> } };
}

/** The id of a finding: its rule and its targets, in a stable order. */
export function findingId(f: Pick<Finding, 'ruleId' | 'targets'>): string {
  return [f.ruleId, ...f.targets.map((t) => (t.pin === undefined ? t.id : `${t.id}/${t.pin}`)).sort()].join(':');
}

/** Findings as pins, most severe first. A finding with no target in the document is left out. */
export function pinsOf(doc: Project, findings: readonly Finding[], origin: 'static' | 'run'): PinSpec[] {
  const out: PinSpec[] = [];
  for (const finding of findings) {
    const places = finding.targets.map((t) => resolveTarget(doc, t)).filter((p): p is Place => p !== null);
    const place = places[0];
    if (!place) continue;
    out.push({
      id: findingId(finding),
      severity: finding.severity,
      origin,
      place,
      also: [...new Set(places.slice(1).map((p) => p.part).filter((p) => p !== place.part))],
      finding,
    });
  }
  return out.sort(bySeverity);
}

/** A burnt part as a pin; `name` is its refdes. */
export function burntPin(doc: Project, part: string, why: { key: string; args: Record<string, string | number> }): PinSpec | null {
  if (!exists(doc, part)) return null;
  const refdes = [...doc.boards, ...doc.components].find((c) => c.id === part)?.refdes ?? part;
  return { id: `burnt:${part}`, severity: 'error', origin: 'burnt', place: { part }, also: [], burnt: { part, why: { ...why, args: { ...why.args, name: refdes } } } };
}

/** The most pins shown at once: more would hide the bench. The most severe stay. */
export const MAX_PINS = 8;

/**
 * Every pin that should show now. A run finding replaces the static one with the same id (it has the numbers); a burnt
 * part comes first. Most severe first, cut at `MAX_PINS`.
 */
export function mergePins(...groups: readonly (readonly PinSpec[])[]): { shown: PinSpec[]; hidden: number } {
  // The same cause on the same part is one pin: the run's finding (it has the numbers) replaces the static one.
  const sameThing = (s: PinSpec): string => (s.finding ? `${s.finding.causeId}@${s.place.part}/${s.place.pin ?? ''}` : s.id);
  const byId = new Map<string, PinSpec>();
  const weight: Record<PinOrigin, number> = { static: 0, run: 1, burnt: 2 };
  for (const spec of groups.flat()) {
    const key = sameThing(spec);
    const had = byId.get(key);
    if (!had || weight[spec.origin] >= weight[had.origin]) byId.set(key, spec);
  }
  const all = [...byId.values()].sort((a, b) => bySeverity(a, b) || (a.origin === 'burnt' ? -1 : 0) - (b.origin === 'burnt' ? -1 : 0));
  return { shown: all.slice(0, MAX_PINS), hidden: Math.max(0, all.length - MAX_PINS) };
}

/** Pins on one anchor stack up: the slot of each pin among those that share its place, 0 for the first. */
export function stackSlots(specs: readonly PinSpec[]): Map<string, number> {
  const seen = new Map<string, number>();
  const slots = new Map<string, number>();
  for (const s of specs) {
    const key = `${s.place.part}/${s.place.pin ?? ''}`;
    const n = seen.get(key) ?? 0;
    slots.set(s.id, n);
    seen.set(key, n + 1);
  }
  return slots;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** The static check waits this long after the last edit. */
export const CHECK_DEBOUNCE_MS = 400;

export interface Debounced {
  /** Restarts the wait. */
  call(): void;
  /** Drops a wait in progress. */
  cancel(): void;
  readonly pending: boolean;
}

/** Runs `fn` once `ms` after the last `call`. */
export function createDebounce(fn: () => void, ms: number = CHECK_DEBOUNCE_MS, timers: Timers = realTimers): Debounced {
  let handle: unknown = null;
  return {
    call() {
      if (handle !== null) timers.clear(handle);
      handle = timers.set(() => {
        handle = null;
        fn();
      }, ms);
    },
    cancel() {
      if (handle !== null) timers.clear(handle);
      handle = null;
    },
    get pending() {
      return handle !== null;
    },
  };
}

/** Whether the static check should run now: never while the simulation runs. */
export function mayCheck(state: string): boolean {
  return state !== 'running';
}
