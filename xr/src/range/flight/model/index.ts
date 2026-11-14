/**
 * The drone bench model: pure TypeScript, no three.js, IWSDK or DOM. Assembly in build order, the bench tests, the
 * motors' phase wiring, the readiness report the 2D's `armingRules` reads, the design's numbers and warnings, the
 * faults and numbers the flight gets, and the bench stored in the project document.
 */
import { BENCH_CRAFTS } from './crafts';
import type { BenchCraft } from './types';

export * from './types';
export * from './bench';
export * from './design';
export * from './doc';
export * from './text';
export { BENCH_CRAFTS };

/** The bench rules for a content id, or null when the craft has no build. */
export function benchCraft(contentId: string): BenchCraft | null {
  return Object.hasOwn(BENCH_CRAFTS, contentId) ? BENCH_CRAFTS[contentId] : null;
}
