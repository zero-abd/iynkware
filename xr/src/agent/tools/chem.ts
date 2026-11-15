/**
 * The agent's stockroom: `give_substance` puts a classroom substance on the chemistry bench, a solution or liquid in a
 * beaker and a solid in a dish (lab/substances), or an element sample for a symbol ("Na"). It opens the chemistry lab
 * first when another bench is up, and refuses what the stockroom does not have, naming what it does.
 */
import { elementBySymbol } from '../../lab/elements/data';
import { sampleSpot } from '../../lab/elements';
import { ELEMENT_KIND } from '../../lab/model/items/element';
import { SUBSTANCE_KIND } from '../../lab/model/items/substance';
import { containerOf, findSubstance, SUBSTANCES } from '../../lab/substances/data';
import type { Args, ToolHost, ToolResult } from './catalog';

const fail = (error: string, extra: Record<string, unknown> = {}): ToolResult => ({ ok: false, error, ...extra });

/** Where the next substance lands, millimetres in the table frame: two rows at the front right, filled in order. */
export function substanceSpot(n: number): { x: number; z: number; yaw: number } {
  const i = n % 8;
  return { x: 40 + (i % 4) * 85, z: 110 + Math.floor(i / 4) * 85, yaw: 0 };
}

export const CHEM_RUNS: Readonly<Record<string, (h: ToolHost, a: Args) => Promise<ToolResult> | ToolResult>> = {
  async give_substance(h, a) {
    const lab = h.lab();
    if (!lab) return fail('the lab is not available');
    const asked = String(a.name ?? '').trim();
    // a bare symbol ("Na", "Cu") is the element; anything else is looked up in the stockroom first
    const symbol = /^[A-Z][a-z]?$/.test(asked) ? elementBySymbol(asked) : undefined;
    const substance = symbol ? null : findSubstance(asked);
    const element = symbol ?? (substance ? null : elementBySymbol(asked));
    if (!substance && !element) {
      return fail(`the stockroom has no "${asked}"`, { stock: SUBSTANCES.map((s) => `${s.name} (${s.formula})`), elements: 'any element by its symbol, e.g. Na, Cu, S' });
    }
    if (lab.store.lab !== 'chemistry') {
      const ok = h.nav ? await h.nav.go({ kind: 'lab', lab: 'chemistry' }) : (lab.open('chemistry'), true);
      if (!ok || (lab.store.lab as string | null) !== 'chemistry') return fail('could not open the chemistry lab');
    }
    if (element) {
      const n = lab.store.items().filter((i) => i.kind === ELEMENT_KIND).length;
      const id = lab.store.place(ELEMENT_KIND, sampleSpot(n), { params: { symbol: element.symbol }, label: element.symbol });
      return { ok: true, id, gave: element.symbol, container: 'jar', state: element.phase };
    }
    const s = substance!;
    const n = lab.store.items().filter((i) => i.kind === SUBSTANCE_KIND).length;
    const id = lab.store.place(SUBSTANCE_KIND, substanceSpot(n), { params: { substance: s.id }, label: s.id });
    return { ok: true, id, gave: s.name, formula: s.formula, container: containerOf(s), hazard: s.hazard };
  },
};

export const CHEM_KINDS = { give_substance: 'act' } as const;
