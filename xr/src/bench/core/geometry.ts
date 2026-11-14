/**
 * Where things are on the bench (XR_DESIGN.md 2.1 to 2.3), in the table frame: metres, origin at the bench top centre,
 * +x to the person's right, +z towards the person, y up from the mat. The design gives distances ahead of the eyes;
 * the bench front edge is 0.15 m ahead of the eyes, so "a m ahead" is z = front - (a - 0.15) with front = depth / 2.
 * Every layout mirrors for a left-handed person: `d` is +1 for right-handed, -1 for left-handed, and the shelf and the
 * D end of the rail sit at x * d. One source for pose (draws the bench), shelf, edit (rail undo and redo) and wire.
 */
import type { XrSettings } from '../../contracts/settings';

export interface Rect {
  /** Centre x and z, table frame. */
  readonly x: number;
  readonly z: number;
  /** Width along x, depth along z. */
  readonly w: number;
  readonly d: number;
}

export interface BenchGeometry {
  readonly posture: XrSettings['posture'];
  /** +1 right-handed, -1 left-handed. */
  readonly d: 1 | -1;
  /** The bench top, width by depth. */
  readonly top: { readonly w: number; readonly d: number };
  /** The front rail: the first 0.04 m of depth, raised 0.03 m and tilted 30 degrees up towards the person. */
  readonly rail: Rect & { readonly raise: number; readonly tiltRad: number };
  /** The work zone (Z1): from the rail back 0.30 m. */
  readonly work: Rect;
  /** The parts shelf on side D: x 0.32 to 0.52 m, 0.20 to 0.40 m ahead of the eyes (clamped inside the top). */
  readonly shelf: Rect;
  /** The tools rack, mirrored on the other side. */
  readonly tools: Rect;
  /** The back strip of the mat behind the work zone, where loose and delivered things go. */
  readonly back: Rect;
  /** Rail slots (centre x along the rail, table frame) for the bench's own controls; the run cluster is x -0.15..0.15. */
  readonly slots: { readonly undo: number; readonly redo: number; readonly ticker: number; readonly posture: number };
}

const EYE_TO_FRONT = 0.15;
const RAIL_DEPTH = 0.04;
const WORK_DEPTH = 0.3;

export function benchGeometry(posture: XrSettings['posture'], dominantHand: XrSettings['dominantHand'] = 'right'): BenchGeometry {
  const d: 1 | -1 = dominantHand === 'left' ? -1 : 1;
  const top = posture === 'standing' ? { w: 1.0, d: 0.55 } : { w: 0.9, d: 0.5 };
  const front = top.d / 2;
  /** z of a point `ahead` metres ahead of the eyes. */
  const z = (ahead: number) => front - (ahead - EYE_TO_FRONT);
  const workW = posture === 'standing' ? 0.6 : 0.54;
  const rail = { x: 0, z: front - RAIL_DEPTH / 2, w: top.w, d: RAIL_DEPTH, raise: 0.03, tiltRad: (30 * Math.PI) / 180 };
  const work = { x: 0, z: front - RAIL_DEPTH - WORK_DEPTH / 2, w: workW, d: WORK_DEPTH };
  const half = top.w / 2;
  const shelfIn = Math.max(workW / 2, Math.min(0.32, half - 0.2));
  const shelfOut = Math.min(0.52, half);
  const shelfFar = Math.max(z(0.4), -front);
  const shelfNear = Math.min(z(0.2), front - RAIL_DEPTH);
  const shelf = { x: d * ((shelfIn + shelfOut) / 2), z: (shelfFar + shelfNear) / 2, w: shelfOut - shelfIn, d: shelfNear - shelfFar };
  const tools = { ...shelf, x: -shelf.x };
  const backNear = work.z - work.d / 2;
  const back = { x: 0, z: (backNear - front) / 2, w: workW, d: backNear + front };
  const slots = { undo: d * (half - 0.26), redo: d * (half - 0.19), ticker: d * (half - 0.085), posture: -d * (half - 0.1) };
  return { posture, d, top, rail, work, shelf, tools, back, slots };
}
