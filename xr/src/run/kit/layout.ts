/**
 * Where the run pillar's things sit on the bench (docs/XR_DESIGN.md 2.1 to 2.3 and 9.1), in the table frame of
 * `app.bench.table`: metres, origin at the bench top centre, +x to the person's right, +z towards the person, y up.
 * One source, so the run cluster, the meter, the scope and the fault deck never overlap. Mirrors for a left-handed
 * person (`d` = -1): the tools rack is on the side away from the dominant hand.
 *
 * The bench's numbers (top size, rail, shelf) are the design's, as the bench pillar uses them. If the bench publishes
 * its geometry through a contract, read it from there instead.
 */
import type { Vec3 } from '../../contracts/common';
import type { XrSettings } from '../../contracts/settings';

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
  /** The tools rack (the mirror of the parts shelf): centre and size on the mat. */
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

const EYE_TO_FRONT = 0.15;
/** The eyes are about 0.47 m above the bench top (2.1: top at E - 0.47). */
const EYE_ABOVE_TOP = 0.47;
const RAIL_DEPTH = 0.04;
const RAIL_RAISE = 0.03;
const RAIL_TILT = (30 * Math.PI) / 180;
const DEG = Math.PI / 180;

/** A panel `dist` metres from the eyes, `down` degrees below level, `side` degrees towards +x, turned to face them. */
function panel(eye: Vec3, dist: number, down: number, side: number): Spot {
  const h = Math.cos(down * DEG) * dist;
  const position: Vec3 = [eye[0] + Math.sin(side * DEG) * h, eye[1] - Math.sin(down * DEG) * dist, eye[2] - Math.cos(side * DEG) * h];
  return { position, tiltRad: -down * DEG, yawRad: -side * DEG };
}

export function runLayout(posture: XrSettings['posture'] = 'seated', dominantHand: XrSettings['dominantHand'] = 'right'): RunLayout {
  const d: 1 | -1 = dominantHand === 'left' ? -1 : 1;
  const top = posture === 'standing' ? { w: 1.0, d: 0.55 } : { w: 0.9, d: 0.5 };
  const front = top.d / 2;
  const ahead = (a: number) => front - (a - EYE_TO_FRONT);
  const workW = posture === 'standing' ? 0.6 : 0.54;
  const half = top.w / 2;
  // The shelf on side D spans x 0.32 to 0.52 and 0.20 to 0.40 m ahead, clamped to the top; the rack mirrors it.
  const inner = Math.max(workW / 2, Math.min(0.32, half - 0.2));
  const outer = Math.min(0.52, half);
  const far = Math.max(ahead(0.4), -front);
  const near = Math.min(ahead(0.2), front - RAIL_DEPTH);
  const rack = { x: -d * ((inner + outer) / 2), z: (far + near) / 2, w: outer - inner, d: near - far };
  /** A point in the rack: `u` 0 at its inner edge to 1 at its outer edge, `v` 0 at the back to 1 at the front. */
  const inRack = (u: number, v: number, y = 0): Vec3 => [-d * (inner + u * rack.w), y, far + v * rack.d];
  const flat = (position: Vec3): Spot => ({ position, tiltRad: 0, yawRad: 0 });
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
    // 9.1: the scope screen behind the board, 20 degrees below, 0.95 m; serial beside the code panel (15 degrees
    // towards D, 12 below, 1.10 m), further towards D at 1.00 m.
    scopeScreen: panel(eye, 0.95, 20, 0),
    serial: panel(eye, 1.0, 12, 36 * d),
    eye,
  };
}
