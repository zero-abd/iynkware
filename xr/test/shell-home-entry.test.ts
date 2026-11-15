import { describe, expect, test } from 'vitest';
import type { HomeEntry } from '../src/contracts/shell';
import { labEntries, learnSpotEntry } from '../src/shell/home/entry';

const entry = (id: string, slot: HomeEntry['slot']): HomeEntry => ({ id, slot, title: { en: id } as HomeEntry['title'], open: () => undefined });

describe('home Learn spot', () => {
  test('shows another pillar tile even when the lessons catalogue registered first', () => {
    const entries = [entry('learn/lessons', 'lessons'), entry('range/drones', 'range'), entry('learn/path', 'lessons')];
    expect(learnSpotEntry(entries)?.id).toBe('learn/path');
  });

  test('never repeats the lessons catalogue, which All lessons already opens', () => {
    expect(learnSpotEntry([entry('learn/lessons', 'lessons')])).toBeUndefined();
  });

  test('leaves the labs to their own row', () => {
    expect(learnSpotEntry([entry('learn/lessons', 'lessons'), entry('lab/open/chemistry', 'lessons')])).toBeUndefined();
  });

  test('ignores tiles in other slots', () => {
    expect(learnSpotEntry([entry('range/drones', 'range'), entry('learn/onboarding', 'onboarding')])).toBeUndefined();
  });
});

describe('home Labs row', () => {
  test('lists every lab tile in order, and nothing else', () => {
    const entries = [
      entry('learn/lessons', 'lessons'),
      entry('lab/open/chemistry', 'lessons'),
      entry('range/drones', 'range'),
      entry('lab/open/physics', 'lessons'),
    ];
    expect(labEntries(entries).map((e) => e.id)).toEqual(['lab/open/chemistry', 'lab/open/physics']);
  });

  test('is empty without the lab pillar', () => {
    expect(labEntries([entry('learn/lessons', 'lessons')])).toEqual([]);
  });
});
