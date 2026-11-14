/**
 * Where the guide panel goes (design 9.1): 1.10 m from the head, 12 degrees below eye level, 15 degrees away from the
 * dominant hand's side; kept between 0.8 and 2.0 m when moved. Pure maths on plain numbers, so it is unit tested.
 * Yaw is about +Y with 0 looking along -Z and positive turning left, as three.js rotates.
 */
import type { Vec3 } from '../../../contracts/common';

export const GUIDE_PLACE = { distanceM: 1.1, belowDeg: 12, awayDeg: 15, minM: 0.8, maxM: 2.0 } as const;

const RAD = Math.PI / 180;

/** World position of the panel's centre for a head at `head` turned `yaw`. */
export function guideSpot(head: Vec3, yaw: number, dominant: 'left' | 'right', o: { distanceM?: number; belowDeg?: number; awayDeg?: number } = {}): Vec3 {
  const d = o.distanceM ?? GUIDE_PLACE.distanceM;
  const away = (o.awayDeg ?? GUIDE_PLACE.awayDeg) * RAD * (dominant === 'right' ? 1 : -1);
  const pitch = -(o.belowDeg ?? GUIDE_PLACE.belowDeg) * RAD;
  const a = yaw + away;
  return [head[0] - Math.sin(a) * Math.cos(pitch) * d, head[1] + Math.sin(pitch) * d, head[2] - Math.cos(a) * Math.cos(pitch) * d];
}

/** Moves `p` along the line from the head so its distance lies in [min, max]; writes into `p` (x, y, z fields). */
export function clampDistance(head: { x: number; y: number; z: number }, p: { x: number; y: number; z: number }, min: number = GUIDE_PLACE.minM, max: number = GUIDE_PLACE.maxM): boolean {
  const dx = p.x - head.x;
  const dy = p.y - head.y;
  const dz = p.z - head.z;
  const d = Math.hypot(dx, dy, dz);
  if (d >= min && d <= max) return false;
  if (d < 1e-6) {
    p.z = head.z - min;
    return true;
  }
  const k = (d < min ? min : max) / d;
  p.x = head.x + dx * k;
  p.y = head.y + dy * k;
  p.z = head.z + dz * k;
  return true;
}

/** Yaw of a head orientation (quaternion), from its forward (-Z) projected on the floor. */
export function yawOf(qx: number, qy: number, qz: number, qw: number): number {
  const fx = -2 * (qx * qz + qw * qy);
  const fz = -(1 - 2 * (qx * qx + qy * qy));
  if (Math.hypot(fx, fz) < 1e-6) return 0;
  return Math.atan2(-fx, -fz);
}
