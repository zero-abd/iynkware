/** Where the twelve bins stand (design 2.3): three tiers of four on the shelf rect, rising towards the back, turned to face the person. */
import type { BenchGeometry } from '../core/geometry';

export const TIERS = 3;
export const PER_TIER = 4;
/** Each tier is this much higher than the one in front of it; the first one's top is `BASE` above the mat. */
export const TIER_RISE = 0.04;
export const BASE = 0.012;

export interface BinSlot {
  /** Centre in the shelf's own frame (x right, z towards the person, y up from the mat). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly tier: number;
}

export interface ShelfLayout {
  /** Where the shelf's frame sits in the table frame, and its yaw about y. */
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** The rect before it is turned. */
  readonly w: number;
  readonly d: number;
  readonly tierD: number;
  readonly binW: number;
  /** The bins, nearest tier first, left to right. */
  readonly bins: readonly BinSlot[];
}

export function shelfLayout(g: BenchGeometry): ShelfLayout {
  const { shelf } = g;
  const tierD = shelf.d / TIERS;
  const slotW = shelf.w / PER_TIER;
  const bins: BinSlot[] = [];
  for (let t = 0; t < TIERS; t++) {
    for (let c = 0; c < PER_TIER; c++) {
      bins.push({
        x: -shelf.w / 2 + (c + 0.5) * slotW,
        y: BASE + t * TIER_RISE,
        z: shelf.d / 2 - (t + 0.5) * tierD,
        w: slotW - 0.004,
        d: tierD - 0.004,
        tier: t,
      });
    }
  }
  // The shelf stands on the wing of side D, its front turned to the person (the ring's centre); left-handed mirrors.
  return { x: shelf.x, z: shelf.z, yaw: shelf.yawRad, w: shelf.w, d: shelf.d, tierD, binW: slotW - 0.004, bins };
}

/** A bin centre in the table frame (the shelf's turn applied). */
export function binInTable(l: ShelfLayout, i: number): { x: number; y: number; z: number } {
  const b = l.bins[i]!;
  const c = Math.cos(l.yaw), s = Math.sin(l.yaw);
  return { x: l.x + b.x * c + b.z * s, y: b.y, z: l.z - b.x * s + b.z * c };
}
