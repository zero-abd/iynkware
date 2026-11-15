import { describe, expect, it } from 'vitest';
import { isPanelMove, isPartGrab } from '../../src/learn/onboarding/detect';
import { COUNTED, STEPS, STORAGE_KEY, createMachine, inputKind, markSeen, wasSeen } from '../../src/learn/onboarding/steps';
import { ONBOARDING_STRINGS, t } from '../../src/learn/onboarding/strings';
import { tableProblems } from '../../src/learn/text';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('onboarding step machine', () => {
  it('advances only on the current step event, then waits for next', () => {
    const m = createMachine();
    expect(m.feed('run')).toBe(false);
    expect(m.feed('grab')).toBe(true);
    expect(m.ticked).toBe(true);
    expect(m.feed('grab')).toBe(false);
    m.next();
    expect(m.step).toBe('wire');
    expect(m.ticked).toBe(false);
  });

  it('walks every step in order and ends on the ready card', () => {
    const m = createMachine();
    for (const s of STEPS.slice(0, COUNTED)) {
      expect(m.step).toBe(s);
      m.feed(s as 'grab');
      m.next();
    }
    expect(m.step).toBe('ready');
    m.next();
    expect(m.step).toBe('ready');
  });

  it('goes back and clears the tick', () => {
    const m = createMachine();
    m.next();
    m.feed('wire');
    m.back();
    expect(m.step).toBe('grab');
    expect(m.ticked).toBe(false);
    m.back();
    expect(m.index).toBe(0);
  });

  it('skip and done end once, and nothing moves afterwards', () => {
    const ends: string[] = [];
    const m = createMachine((h) => ends.push(h));
    m.skip();
    m.done();
    m.next();
    expect(ends).toEqual(['skipped']);
    expect(m.ended).toBe('skipped');
    expect(m.feed('grab')).toBe(false);
  });
});

describe('onboarding storage and wording', () => {
  it('remembers done or skipped, and never throws', () => {
    const s = mem();
    expect(wasSeen(s)).toBe(false);
    markSeen('skipped', s);
    expect(wasSeen(s)).toBe(true);
    expect(s.getItem(STORAGE_KEY)).toBe('skipped');
    expect(wasSeen({ getItem: () => { throw new Error('blocked'); } })).toBe(false);
    expect(() => markSeen('done', { setItem: () => { throw new Error('blocked'); } })).not.toThrow();
  });

  it('picks controller wording when a controller is tracked, hands otherwise', () => {
    expect(inputKind({ left: 'hand', right: 'hand' })).toBe('hands');
    expect(inputKind({ left: null, right: null })).toBe('hands');
    expect(inputKind({ left: 'hand', right: 'controller' })).toBe('controllers');
    expect(t('en', 'menu.hands')).not.toBe(t('en', 'menu.controllers'));
  });

  it('has every string in six languages with the same placeholders', () => {
    expect(tableProblems(ONBOARDING_STRINGS)).toEqual([]);
  });

  it('classifies panel moves and part grabs', () => {
    expect(isPanelMove('menu/move')).toBe(true);
    expect(isPanelMove('home/grip')).toBe(true);
    expect(isPanelMove('cmp_led1')).toBe(false);
    expect(isPartGrab('cmp_led1')).toBe(true);
    expect(isPartGrab('session/recentre')).toBe(false);
  });
});
