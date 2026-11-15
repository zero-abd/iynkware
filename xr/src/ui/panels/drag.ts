/**
 * The maths of moving a panel by its grip, pure so it is tested (no three.js runtime imports). A press on the grip
 * holds a point: a ray holds the point it hit at the depth it hit it, so the panel swings with the ray; a near pinch or
 * grip holds the hand itself, so the panel follows the hand. Where the panel ends up is then kept within reach of the
 * eyes and never under the bench top. XR_DESIGN.md 9.1 (moving panels); the owner's range is 0.3 to 2 m.
 *
 *   const hold = beginDrag(panelWorld, pointer, hitPoint);
 *   const p = heldPoint(hold, pointer, out);            // every drag-move, world
 *   clampReach(p, eye);                                  // 0.3 to 2 m from the eyes
 *   keepAboveBench(pTable, drop, floorY, halfWidth);     // in the bench's own frame
 */
import type { Vec3 } from '../../contracts/common';
import type { PointerMode } from '../../contracts/input';

export type MVec3 = [number, number, number];

/** How near and how far a moved panel's centre may be from the eyes, metres. */
export const REACH = { min: 0.3, max: 2.0 } as const;

/**
 * The bench in its own frame (`BenchSpace.table`: origin at the bench top centre, +z towards the person): half its
 * width and depth (the design's 1.00 x 0.55 m standing bench, a little generous), and how far a panel's lowest edge
 * stays above the top and above the floor.
 */
export const BENCH_BOX = { halfW: 0.52, halfD: 0.3, clear: 0.015, floorClear: 0.05 } as const;

export interface DragHold {
  /** The panel's origin minus the held point, world metres. */
  readonly offset: MVec3;
  /** Distance along the ray from its origin to the held point; 0 for a near press (the hand is the held point). */
  readonly depth: number;
}

export interface DragPointer {
  readonly origin: Vec3;
  readonly direction: Vec3;
  readonly mode: PointerMode;
}

/** The held point of `pointer` for a hold with this `depth`: along the ray, or the hand itself. */
function held(pointer: DragPointer, depth: number, out: MVec3): MVec3 {
  const o = pointer.origin;
  const d = pointer.direction;
  out[0] = o[0] + d[0] * depth;
  out[1] = o[1] + d[1] * depth;
  out[2] = o[2] + d[2] * depth;
  return out;
}

/**
 * Starts a drag of a panel whose origin is at `panel` (world) by `pointer`, which pressed the grip at `hit` (world;
 * the pointer's origin when absent). A ray keeps the hit's depth along it; a near press or a poke holds the hand.
 */
export function beginDrag(panel: Vec3, pointer: DragPointer, hit?: Vec3): DragHold {
  let depth = 0;
  if (pointer.mode === 'ray') {
    const h = hit ?? pointer.origin;
    const o = pointer.origin;
    const d = pointer.direction;
    depth = Math.max(0, (h[0] - o[0]) * d[0] + (h[1] - o[1]) * d[1] + (h[2] - o[2]) * d[2]);
  }
  const p = held(pointer, depth, [0, 0, 0]);
  return { offset: [panel[0] - p[0], panel[1] - p[1], panel[2] - p[2]], depth };
}

/** Where the panel's origin goes for the pointer's pose now (world). */
export function heldPoint(hold: DragHold, pointer: DragPointer, out: MVec3): MVec3 {
  held(pointer, hold.depth, out);
  out[0] += hold.offset[0];
  out[1] += hold.offset[1];
  out[2] += hold.offset[2];
  return out;
}

/** Keeps `p` (world) between `min` and `max` metres from `eye`, along the line from the eye; returns `p`. */
export function clampReach(p: MVec3, eye: Vec3, min: number = REACH.min, max: number = REACH.max): MVec3 {
  const dx = p[0] - eye[0];
  const dy = p[1] - eye[1];
  const dz = p[2] - eye[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) {
    // On the eye itself: straight ahead along -z at the near limit (a panel cannot face a point it is on).
    p[0] = eye[0];
    p[1] = eye[1];
    p[2] = eye[2] - min;
    return p;
  }
  const k = Math.min(max, Math.max(min, len)) / len;
  p[0] = eye[0] + dx * k;
  p[1] = eye[1] + dy * k;
  p[2] = eye[2] + dz * k;
  return p;
}

/**
 * Keeps a panel above the bench (`p` in the bench's frame, metres): when the panel, `halfWidth` either side of its
 * origin, is over the bench top, its lowest edge (`drop` under its origin) stays `clear` above the top (y = 0);
 * elsewhere it stays above the floor (`floorY` in the same frame). Returns `p`.
 */
export function keepAboveBench(p: MVec3, drop: number, floorY: number, halfWidth = 0, box: typeof BENCH_BOX = BENCH_BOX): MVec3 {
  const over = Math.abs(p[0]) <= box.halfW + halfWidth && Math.abs(p[2]) <= box.halfD + 0.02;
  const lowest = over ? box.clear : floorY + box.floorClear;
  if (p[1] - drop < lowest) p[1] = lowest + drop;
  return p;
}

/** Whether two positions are further apart than `eps` metres (a placement made by someone else). */
export function movedFrom(a: Vec3, b: Vec3, eps = 1e-4): boolean {
  return Math.abs(a[0] - b[0]) > eps || Math.abs(a[1] - b[1]) > eps || Math.abs(a[2] - b[2]) > eps;
}
