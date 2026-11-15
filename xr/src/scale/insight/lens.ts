/** Insight's pure rules: layer opacity, build levels and lifts, which part a switch aims at, external writes. */
import type { LensSetting } from '../../contracts/scale';

/** The `cover` layer's opacity at full see-through (docs/XR_ASSETS.md section 4). */
export const COVER_OPACITY = 0.28;
/** Lift of one build level at full explode, board frame metres. */
export const LEVEL_LIFT = 0.018;
/** How long a lens takes to ease, ms (shortened to 150 ms by the motion runner under reduced motion). */
export const LENS_MS = 300;

export const clamp01 = (x: number): number => (Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export type LayerId = 'base' | 'cover' | 'xray';

/** A layer's opacity at see-through amount `t`: base stays, cover goes to 0.28, xray comes in. */
export function layerOpacity(layer: LayerId, t: number): number {
  const k = clamp01(t);
  if (layer === 'cover') return lerp(1, COVER_OPACITY, k);
  if (layer === 'xray') return k;
  return 1;
}

/** Placeholders and the plain look have only a base layer: their body fades like a cover. */
export const bodyOpacity = (t: number): number => layerOpacity('cover', t);

/** 0 boards and surfaces, 1 seated parts, 2 modules on headers. */
export type BuildLevel = 0 | 1 | 2;

export function buildLevel(role: 'surface' | 'board' | 'part' | undefined, seated: boolean, kind: string | undefined, id: string): BuildLevel {
  if (role === 'surface' || role === 'board') return 0;
  if (role === undefined && id.startsWith('brd_')) return 0;
  if (kind === 'board' || kind === 'bench') return 0;
  if (kind === 'module') return 2;
  return seated || role === 'part' || id.startsWith('cmp_') ? 1 : 0;
}

/** Upward lift of a placement at whole-build explode `k`. */
export const liftOf = (level: BuildLevel, k: number): number => level * LEVEL_LIFT * clamp01(k);

/** What a lens setting means for one placement. */
export const lensAmount = (s: LensSetting, id: string): number => (s.part === null || s.part === id ? clamp01(s.amount) : 0);

/** The part a switch aims at: the one selected placed part, else the whole build (null). */
export function targetOf(selected: readonly string[], isPlaced: (id: string) => boolean): string | null {
  return selected.length === 1 && isPlaced(selected[0]!) ? selected[0]! : null;
}

/**
 * The bench owns each placement's position. `written` is what insight last wrote: if the object still sits there, the
 * bench has not moved it and the stored base stands; otherwise the object's own position is the new base.
 */
export function movedByBench(cur: readonly [number, number, number], written: readonly [number, number, number]): boolean {
  const dx = cur[0] - written[0];
  const dy = cur[1] - written[1];
  const dz = cur[2] - written[2];
  return dx * dx + dy * dy + dz * dz > 1e-14;
}
