import { describe, expect, test } from 'vitest';
import { menuHeight, pageItems, pagesOf, PAGE_SIZE, sortItems } from '../src/shell/menu/layout';
import { facingDot, otherHand, palmButtonAt, palmFacing } from '../src/shell/menu/palm';

const head = [0, 1.5, 0] as const;
const palm = [0, 1.3, -0.4] as const;
// From the palm to the head: up 0.2, back 0.4.
const toHead = (() => {
  const l = Math.hypot(0.2, 0.4);
  return [0, 0.2 / l, 0.4 / l] as const;
})();

describe('palm menu button', () => {
  test('shows when an open palm faces the head', () => {
    expect(facingDot(toHead, palm, head)).toBeCloseTo(1, 6);
    expect(palmFacing({ normal: toHead, palm, head, open: true, was: false })).toBe(true);
  });

  test('hides when the palm turns away', () => {
    const away = [0, -1, 0] as const;
    expect(palmFacing({ normal: away, palm, head, open: true, was: false })).toBe(false);
    expect(palmFacing({ normal: away, palm, head, open: true, was: true })).toBe(false);
  });

  test('hysteresis: between 0.4 and 0.6 it keeps its state', () => {
    // A normal 55 degrees off the direction to the head: dot about 0.57.
    const a = (55 * Math.PI) / 180;
    const perp = [0, -toHead[2], toHead[1]] as const;
    const n = [0, Math.cos(a) * toHead[1] + Math.sin(a) * perp[1], Math.cos(a) * toHead[2] + Math.sin(a) * perp[2]] as const;
    const dot = facingDot(n, palm, head);
    expect(dot).toBeGreaterThan(0.4);
    expect(dot).toBeLessThan(0.6);
    expect(palmFacing({ normal: n, palm, head, open: true, was: false })).toBe(false);
    expect(palmFacing({ normal: n, palm, head, open: true, was: true })).toBe(true);
  });

  test('needs an open hand held in reach', () => {
    expect(palmFacing({ normal: toHead, palm, head, open: false, was: true })).toBe(false);
    expect(palmFacing({ normal: toHead, palm: [0, 1.5, -1.5], head, open: true, was: false })).toBe(false);
    expect(palmFacing({ normal: toHead, palm: [0, 1.5, -0.05], head, open: true, was: false })).toBe(false);
  });

  test('the button floats 6 cm along the normal', () => {
    const p = palmButtonAt(palm, toHead);
    expect(Math.hypot(p[0] - palm[0], p[1] - palm[1], p[2] - palm[2])).toBeCloseTo(0.06, 6);
  });

  test('the other hand', () => {
    expect(otherHand('right')).toBe('left');
    expect(otherHand('left')).toBe('right');
  });
});

describe('menu layout', () => {
  test('groups in order bench, view, tools, stable inside a group', () => {
    const items = [
      { id: 'a', group: 'tools' as const },
      { id: 'b', group: 'bench' as const },
      { id: 'c', group: 'view' as const },
      { id: 'd', group: 'bench' as const },
    ];
    expect(sortItems(items).map((i) => i.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  test('pages of six, clamped', () => {
    const items = Array.from({ length: 14 }, (_, i) => i);
    expect(pagesOf(0)).toBe(1);
    expect(pagesOf(14)).toBe(3);
    expect(pageItems(items, 0)).toHaveLength(PAGE_SIZE);
    expect(pageItems(items, 2)).toEqual([12, 13]);
    expect(pageItems(items, 9)).toEqual([12, 13]);
  });

  test('the panel stays under 0.9 m with the most it ever shows, and does not change size between pages', () => {
    expect(menuHeight(5, 40)).toBeLessThan(900);
    expect(menuHeight(5, 7)).toBe(menuHeight(5, 40));
    expect(menuHeight(2, 0)).toBeLessThan(menuHeight(2, 3));
  });
});
