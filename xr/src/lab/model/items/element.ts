/**
 * An element sample from the periodic table panel (lab/elements): a small jar labelled with the element's symbol. It
 * has no actions yet; it is something to place, carry and talk about (the agent sees it in the lab snapshot).
 */
import { ELEMENTS } from '../../elements/data';
import { defineItem } from '../types';

export const ELEMENT_KIND = 'element-sample';

export const elementSample = defineItem({
  kind: ELEMENT_KIND,
  lab: 'chemistry',
  foot: [60, 60, 80],
  params: {
    symbol: { values: ELEMENTS.map((e) => e.symbol) },
  },
  actions: {},
  mistakes: [],
});
