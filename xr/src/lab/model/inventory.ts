/**
 * What equipment the lab has, and asking for an item by kind or by name in any of the six languages. An unknown
 * request comes back as the generic stand-in (a labelled box, `placeholder: true`, `generated: false`: nobody made a
 * model of it) so an assistant can say "I do not have a pH meter model yet, here is a stand-in" and still put it down.
 *
 *   inventory.request('scope')            // { found: true, kind: 'oscilloscope' }
 *   inventory.request('Abzugshaube')       // { found: false, kind: 'generic', name: 'Abzugshaube', placeholder: true, ... }
 */
import { LANGS } from '../../contracts/common';
import { NOTES } from './catalogue';
import { GENERIC_KIND } from './items/generic';
import { KINDS, MODELS } from './registry';
import type { LabId } from './types';

export type InventoryAnswer =
  | { readonly found: true; readonly kind: string; readonly lab: LabId }
  | { readonly found: false; readonly kind: typeof GENERIC_KIND; readonly name: string; readonly generated: false; readonly placeholder: true };

export interface LabInventory {
  kinds(): readonly string[];
  has(kind: string): boolean;
  request(kindOrName: string): InventoryAnswer;
}

/** Everyday names people use, beyond the catalogue's own. */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  'bunsen-burner': ['burner', 'bunsen', 'gas burner'],
  'beaker-250': ['beaker', 'glass'],
  'erlenmeyer-250': ['flask', 'conical flask', 'erlenmeyer'],
  'flame-test-kit': ['flame test', 'nichrome loop', 'loop', 'salts'],
  'ph-meter': ['ph', 'ph probe', 'ph sensor'],
  'bench-power-supply': ['power supply', 'psu', 'supply', 'dc supply'],
  'soldering-station': ['soldering iron', 'iron', 'solder'],
  'pendulum-stand': ['pendulum', 'retort stand'],
  'function-generator': ['signal generator', 'generator', 'funcgen'],
  oscilloscope: ['scope', 'cro', 'dso'],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, ' ');

export function createInventory(): LabInventory {
  const names = new Map<string, string>();
  for (const kind of KINDS) {
    names.set(norm(kind), kind);
    for (const a of ALIASES[kind] ?? []) names.set(norm(a), kind);
    const n = NOTES[kind]?.name;
    if (n) for (const l of LANGS) names.set(norm(n[l]), kind);
  }
  return {
    kinds: () => KINDS,
    has: (kind) => KINDS.includes(kind),
    request(kindOrName) {
      const kind = names.get(norm(kindOrName));
      if (kind) return { found: true, kind, lab: MODELS[kind]!.lab };
      return { found: false, kind: GENERIC_KIND, name: kindOrName.trim(), generated: false, placeholder: true };
    },
  };
}
