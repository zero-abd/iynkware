import { describe, expect, test } from 'vitest';
import { noteOf, pageOf, pagesOf, PAGE_SIZE } from '../src/shell/projects/layout';

describe('projects panel layout', () => {
  test('pages hold five rows and clamp', () => {
    const rows = Array.from({ length: 12 }, (_, i) => i);
    expect(PAGE_SIZE).toBe(5);
    expect(pagesOf(0)).toBe(1);
    expect(pagesOf(12)).toBe(3);
    expect(pageOf(rows, 0).rows).toEqual([0, 1, 2, 3, 4]);
    expect(pageOf(rows, 2).rows).toEqual([10, 11]);
    expect(pageOf(rows, 9).page).toBe(2);
    expect(pageOf(rows, -1).page).toBe(0);
    expect(pageOf([], 3)).toEqual({ page: 0, pages: 1, rows: [] });
  });

  test('the note over the list says the storage state, then empty, then the kicker', () => {
    expect(noteOf(null, 0)).toBe('unavailable');
    expect(noteOf('unavailable', 3)).toBe('unavailable');
    expect(noteOf('full', 3)).toBe('full');
    expect(noteOf('loading', 0)).toBe('loading');
    expect(noteOf('ok', 0)).toBe('empty');
    expect(noteOf('ok', 2)).toBe('yours');
  });
});
