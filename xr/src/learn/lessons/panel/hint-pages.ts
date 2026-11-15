/**
 * Paging a hint that does not fit its card at the role's size: pure, so it is unit tested. A hint that fits in
 * `capFull` lines is one page without controls; else the card gives a row to the page controls and shows `capPaged`
 * lines (never fewer than one) on each page.
 *
 * Usage: const p = hintPaging(lines.length, capFull, capPaged); const [a, b] = pageRange(p, page, lines.length).
 */

export interface HintPaging {
  readonly pages: number;
  /** Lines on each page but the last. */
  readonly perPage: number;
  /** Page controls show. */
  readonly paged: boolean;
}

export function hintPaging(total: number, capFull: number, capPaged: number): HintPaging {
  const n = Math.max(0, Math.floor(total));
  if (n <= Math.max(1, Math.floor(capFull))) return { pages: 1, perPage: Math.max(1, n), paged: false };
  const per = Math.max(1, Math.floor(capPaged));
  return { pages: Math.ceil(n / per), perPage: per, paged: true };
}

/** `page` kept inside 0..pages-1. */
export const clampPage = (page: number, pages: number): number => Math.max(0, Math.min(Math.max(1, pages) - 1, Math.floor(page) || 0));

/** The slice bounds of `page` over `total` lines. */
export function pageRange(p: HintPaging, page: number, total: number): [number, number] {
  const i = clampPage(page, p.pages);
  return [i * p.perPage, Math.min(total, (i + 1) * p.perPage)];
}
