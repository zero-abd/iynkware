/**
 * Where the assistant's things sit on the bench, in the table frame (metres, origin at the bench top centre, +x to the
 * person's right, +z toward the person). Mirrors with the dominant hand like the bench (`xr/src/bench/core/geometry.ts`):
 * the shelf is on the dominant side, so the card and the companion wait on the other side, at the back, raised above
 * the work, where they never cover a part or a hole the person is looking at (the eyes look down past them).
 */
import { Vector3 } from '@iwsdk/core';
import type { XrSettings } from '../../contracts/settings';
import { benchGeometry } from '../../bench/core/geometry';

export interface Spots {
  /** The companion's rest: hovering over the bench's non-dominant side, toward the person. */
  readonly home: Vector3;
  /** The parts shelf's centre on its wing of the half-round table (the bench layout's shelf rectangle). */
  readonly shelf: Vector3;
  /** The proposal card's centre, how far it leans back from upright and how far it turns toward the person (radians). */
  readonly card: Vector3;
  readonly cardLean: number;
  readonly cardTurn: number;
  /** The bench top's half width and half depth: a shadow falls on the mat only inside it. */
  readonly top: { readonly halfW: number; readonly halfD: number };
  /** +1 right-handed, -1 left-handed. */
  readonly side: 1 | -1;
}

export function spotsOf(xr: Pick<XrSettings, 'posture' | 'dominantHand'>): Spots {
  const side: 1 | -1 = xr.dominantHand === 'left' ? -1 : 1;
  const standing = xr.posture === 'standing';
  const g = benchGeometry(xr.posture, xr.dominantHand);
  // The bench top (bench/core/geometry.ts): 1.0 x 0.55 m standing, 0.9 x 0.5 m seated.
  const half = standing ? 0.5 : 0.45;
  const back = standing ? -0.22 : -0.2;
  const lift = standing ? 0.32 : 0.28;
  return {
    // over the bench's left side (the non-dominant side), toward the person and low enough to read as company, clear
    // of the work zone in the middle (bench/core/geometry.ts: about 0.3 m either side of centre)
    home: new Vector3(-side * (half - 0.08), standing ? 0.22 : 0.2, standing ? 0.06 : 0.04),
    shelf: new Vector3(g.shelf.x, 0, g.shelf.z),
    card: new Vector3(-side * (half - 0.13), lift, back),
    cardLean: 0.26,
    cardTurn: side * 0.4,
    top: { halfW: half, halfD: standing ? 0.275 : 0.25 },
    side,
  };
}
