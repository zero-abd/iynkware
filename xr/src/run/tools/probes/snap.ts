/**
 * Which pin or hole a probe tip snaps to: the nearest anchor within `maxM` metres (the design's 0.01 m, 6.3), a pin
 * winning over a hole at about the same place (a leg seated in a hole is one point; the leg is the better name). Pure.
 * Positions are a flat `x, y, z` array so the search allocates nothing.
 */

/** A pin counts as this much closer than a hole (squared distance factor), so the pin of a seated leg beats its hole. */
export const PIN_BIAS = 0.64;
/** The snap radius, metres in the bench's own units (world distance, whatever the board scale). */
export const SNAP_M = 0.01;

/** Index of the nearest point of `xyz` to (x, y, z) within `maxM`, or -1. `isPin[i]` is 1 for a pin. */
export function nearestAnchor(xyz: ArrayLike<number>, isPin: ArrayLike<number>, count: number, x: number, y: number, z: number, maxM: number = SNAP_M): number {
  const limit = maxM * maxM;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < count; i++) {
    const dx = xyz[i * 3]! - x;
    if (dx > maxM || dx < -maxM) continue;
    const dy = xyz[i * 3 + 1]! - y;
    const dz = xyz[i * 3 + 2]! - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > limit) continue;
    const score = isPin[i] ? d2 * PIN_BIAS : d2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Where a released probe goes: onto an anchor, down onto the bench where it was let go, or back to the rack. */
export type DropOutcome = 'clip' | 'park' | 'rack';

/**
 * A release at table-frame (x, z) with height `y` above the bench top: clipped when it snapped, parked when it is over
 * the bench top (it settles onto the mat), racked when it is let go off the bench (a far drop, or above the reach of
 * the table). `margin` is how far past the bench's edge still counts as the bench.
 */
export function dropOutcome(snapped: boolean, top: { w: number; d: number }, x: number, y: number, z: number, margin = 0.04): DropOutcome {
  if (snapped) return 'clip';
  const over = Math.abs(x) <= top.w / 2 + margin && Math.abs(z) <= top.d / 2 + margin;
  return over && y > -0.05 && y < 1 ? 'park' : 'rack';
}
