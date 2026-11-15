/**
 * The room flight volume and the course mapped into it (XR_DESIGN 8.3).
 *
 * World is the rig frame in metres, y up (three.js). The course is iynk's flight frame: metres, x east, y north, z up,
 * yaw in degrees from +x counter-clockwise. Courses are 9 to 300 m fields, so they fly at one uniform scale `k` that
 * fits the field and its ceiling into the volume: course +x is the person's right, course +y is away from them, +z up,
 * and the course ground is the room floor. The person never moves with the craft; only this mapping places it.
 */
import type { Heading } from '../../../input/helpers';

/** Default volume: a 3 x 3 m square on the floor in front of the person. */
export const ROOM_SIDE_M = 3;
/** Bottom and top of the volume above the floor. */
export const ROOM_BOTTOM_M = 0.1;
export const ROOM_TOP_M = 2.2;
/** The volume's near edge is at least this far ahead of the head. */
export const ROOM_NEAR_M = 0.5;
/** Where the pad goes, ahead of the head, when the field leaves room for it. */
export const PAD_AHEAD_M = 1.5;
/** A guardian boundary is inset this much before the volume is fitted into it. */
export const BOUNDARY_INSET_M = 0.3;
/** The smallest drawn craft: a 5-inch quad at k = 0.075 would be 2 cm across. */
export const MIN_DRAWN_M = 0.08;
/** The net shows on a face when the craft is this close to it (room metres). */
export const NET_NEAR_M = 0.5;
/** The flight model calls `outOfField` this far outside the field (course metres): that is the net. */
export const FIELD_MARGIN_M = 2;

/** The flight volume: a box on the floor, axis-aligned with the person's heading at entry. */
export interface RoomVolume {
  /** World x and z of the point on the floor straight below the head at entry. */
  readonly ox: number;
  readonly oz: number;
  /** World y of the floor. */
  readonly floorY: number;
  /** Unit horizontal forward (away) and right, world x and z. */
  readonly fx: number;
  readonly fz: number;
  readonly rx: number;
  readonly rz: number;
  /** Lateral extent, metres right of the head (negative is left), and forward extent, metres ahead. */
  readonly left: number;
  readonly right: number;
  readonly near: number;
  readonly far: number;
  readonly bottom: number;
  readonly top: number;
}

export interface VolumeOptions {
  /** Default square side when no boundary is given. */
  readonly side?: number;
  /** Guardian floor polygon (world x, z pairs), such as `bounded-floor` bounds; inset by `BOUNDARY_INSET_M`. */
  readonly polygon?: ReadonlyArray<readonly [number, number]>;
  readonly floorY?: number;
}

/** Faces of the volume where the net is drawn. The floor is the ground, not a net. */
export type NetFace = 'left' | 'right' | 'near' | 'far' | 'top';

/**
 * The flight volume in front of a head at entry (`head` x and z, its horizontal `heading`). Without a polygon it is a
 * `side` square from `ROOM_NEAR_M` ahead; with one, the largest box from `ROOM_NEAR_M` ahead, centred on the head's line
 * where it can be, that keeps `BOUNDARY_INSET_M` inside the polygon (shrunk uniformly from the polygon's extent).
 */
export function roomVolume(headX: number, headZ: number, heading: Heading, opts: VolumeOptions = {}): RoomVolume {
  const fx = heading.fx, fz = heading.fz, rx = -fz, rz = fx;
  let left = -(opts.side ?? ROOM_SIDE_M) / 2, right = -left, near = ROOM_NEAR_M, far = near + (opts.side ?? ROOM_SIDE_M);
  const poly = opts.polygon;
  if (poly && poly.length >= 3) {
    // the polygon in the head frame: (right, forward)
    const pts = poly.map(([x, z]) => [(x - headX) * rx + (z - headZ) * rz, (x - headX) * fx + (z - headZ) * fz] as const);
    let maxF = near, minR = 0, maxR = 0;
    for (const [r, f] of pts) {
      maxF = Math.max(maxF, f);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
    const inside = (r: number, f: number) => insidePolygon(pts, r, f) && edgeDistance(pts, r, f) >= BOUNDARY_INSET_M;
    const fits = (l: number, rr: number, n: number, fa: number) =>
      inside(l, n) && inside(rr, n) && inside(l, fa) && inside(rr, fa) && inside((l + rr) / 2, fa) && inside((l + rr) / 2, n);
    // shrink towards the near centre until all corners are inside
    const w0 = Math.min(-minR, maxR) * 2 || maxR - minR, d0 = maxF - near;
    let lo = 0, hi = 1;
    for (let i = 0; i < 20; i++) {
      const m = (lo + hi) / 2;
      if (fits((-w0 * m) / 2, (w0 * m) / 2, near, near + d0 * m)) lo = m;
      else hi = m;
    }
    left = (-w0 * lo) / 2;
    right = (w0 * lo) / 2;
    far = near + d0 * lo;
  }
  return { ox: headX, oz: headZ, floorY: opts.floorY ?? 0, fx, fz, rx, rz, left, right, near, far, bottom: ROOM_BOTTOM_M, top: ROOM_TOP_M };
}

function insidePolygon(pts: ReadonlyArray<readonly [number, number]>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function edgeDistance(pts: ReadonlyArray<readonly [number, number]>, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

/** A writable 3-vector for the `out` parameters (a `Vec3`-shaped tuple or any `{0,1,2}` array). */
export type Out3 = [number, number, number];

/** A course placed in the volume. Every method writes into `out` and allocates nothing. */
export interface CourseMap {
  readonly volume: RoomVolume;
  /** Room metres per course metre. */
  readonly k: number;
  /** Side of the course's square field and its ceiling, course metres. */
  readonly field: number;
  readonly ceiling: number;
  /** Where course (0, 0) lies: metres right of and ahead of the head. */
  readonly right0: number;
  readonly ahead0: number;
  /** Course point to world. */
  toRoom(x: number, y: number, z: number, out: Out3): Out3;
  /** World point to course. */
  toCourse(wx: number, wy: number, wz: number, out: Out3): Out3;
  /** Course yaw (degrees, from +x counter-clockwise) to a world yaw: radians about +Y that turn world +X onto it. */
  yawToWorld(yawDeg: number): number;
  /** Course velocity or offset to world (no translation). */
  dirToRoom(x: number, y: number, z: number, out: Out3): Out3;
  /** World offset to course (no translation). */
  dirToCourse(wx: number, wy: number, wz: number, out: Out3): Out3;
  /** Scale to draw a craft `span` course metres across: `max(k, MIN_DRAWN_M / span)`. */
  drawnScale(span: number): number;
  /** The face of the net the craft at course (x, y, z) is within `NET_NEAR_M` of (room metres), else null. */
  netFace(x: number, y: number, z: number): NetFace | null;
}

/**
 * Fits a course (square `field` side and `ceiling` in course metres, `pad` its start) into the volume at one uniform
 * scale `k = min(1, width / field, depth / field, (top - bottom) / ceiling)`. Laterally the pad is centred where the
 * field allows; along the depth the pad is `PAD_AHEAD_M` ahead where the field allows, the field's near edge never
 * closer than the volume's near edge.
 */
export function mapCourse(volume: RoomVolume, field: number, ceiling: number, pad: readonly [number, number]): CourseMap {
  const width = volume.right - volume.left, depth = volume.far - volume.near;
  const k = Math.min(1, width / field, depth / field, (volume.top - volume.bottom) / ceiling);
  const span = k * field;
  const clampTo = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  const right0 = clampTo(-k * pad[0], volume.left, volume.right - span);
  const ahead0 = clampTo(PAD_AHEAD_M - k * pad[1], volume.near, volume.far - span);
  return placeCourse(volume, k, field, ceiling, right0, ahead0);
}

/**
 * A course at scale `k` with course (0, 0) at `right0` metres right of and `ahead0` metres ahead of the volume's
 * origin. `mapCourse` fits it into the volume; the bench flight (`../here.ts`) puts the pad on the bench top instead.
 */
export function placeCourse(volume: RoomVolume, k: number, field: number, ceiling: number, right0: number, ahead0: number): CourseMap {
  const { ox, oz, floorY, fx, fz, rx, rz } = volume;
  const baseYaw = Math.atan2(-rz, rx);
  const map: CourseMap = {
    volume,
    k,
    field,
    ceiling,
    right0,
    ahead0,
    toRoom(x, y, z, out) {
      const r = right0 + k * x, a = ahead0 + k * y;
      out[0] = ox + r * rx + a * fx;
      out[1] = floorY + k * z;
      out[2] = oz + r * rz + a * fz;
      return out;
    },
    toCourse(wx, wy, wz, out) {
      const dx = wx - ox, dz = wz - oz;
      out[0] = (dx * rx + dz * rz - right0) / k;
      out[1] = (dx * fx + dz * fz - ahead0) / k;
      out[2] = (wy - floorY) / k;
      return out;
    },
    dirToRoom(x, y, z, out) {
      out[0] = k * (x * rx + y * fx);
      out[1] = k * z;
      out[2] = k * (x * rz + y * fz);
      return out;
    },
    dirToCourse(wx, wy, wz, out) {
      out[0] = (wx * rx + wz * rz) / k;
      out[1] = (wx * fx + wz * fz) / k;
      out[2] = wy / k;
      return out;
    },
    yawToWorld: (yawDeg) => baseYaw + (yawDeg * Math.PI) / 180,
    drawnScale: (craftSpan) => Math.max(k, MIN_DRAWN_M / Math.max(1e-6, craftSpan)),
    netFace(x, y, z) {
      const lo = -FIELD_MARGIN_M, hi = field + FIELD_MARGIN_M;
      let face: NetFace | null = null, best = NET_NEAR_M / k;
      const near = (d: number, f: NetFace) => {
        if (d < best) {
          best = d;
          face = f;
        }
      };
      near(x - lo, 'left');
      near(hi - x, 'right');
      near(y - lo, 'near');
      near(hi - y, 'far');
      near(ceiling - z, 'top');
      return face;
    },
  };
  return map;
}
