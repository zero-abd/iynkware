/**
 * A steel spatula for solids: pick it up, dip its blade into a dish of a solid or an element jar to take a scoop, and
 * tip it over a beaker or flask to add it (`items/hands.ts` decides where the blade is; the vessel records it with its
 * own `add` action). It holds one scoop at a time; scooping again from another container swaps what it carries.
 */
import { defineItem, type Draft, type LabAction } from '../types';

export const SPATULA_KIND = 'spatula';

export const spatula = defineItem({
  kind: SPATULA_KIND,
  lab: 'chemistry',
  foot: [160, 30, 20],
  params: {},
  init: () => ({ load: '' }),
  actions: {
    /** Takes a scoop of `value` (a substance id or an element symbol). */
    scoop: (d, a) => {
      if (typeof a.value !== 'string' || !a.value) return 'bad-value';
      d.s.load = a.value;
    },
    /** Tips the scoop out (into whatever is under it). */
    tip: (d) => {
      d.s.load = '';
    },
  },
  mistakes: [],
  report: ({ s }) => ({ load: (s.load as string) || null }),
});

/** Most solids a vessel remembers, oldest dropped first. */
const ADDED_MAX = 8;

/** A vessel's `add`: a scoop of a solid tipped in from the spatula. Recorded (newest last), no reaction yet. */
export function addSolid(d: Draft, a: LabAction): string | void {
  if (typeof a.value !== 'string' || !a.value) return 'bad-value';
  const list = d.s.added ? String(d.s.added).split(',') : [];
  list.push(a.value);
  d.s.added = list.slice(-ADDED_MAX).join(',');
}
