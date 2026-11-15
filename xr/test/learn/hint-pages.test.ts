import { describe, expect, it } from 'vitest';
import { clampPage, hintPaging, pageRange } from '../../src/learn/lessons/panel/hint-pages';

describe('hint paging', () => {
  it('keeps a hint that fits as one page without controls', () => {
    expect(hintPaging(3, 3, 2)).toEqual({ pages: 1, perPage: 3, paged: false });
    expect(hintPaging(1, 0, 0)).toEqual({ pages: 1, perPage: 1, paged: false });
  });
  it('pages a hint that does not fit, by the lines left after the control row', () => {
    const p = hintPaging(7, 3, 2);
    expect(p).toEqual({ pages: 4, perPage: 2, paged: true });
    expect(pageRange(p, 0, 7)).toEqual([0, 2]);
    expect(pageRange(p, 3, 7)).toEqual([6, 7]);
  });
  it('shows at least one line per page and clamps the page', () => {
    const p = hintPaging(4, 0, -3);
    expect(p).toEqual({ pages: 4, perPage: 1, paged: true });
    expect(clampPage(9, p.pages)).toBe(3);
    expect(clampPage(-2, p.pages)).toBe(0);
    expect(pageRange(p, 99, 4)).toEqual([3, 4]);
  });
  it('covers every line exactly once', () => {
    const p = hintPaging(11, 4, 3);
    const seen: number[] = [];
    for (let i = 0; i < p.pages; i++) {
      const [a, b] = pageRange(p, i, 11);
      for (let j = a; j < b; j++) seen.push(j);
    }
    expect(seen).toEqual(Array.from({ length: 11 }, (_, i) => i));
  });
});
