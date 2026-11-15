/**
 * The palm menu button's maths (XR_DESIGN.md 5, "summon a menu"): when the palm faces the head, and where the button
 * sits. Pure, so it is tested; `index.ts` feeds it the input service's hand pose every frame.
 */
import type { Vec3 } from '../../contracts/common';

/** The palm counts as facing the head above this dot product, and stops counting below `OFF` (hysteresis). */
export const FACING_ON = 0.6;
export const FACING_OFF = 0.4;
/** The button floats this far off the palm along its normal, metres. */
export const BUTTON_OFFSET_M = 0.06;
/** A hand further than this from the head (or closer than the near limit) is not being held up to the face. */
export const REACH_M = { near: 0.12, far: 0.8 } as const;

/** The dot product of the palm normal and the direction from the palm to the head; -2 when they coincide. */
export function facingDot(normal: Vec3, palm: Vec3, head: Vec3): number {
  const dx = head[0] - palm[0];
  const dy = head[1] - palm[1];
  const dz = head[2] - palm[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return -2;
  return (normal[0] * dx + normal[1] * dy + normal[2] * dz) / len;
}

/** Whether the button shows: the hand is open, held up in reach, and its palm faces the head (with hysteresis). */
export function palmFacing(o: { normal: Vec3; palm: Vec3; head: Vec3; open: boolean; was: boolean }): boolean {
  if (!o.open) return false;
  const dist = Math.hypot(o.head[0] - o.palm[0], o.head[1] - o.palm[1], o.head[2] - o.palm[2]);
  if (dist < REACH_M.near || dist > REACH_M.far) return false;
  return facingDot(o.normal, o.palm, o.head) > (o.was ? FACING_OFF : FACING_ON);
}

/** Where the button floats: `offset` metres from the palm along its normal. */
export function palmButtonAt(palm: Vec3, normal: Vec3, offset: number = BUTTON_OFFSET_M): Vec3 {
  return [palm[0] + normal[0] * offset, palm[1] + normal[1] * offset, palm[2] + normal[2] * offset];
}

/** The hand that is not dominant. */
export const otherHand = (dominant: 'left' | 'right'): 'left' | 'right' => (dominant === 'left' ? 'right' : 'left');
