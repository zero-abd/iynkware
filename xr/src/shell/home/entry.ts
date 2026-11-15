import type { HomeEntry } from '../../contracts/shell';

/** The lessons catalogue's own tile. Home's `All lessons` button already opens that catalogue. */
export const LESSONS_ENTRY_ID = 'learn/lessons';

/**
 * The tile for home's second Learn spot: a `lessons` slot entry other than the lessons catalogue (today the labs).
 * Picking the first `lessons` entry hid the labs, because the catalogue registers first.
 */
export function learnSpotEntry(entries: readonly HomeEntry[]): HomeEntry | undefined {
  return entries.find((e) => e.slot === 'lessons' && e.id !== LESSONS_ENTRY_ID);
}
