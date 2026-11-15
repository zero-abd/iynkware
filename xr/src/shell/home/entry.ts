import type { HomeEntry } from '../../contracts/shell';

/** The lessons catalogue's own tile. Home's `All lessons` button already opens that catalogue. */
export const LESSONS_ENTRY_ID = 'learn/lessons';

/** The lab pillar's tiles (`lab/open/<lab>`), one per lab: Home lays them out in a row of their own. */
export const LAB_ENTRY_PREFIX = 'lab/';

const isLab = (e: HomeEntry) => e.slot === 'lessons' && e.id.startsWith(LAB_ENTRY_PREFIX);

/**
 * The tile for home's second Learn spot: a `lessons` slot entry other than the lessons catalogue and the labs (which
 * have their own row). Picking the first `lessons` entry would hide it, because the catalogue registers first.
 */
export function learnSpotEntry(entries: readonly HomeEntry[]): HomeEntry | undefined {
  return entries.find((e) => e.slot === 'lessons' && e.id !== LESSONS_ENTRY_ID && !isLab(e));
}

/** Every lab tile, in the order the lab pillar added them: switching labs happens on Home, not in a picker. */
export function labEntries(entries: readonly HomeEntry[]): HomeEntry[] {
  return entries.filter(isLab);
}
