/**
 * The flat screen's flight view and keys, as plain functions (tested without a world).
 *
 * The flat page has one fixed camera, framed on the bench. The Range's plates stand around the head for a headset's
 * wide view, so on a 60 degree flat camera Arm sits off the screen. `deskFrame` steps the camera back and up from the
 * head, looking down the course, so the plates and the volume are both in view.
 */
import type { Sticks } from '@/lib/flight';
import type { FlightHead } from '../scene';

/** The camera stands this far behind and above the head, and looks at a point this far ahead and below it. */
const BACK_M = 0.9;
const UP_M = 0.35;
const AHEAD_M = 1.0;
const BELOW_M = 0.55;

export interface DeskFrame {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}

export function deskFrame(head: FlightHead): DeskFrame {
  const { fx, fz } = head.heading;
  return {
    position: [head.x - fx * BACK_M, head.y + UP_M, head.z - fz * BACK_M],
    target: [head.x + fx * AHEAD_M, head.y - BELOW_M, head.z + fz * AHEAD_M],
  };
}

/** The flight keys (KeyboardEvent.code). Mode 2 like the thumbsticks: W S A D the left stick, arrows the right. */
export const FLIGHT_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;

/** Held keys to a climb-rate `Sticks`, written into `out` (the same channels as `controllerSticks`). */
export function keySticks(held: ReadonlySet<string>, out: Sticks): Sticks {
  const axis = (plus: string, minus: string) => (held.has(plus) ? 1 : 0) - (held.has(minus) ? 1 : 0);
  out.throttle = 0.5 + axis('KeyW', 'KeyS') / 2;
  out.yaw = axis('KeyD', 'KeyA');
  out.pitch = axis('ArrowUp', 'ArrowDown');
  out.roll = axis('ArrowLeft', 'ArrowRight');
  return out;
}
