/** The quick input switch's pure parts: what each mode ignores, what B toggles to, the lines. */
import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/contracts/common';
import { CONTROLLER_IDLE_MS, MODE_LINES, blocks, modeLine, newIdleState, preferHand, stepIdle, toggled } from '../src/input/mode';

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
    expect(toggled('controllers')).toBe('auto');
    expect(toggled('hands')).toBe('controllers');
  });
  it('has a line in every language', () => {
    for (const mode of ['auto', 'controllers'] as const) {
      for (const lang of LANGS) expect(MODE_LINES[mode][lang]?.length).toBeGreaterThan(0);
      expect(modeLine(mode, 'en')).toBe(MODE_LINES[mode].en);
    }
  });
});

describe('a put-down controller gives way to the tracked hand', () => {
  it('a still controller with no button held is idle after CONTROLLER_IDLE_MS', () => {
    const s = newIdleState();
    expect(stepIdle(s, 0, 1, 0, false, 0)).toBe(false);
    expect(stepIdle(s, 0.005, 1, 0, false, CONTROLLER_IDLE_MS - 1)).toBe(false);
    expect(stepIdle(s, 0.005, 1, 0, false, CONTROLLER_IDLE_MS)).toBe(true);
  });
  it('moving it or holding a button wakes it', () => {
    const s = newIdleState();
    stepIdle(s, 0, 1, 0, false, 0);
    expect(stepIdle(s, 0, 1, 0, false, 5000)).toBe(true);
    expect(stepIdle(s, 0.05, 1, 0, false, 5001)).toBe(false);
    expect(stepIdle(s, 0.05, 1, 0, true, 9000)).toBe(false);
  });
  it('hands win by default and when on, never under controllers only', () => {
    expect(preferHand('auto', true, true)).toBe(true);
    expect(preferHand('hands', true, true)).toBe(true);
    expect(preferHand('controllers', true, true)).toBe(false);
    expect(preferHand('auto', false, true)).toBe(false);
    expect(preferHand('auto', true, false)).toBe(false);
  });
});
