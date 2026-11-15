/**
 * The panel ring: where every floating panel that belongs to the bench stands, so they never pile up. Fixed slots on
 * an arc about the eyes, just beyond the half-round table's back edge, like screens standing on the far side of a desk.
 * Each slot faces the eyes, in the table frame (`app.bench.table`), so panels move with the bench (Recentre, the
 * bench's grip, "bring the bench here").
 *
 * Nothing stands straight beyond the work mat but the scope screen, which is low and only out while the scope is.
 * Slot angles mirror for a left-handed person: the code side is always the dominant hand's.
 *
 * Each slot is at its panel's own design distance (its text is sized in dmm for it) and the angles leave about 3
 * degrees between neighbours at their widths. Every slot stands just beyond the table's outer edge.
 *
 *   slot      towards D   distance   below   holds (width as seen)
 *   scope        0         0.95 m     20     the scope screen, behind the board (25 degrees)
 *   code       +30         0.90 m     10     the code window (33 degrees)
 *   serial     +62         1.10 m     12     the serial monitor (27 degrees; drawn for 1.00 m)
 *   guide      -29         1.10 m     10     the lesson guide (27 degrees)
 *   side       -58         1.10 m     12     the fault panel, Look inside, the lab panel (up to 31 degrees)
 *
 * The session controls stand further round on the left (`shell/session-controls/spot.ts`, 86 degrees), fixed in the
 * room, so they never stand in front of the `side` slot.
 *
 * A person can still drag any panel anywhere (`ui/panels`); Tidy up puts it back in its slot.
 */
import type { Vec3 } from '../../contracts/common';
import type { XrSettings } from '../../contracts/settings';
import { benchGeometry, EYE_TO_FRONT } from './geometry';

export type RingSlot = 'scope' | 'code' | 'serial' | 'guide' | 'side';

/** The eyes are about 0.47 m above the bench top (design 2.1: top at E - 0.47). */
export const EYE_ABOVE_TOP = 0.47;

/** Each slot: its angle towards side D (degrees), how far from the eyes (metres) and how far below eye level (degrees). */
export const RING_SLOTS: Readonly<Record<RingSlot, { readonly sideDeg: number; readonly distanceM: number; readonly belowDeg: number }>> = {
  scope: { sideDeg: 0, distanceM: 0.95, belowDeg: 20 },
  code: { sideDeg: 30, distanceM: 0.9, belowDeg: 10 },
  serial: { sideDeg: 62, distanceM: 1.1, belowDeg: 12 },
  guide: { sideDeg: -29, distanceM: 1.1, belowDeg: 10 },
  side: { sideDeg: -58, distanceM: 1.1, belowDeg: 12 },
};

export interface RingSpot {
  /** Table frame centre of the panel. */
  readonly position: Vec3;
  /** Apply as `rotation.set(tiltRad, yawRad, 0, 'YXZ')`: the panel's +z faces the eyes. */
  readonly tiltRad: number;
  readonly yawRad: number;
}

const DEG = Math.PI / 180;

/** Where the eyes are assumed to be, table frame. */
export function ringEye(posture: XrSettings['posture']): Vec3 {
  const front = benchGeometry(posture).top.d / 2;
  return [0, EYE_ABOVE_TOP, front + EYE_TO_FRONT];
}

/** The table-frame spot of `slot` for this posture and dominant hand. */
export function ringSpot(slot: RingSlot, posture: XrSettings['posture'], dominantHand: XrSettings['dominantHand'] = 'right'): RingSpot {
  const s = RING_SLOTS[slot];
  const d = dominantHand === 'left' ? -1 : 1;
  const eye = ringEye(posture);
  const side = s.sideDeg * d * DEG;
  const down = s.belowDeg * DEG;
  const h = Math.cos(down) * s.distanceM;
  return {
    position: [eye[0] + Math.sin(side) * h, eye[1] - Math.sin(down) * s.distanceM, eye[2] - Math.cos(side) * h],
    tiltRad: -down,
    yawRad: -side,
  };
}

/**
 * A panel drawn for `size.distanceM`, scaled to stand in `slot`: its metres grow with the slot's distance, so it looks
 * the same size and its dmm-sized text and layout are unchanged.
 */
export function atSlot<T extends { widthM: number; heightM: number; distanceM: number }>(size: T, slot: RingSlot): T {
  const d = RING_SLOTS[slot].distanceM;
  const k = d / size.distanceM;
  return { ...size, widthM: size.widthM * k, heightM: size.heightM * k, distanceM: d };
}
