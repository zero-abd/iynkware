/**
 * The pending wire's tube, rewritten in place: the vertex layout of three's `TubeGeometry` (`SEGMENTS + 1` rings of
 * `RADIAL + 1` vertices) over the same arch the bench draws (`space.ts` `wireArch`, `look/wires.ts`): a quadratic curve
 * from end `a` to end `b` whose control point sits at the mid point, raised to the higher end plus 7 mm plus 0.18 of
 * the span. The curve is planar (vertical through both ends), so the frame is a fixed sideways vector and the normal
 * in the plane: no twist, no allocation. `writeTube` touches only its arguments.
 */
export const SEGMENTS = 32;
export const RADIAL = 8;
/** Board frame metres (real size), as `look/wires.ts`. */
export const RADIUS = 0.0009;
export const VERTICES = (SEGMENTS + 1) * (RADIAL + 1);

/** The arch's control point height: the higher end, 7 mm and 0.18 of the span above it. */
export const archY = (ay: number, by: number, span: number): number => Math.max(ay, by) + 0.007 + span * 0.18;

/**
 * Writes the tube from (ax, ay, az) to (bx, by, bz) into `position` and `normal` (each `VERTICES * 3` long). Returns
 * false and writes nothing when an input is not finite.
 */
export function writeTube(
  position: ArrayLike<number> & { [i: number]: number },
  normal: ArrayLike<number> & { [i: number]: number },
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  radius: number = RADIUS,
): boolean {
  if (!Number.isFinite(ax + ay + az + bx + by + bz)) return false;
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const span = Math.hypot(dx, dy, dz);
  const cx = (ax + bx) / 2;
  const cz = (az + bz) / 2;
  const cy = archY(ay, by, span);
  // the sideways unit vector: horizontal and square to the span (any when the ends are one above the other)
  let sx = -dz;
  let sz = dx;
  const sl = Math.hypot(sx, sz);
  if (sl < 1e-9) {
    sx = 1;
    sz = 0;
  } else {
    sx /= sl;
    sz /= sl;
  }
  let o = 0;
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const u = 1 - t;
    const px = u * u * ax + 2 * u * t * cx + t * t * bx;
    const py = u * u * ay + 2 * u * t * cy + t * t * by;
    const pz = u * u * az + 2 * u * t * cz + t * t * bz;
    // tangent
    let tx = 2 * u * (cx - ax) + 2 * t * (bx - cx);
    let ty = 2 * u * (cy - ay) + 2 * t * (by - cy);
    let tz = 2 * u * (cz - az) + 2 * t * (bz - cz);
    const tl = Math.hypot(tx, ty, tz);
    if (tl < 1e-12) {
      // both ends in one place: the arch is a vertical loop, its top has no tangent
      tx = 0;
      ty = 1;
      tz = 0;
    } else {
      tx /= tl;
      ty /= tl;
      tz /= tl;
    }
    // the in-plane normal: tangent x sideways
    let nx = ty * sz - tz * 0;
    let ny = tz * sx - tx * sz;
    let nz = tx * 0 - ty * sx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    for (let j = 0; j <= RADIAL; j++) {
      const v = (j / RADIAL) * Math.PI * 2;
      const c = Math.cos(v);
      const s = Math.sin(v);
      // the ring: cos along the normal, sin along the sideways vector
      const rx = c * nx + s * sx;
      const ry = c * ny;
      const rz = c * nz + s * sz;
      normal[o] = rx;
      normal[o + 1] = ry;
      normal[o + 2] = rz;
      position[o] = px + radius * rx;
      position[o + 1] = py + radius * ry;
      position[o + 2] = pz + radius * rz;
      o += 3;
    }
  }
  return true;
}
