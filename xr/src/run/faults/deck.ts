/**
 * The fault deck (docs/XR_DESIGN.md 6.5), pure so it is tested in node: one card per fault iynk's generators can make
 * on the build on the bench (`listCandidates`), kept only when the run would act on it. The bridge applies faults with
 * the same context (`xr/src/sim/faults.ts`), so a card always breaks what it says. Also: which faults are in, the
 * three choices of mystery mode, and the ops for inject, take back and reset.
 */
import type { PartRegistry } from '@/parts/registry';
import type { Fault, Op, Project } from '@/project/generated/types';
import { ENGINE_KINDS } from '@/sim/faults/apply';
import { breakOps, listCandidates, restoreOps, type FaultCandidate } from '@/sim/faults/generate';
import { buildNetView } from '@/sim/faults/netlist-view';
import { faultToOps } from '@/sim/faults/ops';
import type { CauseId, SymptomId } from '@/sim/faults/types';
import { buildSimNetlist } from '@/sim/netlist';
import { describeWith, faultCtxOf } from '../../sim/faults';

export interface Card {
  /** The fault's id (`flt_part-fault_cmp_led1_...`); also the card's id. */
  readonly id: string;
  readonly fault: Fault;
  readonly causeId: CauseId;
  readonly symptomId: SymptomId | null;
  readonly kind: Fault['kind'];
  /** The part it breaks, and the pin or parameter when it names one. */
  readonly part: string;
  readonly pin?: string;
  /** `x10`, `x0.1` for a wrong value. */
  readonly factor?: number;
}

const sourcesOf = (doc: Project): Record<string, string> => Object.fromEntries(doc.sources.map((s) => [s.path, s.content]));

const sameFault = (a: Fault, b: Fault) => a.kind === b.kind && JSON.stringify(a.target) === JSON.stringify(b.target) && JSON.stringify(a.params ?? {}) === JSON.stringify(b.params ?? {});

function cardOf(c: FaultCandidate): Card {
  const params = (c.fault.params ?? {}) as Record<string, unknown>;
  const factor = typeof params.factor === 'number' ? params.factor : undefined;
  const part = c.label.part ?? c.fault.target.component ?? '';
  return {
    id: c.fault.id,
    fault: c.fault,
    causeId: c.causeId,
    symptomId: c.symptomIds[0] ?? null,
    kind: c.fault.kind,
    part,
    ...(c.label.pin !== undefined && c.fault.kind !== 'wrong-value' ? { pin: c.label.pin } : {}),
    ...(factor !== undefined ? { factor } : {}),
  };
}

/** Failure modes iynk's generators do not make: a dead part (every pin open) and a short across a two-pin part. */
function extraCandidates(net: ReturnType<typeof buildSimNetlist>['net']): FaultCandidate[] {
  const out: FaultCandidate[] = [];
  for (const p of net.parts) {
    if (p.kind === 'board' || p.id.startsWith('fault_')) continue;
    const slug = p.id.toLowerCase().replace(/[^a-z0-9]/g, '-');
    out.push({
      generator: 'part-fault',
      causeId: 'part-not-powered',
      symptomIds: ['part-dead'],
      family: 'wiring',
      label: { part: p.id },
      fault: { id: `flt_part-fault_${slug}_dead`, cause_id: 'part-not-powered', symptom_ids: ['part-dead'], kind: 'missing-part', target: { component: p.id }, enabled: true },
    });
    // One pin on each of the part's two nets: a short across the part takes its current.
    const byNet = new Map<string, string>();
    for (const [pin, n] of Object.entries(p.pins)) if (n !== null && !byNet.has(n)) byNet.set(n, pin);
    if (byNet.size === 2) {
      const [a, b] = [...byNet.values()].sort();
      out.push({
        generator: 'part-fault',
        causeId: 'supply-shorted-to-ground',
        symptomIds: ['part-dead'],
        family: 'wiring',
        label: { part: p.id },
        fault: {
          id: `flt_part-fault_${slug}_short`,
          cause_id: 'supply-shorted-to-ground',
          symptom_ids: ['part-dead'],
          kind: 'short',
          target: { component: p.id },
          params: { pins: [{ c: p.id, p: a! }, { c: p.id, p: b! }] },
          enabled: true,
        },
      });
    }
  }
  return out;
}

/**
 * Every card for `doc`: faults the run acts on (their ops are all structural: open, short, swap, value, polarity, a
 * pin in the sketch), one per distinct fault, none the project already holds, in a stable order.
 */
export function deckOf(doc: Project, registry: Pick<PartRegistry, 'get' | 'latest'>): Card[] {
  const { net } = buildSimNetlist(doc, registry as PartRegistry);
  const view = buildNetView(net, describeWith(registry));
  const ctx = faultCtxOf(view, registry, doc);
  const held = doc.simulation.faults;
  const kept: FaultCandidate[] = [];
  for (const c of [...listCandidates(doc, view, sourcesOf(doc)), ...extraCandidates(net)]) {
    const ops = faultToOps(c.fault, ctx);
    if (!ops.ok || ops.value.length === 0 || ops.value.some((op) => ENGINE_KINDS.has(op.kind))) continue;
    if (held.some((f) => f.id === c.fault.id || sameFault(f, c.fault))) continue;
    if (kept.some((k) => sameFault(k.fault, c.fault))) continue;
    kept.push(c);
  }
  return kept.map(cardOf).sort((a, b) => (a.part === b.part ? (a.id < b.id ? -1 : 1) : a.part < b.part ? -1 : 1));
}

/** The faults the lab put in (iynk's generators name them `flt_<generator>_...`) and that are switched on. */
export function activeOf(doc: Project): Fault[] {
  return doc.simulation.faults.filter((f) => f.enabled && /^flt_(?:open-wire|swap-pins|wrong-value|missing-ground|wrong-pin-in-code|reverse-part|part-fault)_/.test(f.id));
}

/** Inject: one `fault.set` (one undo). Fails when the project already holds it. */
export function injectOps(doc: Project, card: Card): Op[] | null {
  const r = breakOps(doc, { generator: 'part-fault', causeId: card.causeId, symptomIds: card.symptomId ? [card.symptomId] : [], family: 'wiring', fault: card.fault, label: { part: card.part } });
  return r.ok ? r.value : null;
}

/** Take back one fault (what if): removed when the lab made it. */
export const takeBackOps = (doc: Project, faultId: string): Op[] => restoreOps(doc, faultId);

/** Reset faults: every fault the lab put in, out in one batch (one undo); the circuit stays as drawn. */
export const resetOps = (doc: Project): Op[] => activeOf(doc).flatMap((f) => restoreOps(doc, f.id));

/** A small deterministic generator (mulberry32) so the same fault always shows its choices in the same order. */
function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/** Causes a mystery choice can name when the deck is short of others. */
const FALLBACK: readonly CauseId[] = ['open-connection', 'wrong-value', 'led-reversed', 'wrong-pin-in-code', 'missing-ground', 'swapped-pins'];

/** Mystery mode: the answer and two other causes, in an order seeded by the fault's id. */
export function choicesFor(answer: CauseId, faultId: string, deck: readonly Card[]): CauseId[] {
  const others: CauseId[] = [];
  for (const c of [...deck.map((d) => d.causeId), ...FALLBACK]) {
    if (c !== answer && !others.includes(c)) others.push(c);
    if (others.length === 2) break;
  }
  const out = [answer, ...others];
  const r = rand(hash(faultId));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
