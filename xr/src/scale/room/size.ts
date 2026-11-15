/**
 * Room size sizing and placement, pure functions. The board is measured in its own frame (metres, scale 1); the room
 * scale makes its largest horizontal side 3.0 m, or 0.8 x the shorter side of the guardian bounds when that is
 * smaller, and never under 1.5 m. It stands level on the floor with its nearest edge 1.0 m in front of the head.
 */
export const ROOM_MAX_SIDE = 3.0;
export const ROOM_MIN_SIDE = 1.5;
export const BOUNDS_FRACTION = 0.8;
export const EDGE_AHEAD = 1.0;
/** Used when the bench holds nothing measurable. */
export const EMPTY_SIDE = 0.2;

/** The board's horizontal extent in the board frame. */
export interface Extent {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export const largestSide = (e: Extent): number => Math.max(e.maxX - e.minX, e.maxZ - e.minZ);

/** The side the board's largest side becomes, in metres. `boundsShort` is the guardian's shorter side, if known. */
export function targetSide(boundsShort: number | null): number {
  let side = ROOM_MAX_SIDE;
  if (boundsShort !== null && Number.isFinite(boundsShort) && boundsShort > 0) side = Math.min(side, BOUNDS_FRACTION * boundsShort);
  return Math.max(ROOM_MIN_SIDE, side);
}

/** The room scale for a board of `extent`: the world units per board metre. */
export function roomScale(extent: Extent, boundsShort: number | null): number {
  const side = Math.max(largestSide(extent), 1e-3);
  return targetSide(boundsShort) / side;
}

/** The shorter side of the axis aligned rectangle around guardian `points` (x, z), or null when there are too few. */
export function boundsShortSide(points: ReadonlyArray<{ x: number; z: number }>): number | null {
  if (points.length < 3) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const s = Math.min(maxX - minX, maxZ - minZ);
  return s > 0 && Number.isFinite(s) ? s : null;
}

export interface RoomPose {
  /** World position of the board origin, on the floor (y = 0). */
  readonly x: number;
  readonly z: number;
  /** Yaw about +y, radians. */
  readonly yaw: number;
  readonly scale: number;
}

/**
 * Where the board stands: level (yaw only), turned so its near side (+z in the board frame) faces the head, centred on
 * the head's heading, nearest edge `EDGE_AHEAD` in front. `fx, fz` is the head's horizontal forward (any length).
 */
export function roomPose(extent: Extent, scale: number, head: { x: number; z: number; fx: number; fz: number }): RoomPose {
  let fx = head.fx;
  let fz = head.fz;
  const len = Math.hypot(fx, fz);
  if (len < 1e-6) {
    fx = 0;
    fz = -1;
  } else {
    fx /= len;
    fz /= len;
  }
  // Rotation by yaw maps board +z to (sin, cos); it must point back at the head, along (-fx, -fz).
  const yaw = Math.atan2(-fx, -fz);
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const cx = ((extent.minX + extent.maxX) / 2) * scale;
  const ez = extent.maxZ * scale;
  // World offset of the near edge centre from the board origin: R * (cx, 0, ez).
  const ox = c * cx + s * ez;
  const oz = -s * cx + c * ez;
  return { x: head.x + fx * EDGE_AHEAD - ox, z: head.z + fz * EDGE_AHEAD - oz, yaw, scale };
}

/** The heading of a horizontal direction, radians about +y (0 looks down +z). */
export const headingOf = (dx: number, dz: number): number => Math.atan2(dx, dz);

/** The smallest absolute difference of two headings, 0..PI. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

/** The Back to bench panel re-places itself only when the head has turned more than this from where it was set. */
export const REPLACE_DEG = 40;
export const needsReplace = (panelHeading: number, headHeading: number): boolean => angleDiff(panelHeading, headHeading) > (REPLACE_DEG * Math.PI) / 180;
