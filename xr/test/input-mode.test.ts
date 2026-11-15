/** The quick input switch's pure parts: what each mode ignores, what B toggles to, the lines. */
import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/contracts/common';
import { MODE_LINES, blocks, toggled, modeLine } from '../src/input/mode';

describe('input mode switch', () => {
  it('auto ignores nothing', () => {
    expect(blocks('auto', 'hand')).toBe(false);
    expect(blocks('auto', 'controller')).toBe(false);
  });
  it('controllers only ignores hands, hands ignores controllers', () => {
    expect(blocks('controllers', 'hand')).toBe(true);
    expect(blocks('controllers', 'controller')).toBe(false);
    expect(blocks('hands', 'controller')).toBe(true);
    expect(blocks('hands', 'hand')).toBe(false);
    expect(blocks('hands', null)).toBe(false);
  });
  it('B turns hands off first, then toggles', () => {
    expect(toggled('auto')).toBe('controllers');
    expect(toggled('controllers')).toBe('hands');
    expect(toggled('hands')).toBe('controllers');
  });
  it('has a line in every language', () => {
    for (const mode of ['hands', 'controllers'] as const) {
      for (const lang of LANGS) expect(MODE_LINES[mode][lang]?.length).toBeGreaterThan(0);
      expect(modeLine(mode, 'en')).toBe(MODE_LINES[mode].en);
    }
  });
});
