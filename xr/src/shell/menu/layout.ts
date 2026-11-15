/** The menu's layout, in dmm at 1.0 m (so 1 dmm = 1 mm): pure arithmetic, tested. */
import type { MenuItem } from '../../contracts/shell';

export const W = 720;
const TOP_H = 68;
const PLACE_H = 68;
const GRID_H = 60;
const GAP = 8;
const SECTION_GAP = 12;
const HEAD_H = 26;
const FOOT_H = 60;
/** Panel chrome above the first row and below the last: the title bar and its padding, then padding and shadow. */
const CHROME_TOP = 80;
const CHROME_BOTTOM = 26;

export const DIM = { TOP_H, PLACE_H, GRID_H, GAP, SECTION_GAP, HEAD_H, FOOT_H, CHROME_TOP } as const;

/** Menu items on one page, two per row. */
export const PAGE_SIZE = 6;

const GROUP_ORDER: readonly MenuItem['group'][] = ['bench', 'view', 'tools'];

/** Menu items by group (bench, view, tools), keeping the order they were added within a group. */
export function sortItems<T extends { group: MenuItem['group'] }>(items: readonly T[]): T[] {
  return GROUP_ORDER.flatMap((g) => items.filter((i) => i.group === g));
}

export function pagesOf(count: number): number {
  return Math.max(1, Math.ceil(count / PAGE_SIZE));
}

/** The items on `page` (clamped to the last page). */
export function pageItems<T>(items: readonly T[], page: number): T[] {
  const p = Math.min(Math.max(0, page), pagesOf(items.length) - 1);
  return items.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
}

const gridHeight = (rows: number) => (rows <= 0 ? 0 : rows * GRID_H + (rows - 1) * GAP);

/**
 * Panel height in dmm for `projectButtons` (1 to 5) in the project grid and `pillarCount` menu items. The pillar
 * section is a fixed three rows once it needs a second page, so More and Back do not resize the panel.
 */
export function menuHeight(projectButtons: number, pillarCount: number): number {
  const projRows = Math.ceil(projectButtons / 2);
  const pillarRows = pillarCount > PAGE_SIZE ? PAGE_SIZE / 2 : Math.ceil(pillarCount / 2);
  let h = CHROME_TOP + TOP_H;
  h += SECTION_GAP + HEAD_H + PLACE_H;
  h += SECTION_GAP + HEAD_H + gridHeight(projRows);
  if (pillarCount > 0) h += SECTION_GAP + HEAD_H + gridHeight(pillarRows);
  h += SECTION_GAP + FOOT_H + CHROME_BOTTOM;
  return h;
}
