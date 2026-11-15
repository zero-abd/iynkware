/** The periodic table data (src/lab/elements/data.ts) and the Elements panel's strings and sample spots. */
import { describe, expect, it } from 'vitest';
import { elementBySymbol, ELEMENTS } from '../../src/lab/elements/data';
import { ELEMENTS_TEXT, sampleSpot } from '../../src/lab/elements';
import { createLabContext } from '../../src/lab/context';
import { ELEMENT_KIND } from '../../src/lab/model/items/element';
import { l6Problems } from '../../src/lab/text';

describe('periodic table', () => {
  it('has 118 elements, each in its own cell of the usual layout', () => {
    expect(ELEMENTS).toHaveLength(118);
    expect(new Set(ELEMENTS.map((e) => `${e.row}:${e.col}`)).size).toBe(118);
    const at = (s: string) => {
      const e = elementBySymbol(s)!;
      return [e.row, e.col];
    };
    expect(at('H')).toEqual([1, 1]);
    expect(at('He')).toEqual([1, 18]);
    expect(at('B')).toEqual([2, 13]);
    expect(at('Fe')).toEqual([4, 8]);
    expect(at('La')).toEqual([9, 3]);
    expect(at('Lu')).toEqual([9, 17]);
    expect(at('Hf')).toEqual([6, 4]);
    expect(at('Lr')).toEqual([10, 17]);
    expect(at('Og')).toEqual([7, 18]);
    expect(elementBySymbol('Hg')!.phase).toBe('liquid');
    expect(elementBySymbol('Cl')!).toEqual(expect.objectContaining({ family: 'halogen', phase: 'gas' }));
    expect(elementBySymbol('Na')!.family).toBe('alkali');
  });

  it('a sample is a lab item the store places, at spots on the bench', () => {
    const lab = createLabContext(() => 'en');
    lab.open('chemistry');
    const id = lab.store.place(ELEMENT_KIND, sampleSpot(0), { params: { symbol: 'Na' }, label: 'Na' });
    expect(lab.store.get(id)).toEqual(expect.objectContaining({ kind: ELEMENT_KIND, label: 'Na' }));
    for (let n = 0; n < 15; n++) {
      const p = sampleSpot(n);
      expect(Math.abs(p.x)).toBeLessThan(450);
      expect(Math.abs(p.z)).toBeLessThan(250);
    }
    expect(l6Problems(ELEMENTS_TEXT)).toEqual([]);
  });
});
