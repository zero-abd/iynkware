import { describe, expect, test } from 'vitest';
import type { HomeEntry } from '../src/contracts/shell';
import { learnSpotEntry } from '../src/shell/home/entry';

const entry = (id: string, slot: HomeEntry['slot']): HomeEntry => ({ id, slot, title: { en: id } as HomeEntry['title'], open: () => undefined });

describe('home Learn spot', () => {
  test('shows the labs even when the lessons catalogue registered first', () => {
    const entries = [entry('learn/lessons', 'lessons'), entry('range/drones', 'range'), entry('lab/labs', 'lessons')];
    expect(learnSpotEntry(entries)?.id).toBe('lab/labs');
  });

  test('never repeats the lessons catalogue, which All lessons already opens', () => {
    expect(learnSpotEntry([entry('learn/lessons', 'lessons')])).toBeUndefined();
  });

  test('ignores tiles in other slots', () => {
    expect(learnSpotEntry([entry('range/drones', 'range'), entry('learn/onboarding', 'onboarding')])).toBeUndefined();
  });
});
