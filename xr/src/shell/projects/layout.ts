/** The Projects panel's sizes (dmm at 1.0 m, so 1 dmm = 1 mm) and its paging: pure arithmetic, tested. */
import type { LibraryState } from '../library/types';

export const W = 760;
export const NEW_H = 64;
export const KICK_H = 34;
export const ROW_H = 64;
export const GAP = 8;
export const FOOT_H = 52;
/** Rows of projects on one page. */
export const PAGE_SIZE = 5;
/** Title bar and padding above the first control; padding and shadow under the last. */
const CHROME_TOP = 80;
const CHROME_BOTTOM = 30;

export const H = CHROME_TOP + NEW_H + 12 + KICK_H + PAGE_SIZE * ROW_H + (PAGE_SIZE - 1) * GAP + 12 + FOOT_H + CHROME_BOTTOM;

export const pagesOf = (count: number): number => Math.max(1, Math.ceil(count / PAGE_SIZE));

/** The page to show (clamped) and its rows. */
export function pageOf<T>(rows: readonly T[], page: number): { page: number; pages: number; rows: T[] } {
  const pages = pagesOf(rows.length);
  const p = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  return { page: p, pages, rows: rows.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE) };
}

/** What the line over the list says: a state message, the empty state, or the list's kicker. */
export type ListNote = 'yours' | 'empty' | 'loading' | 'unavailable' | 'full';

export function noteOf(state: LibraryState | null, count: number): ListNote {
  if (state === null || state === 'unavailable') return 'unavailable';
  if (state === 'full') return 'full';
  if (state === 'loading' && count === 0) return 'loading';
  return count === 0 ? 'empty' : 'yours';
}
