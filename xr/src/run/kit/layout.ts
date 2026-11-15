/**
 * Where the run pillar's things sit on the bench (docs/XR_DESIGN.md 2.1 to 2.3 and 9.1), in the table frame of
 * `app.bench.table`: metres, origin at the bench top centre, +x to the person's right, +z towards the person, y up.
 * One source, so the run cluster, the meter, the scope and the fault deck never overlap. Mirrors for a left-handed
 * person (`d` = -1): the tools rack is on the side away from the dominant hand.
 *
 * The bench's numbers (top, mat, wings) come from the bench pillar's `benchGeometry`: the tools rack is its `tools` wing.
 */
import type { Vec3 } from '../../contracts/common';
import type { XrSettings } from '../../contracts/settings';
import { benchGeometry, EYE_TO_FRONT } from '../../bench/core/geometry';
import { EYE_ABOVE_TOP, ringSpot } from '../../bench/core/ring';

export interface Spot {
  /** Table frame position. */
  readonly position: Vec3;
  /**
   * Apply as `object.rotation.set(tiltRad, yawRad, 0, 'YXZ')`. Things that lie on the bench face +y (a positive tilt
   * turns them towards the person); panels face +z (a negative tilt turns them up towards the eyes).
   */
  readonly tiltRad: number;
  readonly yawRad: number;
}

export interface RunLayout {
  readonly d: 1 | -1;
  /** The bench top. */
  readonly top: { readonly w: number; readonly d: number };
  /** Centre of the run cluster on the front rail (x -0.15 to +0.15), on the rail's tilted face. */
  readonly cluster: Spot;
  /** Half the width the cluster may use along the rail. */
  readonly clusterHalfW: number;
  /** The tools rack (the mirror of the parts shelf, on the other wing): centre and size before it is turned (`meter.yawRad`). */
  readonly rack: { readonly x: number; readonly z: number; readonly w: number; readonly d: number };
  /** Rack slots: the meter body, the scope probe, the fault deck (fault lab only). */
  readonly meter: Spot;
  readonly scopeProbe: Spot;
  readonly deck: Spot;
  /** Panels in reach zone 3, each facing the eyes (9.1). */
  readonly scopeScreen: Spot;
  readonly serial: Spot;
  /** Where the eyes are assumed to be, table frame (for panels to face, and for distances). */
  readonly eye: Vec3;
}

const RAIL_DEPTH = 0.04;
const RAIL_RAISE = 0.03;
const RAIL_TILT = (30 * Math.PI) / 180;

export function runLayout(posture: XrSettings['posture'] = 'seated', dominantHand: XrSettings['dominantHand'] = 'right'): RunLayout {
  const g = benchGeometry(posture, dominantHand);
  const d = g.d;
  // Probes park on the mat's width, the bench's depth (the half-round table is there behind the mat too).
  const top = { w: g.mat.w, d: g.top.d };
  const front = g.top.d / 2;
  // The tools rack stands on the wing away from the dominant hand, turned to face the person (`g.tools`).
  const t = g.tools;
  const rack = { x: t.x, z: t.z, w: t.w, d: t.d };
  const c = Math.cos(t.yawRad), sn = Math.sin(t.yawRad);
  /** A point in the rack: `u` 0 at its inner edge to 1 at its outer edge, `v` 0 at the back to 1 at the front. */
  const inRack = (u: number, v: number, y = 0): Vec3 => {
    // rack frame: x towards its outer end (away from the work zone), z towards its front
    const lx = -d * (u - 0.5) * t.w;
    const lz = (v - 0.5) * t.d;
    return [t.x + lx * c + lz * sn, y, t.z - lx * sn + lz * c];
  };
  const flat = (position: Vec3): Spot => ({ position, tiltRad: 0, yawRad: t.yawRad });
  const eye: Vec3 = [0, EYE_ABOVE_TOP, front + EYE_TO_FRONT];
  return {
    d,
    top,
    cluster: { position: [0, RAIL_RAISE, front - RAIL_DEPTH / 2], tiltRad: RAIL_TILT, yawRad: 0 },
    clusterHalfW: 0.15,
    rack,
    meter: flat(inRack(0.62, 0.5)),
    scopeProbe: flat(inRack(0.14, 0.8)),
    deck: flat(inRack(0.14, 0.22)),
    // The panel ring (bench/core/ring.ts): the scope screen behind the board, serial beyond the code window.
    scopeScreen: ringSpot('scope', posture, dominantHand),
    serial: ringSpot('serial', posture, dominantHand),
    eye,
  };
}
