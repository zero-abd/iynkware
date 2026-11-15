/**
 * How big the room course is, chosen on the Size plate (Room is the default, the volume as it always was):
 *
 *   room      a 3 m square on the floor in front of the person; with a room-scale guardian it shrinks to fit inside it,
 *             but never below compact (a stationary or tiny guardian is ignored)
 *   compact   a 1.5 m square on the floor: fits between tables in a busy room
 *   table     a 0.8 m course floating at chest height just in front of the person, clear of everything in the room
 *
 * Pure: `volumeFor` only reshapes `roomVolume` (core/room.ts), so the course mapping, the net and the craft are unchanged.
 */
import type { Heading } from '../../../input/helpers';
import { roomVolume, type RoomVolume } from '../core/room';

export type CourseSize = 'room' | 'compact' | 'table';
export const COURSE_SIZES: readonly CourseSize[] = ['room', 'compact', 'table'];

export const COMPACT_SIDE_M = 1.5;
export const TABLE_SIDE_M = 0.8;
/** The tabletop course's ground: this far below the eyes, and its ceiling above that ground. */
export const TABLE_BELOW_EYES_M = 0.55;
export const TABLE_TOP_M = 0.6;

export const nextSize = (s: CourseSize): CourseSize => COURSE_SIZES[(COURSE_SIZES.indexOf(s) + 1) % COURSE_SIZES.length]!;

export interface HeadAt {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: Heading;
}

/** The flight volume for a size. `polygon` (world x, z) is the guardian, used by `room` only. */
export function volumeFor(size: CourseSize, head: HeadAt, polygon?: ReadonlyArray<readonly [number, number]> | null): RoomVolume {
  if (size === 'compact') return roomVolume(head.x, head.z, head.heading, { side: COMPACT_SIDE_M });
  if (size === 'table') {
    const v = roomVolume(head.x, head.z, head.heading, { side: TABLE_SIDE_M });
    return { ...v, floorY: head.y - TABLE_BELOW_EYES_M, bottom: 0.02, top: TABLE_TOP_M };
  }
  if (!polygon || polygon.length < 3) return roomVolume(head.x, head.z, head.heading);
  const fitted = roomVolume(head.x, head.z, head.heading, { polygon });
  // a stationary or very small guardian: keep a compact course rather than a uselessly small one
  if (fitted.right - fitted.left < COMPACT_SIDE_M || fitted.far - fitted.near < COMPACT_SIDE_M) return roomVolume(head.x, head.z, head.heading, { side: COMPACT_SIDE_M });
  return fitted;
}
