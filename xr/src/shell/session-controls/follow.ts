/**
 * A lazy follower for the corner cluster: it is not glued to the face. It keeps a heading and a position of its own,
 * and chases the head only once the head has turned more than `deadDeg` from it (or moved more than `posDead` metres),
 * easing in until it is within `restDeg` (or `posRest`), then it is still again. So it settles after the head stops, and
 * a glance round the room does not drag it along. Pure maths, tested; `index.ts` feeds it the camera each frame.
 * Yaw is the bench's convention: 0 looks down -z, positive turns to the left.
 */
import type { Vec3 } from '../../contracts/common';
import { placementFrom } from '../kit/place';

export const FOLLOW = {
  /** Reading distance, metres: touch range (XR_DESIGN.md 2.1 puts touch UI at 0.42 to 0.46 m). */
  distance: 0.46,
  /** Towards the left of the heading, and below eye level: the lower left corner of the view. */
  sideDeg: -26,
  belowDeg: 38,
  deadDeg: 28,
  restDeg: 3,
  /** Per second: how fast it eases after the head (an exponential approach). */
  yawRate: 4.5,
  posDead: 0.18,
  posRest: 0.03,
  posRate: 3.5,
} as const;

export interface FollowState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  chasingYaw: boolean;
  chasingPos: boolean;
}

export interface HeadFrame {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

/** The yaw (bench convention) of a forward vector; keeps `fallback` when the head looks straight up or down. */
export function yawOfForward(fx: number, fz: number, fallback = 0): number {
  return Math.hypot(fx, fz) < 1e-4 ? fallback : Math.atan2(-fx, -fz);
}

/** The signed shortest angle from `a` to `b`, radians, in (-pi, pi]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function startFollow(head: HeadFrame): FollowState {
  return { x: head.x, y: head.y, z: head.z, yaw: head.yaw, chasingYaw: false, chasingPos: false };
}

const DEG = Math.PI / 180;
const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Advances the follower by `dt` seconds towards the head. Mutates and returns `s`. */
export function stepFollow(s: FollowState, head: HeadFrame, dt: number): FollowState {
  const dy = angleDiff(s.yaw, head.yaw);
  if (Math.abs(dy) > FOLLOW.deadDeg * DEG) s.chasingYaw = true;
  if (s.chasingYaw) {
    s.yaw += dy * ease(FOLLOW.yawRate, dt);
    if (Math.abs(angleDiff(s.yaw, head.yaw)) < FOLLOW.restDeg * DEG) s.chasingYaw = false;
  }
  const dist = Math.hypot(head.x - s.x, head.y - s.y, head.z - s.z);
  if (dist > FOLLOW.posDead) s.chasingPos = true;
  if (s.chasingPos) {
    const k = ease(FOLLOW.posRate, dt);
    s.x += (head.x - s.x) * k;
    s.y += (head.y - s.y) * k;
    s.z += (head.z - s.z) * k;
    if (Math.hypot(head.x - s.x, head.y - s.y, head.z - s.z) < FOLLOW.posRest) s.chasingPos = false;
  }
  return s;
}

/** Where the cluster's centre goes, world metres, and the eye it turns to face. */
export function clusterSpot(s: FollowState): { position: Vec3; eye: Vec3 } {
  const p = placementFrom([s.x, s.y, s.z], [-Math.sin(s.yaw), 0, -Math.cos(s.yaw)], FOLLOW);
  return { position: p.position, eye: p.faceTo };
}
