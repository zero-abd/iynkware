/**
 * Angular sizes (design 0 and 9.2): 1 dmm is 1 mm per metre of viewing distance. Type roles, the 1.15x size for
 * Devanagari and Chinese, and the line heights per script.
 *
 * Usage: const m = dmm(22, 1.1); const px = role('body', 'hi').size * texelsPerDmm;
 */
import type { Lang } from '../../contracts/common';

/** Metres for `n` dmm seen from `distanceM`. */
export const dmm = (n: number, distanceM: number): number => (n * distanceM) / 1000;

/** dmm for `m` metres seen from `distanceM`. */
export const toDmm = (m: number, distanceM: number): number => (m * 1000) / distanceM;

export type Role = 'display' | 'title' | 'body' | 'label' | 'code' | 'caption';

/** Latin sizes and weights of design 9.2; caption (18 dmm) is the minimum anything is drawn at. */
export const ROLES: Readonly<Record<Role, { size: number; weight: number; mono: boolean }>> = {
  display: { size: 44, weight: 600, mono: true },
  title: { size: 30, weight: 600, mono: false },
  body: { size: 22, weight: 400, mono: false },
  label: { size: 20, weight: 500, mono: false },
  code: { size: 20, weight: 400, mono: true },
  caption: { size: 18, weight: 500, mono: false },
};

/** Nothing is drawn smaller than this, in any language (design 9.2). */
export const MIN_DMM = 18;

/** Devanagari and Chinese are set 1.15x the Latin size of the same role. */
export const scriptScale = (lang: Lang): number => (lang === 'hi' || lang === 'zh' ? 1.15 : 1);

/** Line height as a multiple of the font size: 1.35 Latin, 1.45 Chinese, 1.55 Devanagari. */
export const lineHeight = (lang: Lang): number => (lang === 'hi' ? 1.55 : lang === 'zh' ? 1.45 : 1.35);

/** A role's font size in dmm for a language and the text size setting (1, 1.25 or 1.5); code stays Latin. */
export function roleSize(r: Role, lang: Lang, textScale = 1): number {
  const base = ROLES[r].size * textScale;
  return ROLES[r].mono ? base : base * scriptScale(lang);
}
