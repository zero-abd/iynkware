/**
 * Where things are on the bench (XR_DESIGN.md 2.1 to 2.3), in the table frame: metres, origin at the bench top centre,
 * +x to the person's right, +z towards the person, y up from the mat. The design gives distances ahead of the eyes;
 * the bench front edge is 0.15 m ahead of the eyes, so "a m ahead" is z = front - (a - 0.15) with front = depth / 2.
 * The table is half-round (`table`): the mat and rail in the centre, the shelf and the tools rack on its wings.
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

/**
 * The table: a half-round (horseshoe) top that wraps around the person, an annular sector about a centre behind the
 * eyes. Its centre front is the old bench's front edge (0.15 m ahead of the eyes), so the work zone and the rail stay
 * where they always were; the wings either side curve back towards the person and hold the shelf and the tools rack
 * within a short reach of each shoulder.
 */
export interface TableRing {
  /** z of the ring's centre, table frame (behind the eyes: the eyes are at z = top.d / 2 + 0.15). */
  readonly cz: number;
  /** Inner and outer radii about (0, cz). */
  readonly inner: number;
  readonly outer: number;
  /** Half the angle the ring spans, from straight ahead (-z) either way. */
  readonly halfSpanRad: number;
}

/** A rect that is also turned about y (towards the person): the shelf and the tools rack on the wings. */
export interface TurnedRect extends Rect {
  readonly yawRad: number;
}

export interface BenchGeometry {
  readonly posture: XrSettings['posture'];
  /** +1 right-handed, -1 left-handed. */
  readonly d: 1 | -1;
  /**
   * The centre strip of the bench, width by depth: it fixes the table frame (origin at its centre, front edge at
   * z = d / 2, 0.15 m ahead of the eyes). The table itself is `table`, wider and round.
   */
  readonly top: { readonly w: number; readonly d: number };
  /** The half-round table top. */
  readonly table: TableRing;
  /** The cutting mat lying on the table's centre, its front edge at the rail. */
  readonly mat: Rect;
  /** The front rail: the mat's first 0.04 m of depth, raised 0.03 m and tilted 30 degrees up towards the person. */
  readonly rail: Rect & { readonly raise: number; readonly tiltRad: number };
  /** The work zone (Z1): from the rail back 0.30 m. */
  readonly work: Rect;
  /** The parts shelf on the wing of side D, turned to face the person. */
  readonly shelf: TurnedRect;
  /** The tools rack, mirrored on the other wing. */
  readonly tools: TurnedRect;
  /** The back strip of the mat behind the work zone, where loose and delivered things go. */
  readonly back: Rect;
  /** Rail slots (centre x along the rail, table frame) for the bench's own controls; the run cluster is x -0.15..0.15. */
  readonly slots: { readonly undo: number; readonly redo: number; readonly ticker: number; readonly posture: number };
}

export const EYE_TO_FRONT = 0.15;
const RAIL_DEPTH = 0.04;
const WORK_DEPTH = 0.3;
/** The ring's centre is this far behind the eyes (about 0.2 m behind the torso); its inner radius reaches the front edge. */
const RING_BEHIND_EYES = 0.3;
/** The wings: how far round they go, and where the shelf and the rack stand on them (angle, radius from the centre). */
const RING_HALF_SPAN_DEG = 70;
const WING_DEG = 56;
const WING_R = 0.76;

const SIZES = {
  standing: { top: { w: 1.0, d: 0.55 }, ringD: 0.6, mat: { w: 0.9, d: 0.48 }, workW: 0.6, wing: { w: 0.24, d: 0.22 } },
  seated: { top: { w: 0.9, d: 0.5 }, ringD: 0.55, mat: { w: 0.86, d: 0.44 }, workW: 0.54, wing: { w: 0.22, d: 0.2 } },
} as const;

export function benchGeometry(posture: XrSettings['posture'], dominantHand: XrSettings['dominantHand'] = 'right'): BenchGeometry {
  const d: 1 | -1 = dominantHand === 'left' ? -1 : 1;
  const size = SIZES[posture === 'standing' ? 'standing' : 'seated'];
  const top = { w: size.top.w, d: size.top.d };
  const front = top.d / 2;
  const inner = EYE_TO_FRONT + RING_BEHIND_EYES;
  const table: TableRing = {
    cz: front + inner,
    inner,
    outer: inner + size.ringD,
    halfSpanRad: (RING_HALF_SPAN_DEG * Math.PI) / 180,
  };
  const mat = { x: 0, z: front - size.mat.d / 2, w: size.mat.w, d: size.mat.d };
  const workW = size.workW;
  const rail = { x: 0, z: front - RAIL_DEPTH / 2, w: mat.w, d: RAIL_DEPTH, raise: 0.03, tiltRad: (30 * Math.PI) / 180 };
  const work = { x: 0, z: front - RAIL_DEPTH - WORK_DEPTH / 2, w: workW, d: WORK_DEPTH };
  // The wings: the shelf on side D, the rack mirrored, each at WING_DEG round the ring, its front turned to the centre.
  const a = (WING_DEG * Math.PI) / 180;
  const wing = (side: 1 | -1): TurnedRect => ({
    x: side * Math.sin(a) * WING_R,
    z: table.cz - Math.cos(a) * WING_R,
    w: size.wing.w,
    d: size.wing.d,
    yawRad: -side * a,
  });
  const shelf = wing(d);
  const tools = wing(-d as 1 | -1);
  const backNear = work.z - work.d / 2;
  const matBack = mat.z - mat.d / 2;
  const back = { x: 0, z: (backNear + matBack) / 2, w: workW, d: backNear - matBack };
  const hr = mat.w / 2;
  // Undo and redo just past the run cluster on side D, the ticker at that end (the scale plates fill the other side).
  const slots = { undo: d * 0.19, redo: d * 0.25, ticker: d * (hr - 0.075), posture: -d * (hr - 0.08) };
  return { posture, d, top, table, mat, rail, work, shelf, tools, back, slots };
}

/** Whether table-frame (x, z) is on the round table top, `margin` metres past its edges still counting. */
export function onTable(t: TableRing, x: number, z: number, margin = 0): boolean {
  const dz = t.cz - z;
  const r = Math.hypot(x, dz);
  if (r < t.inner - margin || r > t.outer + margin) return false;
  // Angle from straight ahead; the end caps are radial, so a margin there is an arc of `margin` at that radius.
  const ang = Math.abs(Math.atan2(x, dz));
  return ang <= t.halfSpanRad + (r > 1e-6 ? margin / r : 0);
}

/** The point at `angleRad` round the ring (0 ahead, + towards +x) and `r` from its centre, table frame. */
export function ringPoint(t: TableRing, angleRad: number, r: number): { x: number; z: number } {
  return { x: Math.sin(angleRad) * r, z: t.cz - Math.cos(angleRad) * r };
}
