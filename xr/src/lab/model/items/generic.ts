/**
 * The stand-in for equipment the lab has no model for yet: a labelled box with the requested name. It has no actions
 * and makes no mistakes; the inventory hands it out flagged `placeholder` so a tutor can say so.
 */
import { defineItem } from '../types';

export const GENERIC_KIND = 'generic';

export const generic = defineItem({
  kind: GENERIC_KIND,
  lab: 'chemistry',
  foot: [120, 120, 120],
  params: {
    /** What was asked for, as the person said it. Any text: a host sets it at placement. */
    name: { values: ['item'] },
  },
  actions: {},
  mistakes: [],
});
