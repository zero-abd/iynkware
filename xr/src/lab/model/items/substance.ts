/**
 * A stock substance from the stockroom (lab/substances): a solution or liquid in a beaker, a solid in a dish, with its
 * formula on a tag. The agent's give_substance places one. No actions yet; pouring and reactions come next.
 */
import { SUBSTANCES } from '../../substances/data';
import { defineItem } from '../types';

export const SUBSTANCE_KIND = 'substance';

export const substance = defineItem({
  kind: SUBSTANCE_KIND,
  lab: 'chemistry',
  foot: [80, 80, 100],
  params: {
    substance: { values: SUBSTANCES.map((s) => s.id) },
  },
  actions: {},
  mistakes: [],
});
