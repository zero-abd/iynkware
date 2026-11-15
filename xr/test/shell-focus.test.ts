import { describe, expect, test } from 'vitest';
import { claimFocus, onFocusLost } from '../src/shell/switch/focus';

describe('shell focus', () => {
  test('opening one panel closes the others, not itself', () => {
    const app = { world: {} };
    const closed: string[] = [];
    for (const n of ['home', 'menu', 'projects']) onFocusLost(app, n, () => closed.push(n));
    claimFocus(app, 'projects');
    expect(closed.sort()).toEqual(['home', 'menu']);
  });

  test('an unregistered panel is not closed, and apps do not share panels', () => {
    const a = { world: {} };
    const b = { world: {} };
    const closed: string[] = [];
    const off = onFocusLost(a, 'menu', () => closed.push('a/menu'));
    onFocusLost(b, 'menu', () => closed.push('b/menu'));
    claimFocus(a, 'home');
    off();
    claimFocus(a, 'home');
    expect(closed).toEqual(['a/menu']);
  });

  test('a closer that opens another panel does not loop', () => {
    const app = { world: {} };
    let n = 0;
    onFocusLost(app, 'home', () => {
      n++;
      claimFocus(app, 'home');
    });
    claimFocus(app, 'menu');
    expect(n).toBe(1);
  });
});
