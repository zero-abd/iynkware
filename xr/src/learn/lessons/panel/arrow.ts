/**
 * The off-view arrow (design 7.1): a highlighted target outside the view gets an arrow on the guide panel's nearest
 * border, pointing at it. Pure maths, unit tested: whether a target is out of view, and where on the border the arrow
 * sits for a target given in the panel's own frame (x right, y up, the panel facing +z).
 */

/** Half the cone the person sees comfortably, degrees from the head's forward (Quest 3S: about 96 by 90 degrees). */
export const VIEW_HALF_DEG = 40;

/** True when the direction from `head` to `target` is more than `halfDeg` from `forward` (a unit vector). */
export function outOfView(
  head: { x: number; y: number; z: number },
  forward: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  halfDeg: number = VIEW_HALF_DEG,
): boolean {
  const dx = target.x - head.x;
  const dy = target.y - head.y;
  const dz = target.z - head.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return false;
  const cos = (dx * forward.x + dy * forward.y + dz * forward.z) / d;
  return cos < Math.cos((halfDeg * Math.PI) / 180);
}

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface ArrowSpot {
  side: Side;
  /** Point on the border, panel-local metres. */
  x: number;
  y: number;
  /** In-plane angle the arrow points at, radians from +x (counter-clockwise). */
  angle: number;
}

/**
 * Where the arrow sits for a target at (x, y) in the panel's frame (the target projected on the panel's plane), on a
 * panel `halfW` by `halfH` metres. Writes into `out`. A target straight behind the centre points down.
 */
export function arrowSpot(x: number, y: number, halfW: number, halfH: number, out: ArrowSpot): ArrowSpot {
  const len = Math.hypot(x, y);
  const ux = len < 1e-6 ? 0 : x / len;
  const uy = len < 1e-6 ? -1 : y / len;
  const tx = Math.abs(ux) < 1e-9 ? Infinity : halfW / Math.abs(ux);
  const ty = Math.abs(uy) < 1e-9 ? Infinity : halfH / Math.abs(uy);
  const t = Math.min(tx, ty);
  out.x = ux * t;
  out.y = uy * t;
  out.side = tx <= ty ? (ux > 0 ? 'right' : 'left') : uy > 0 ? 'top' : 'bottom';
  out.angle = Math.atan2(uy, ux);
  return out;
}
