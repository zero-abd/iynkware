/**
 * Simulate here: the drone flies from the bench it was built on, around the person, instead of on a course laid out
 * in the room. The toggle (one slot per app) is set on the drone bench and on the flight plates; the room flight
 * (`./room`) reads it as the person arrives in the Range.
 *
 * Here the craft flies at real size (k = 1) from where it sat on the bench top. The bench top is the ground: the flight
 * model has one flat ground, so the craft lands back on the table's height wherever it is. The course loses its gates,
 * obstacles and missions (nothing of it is drawn) and its field is made wide enough that the net is never in the room.
 */
import type { Course } from '@/lib/flight';
import type { XrApp } from '../../contracts/app';
import type { Heading } from '../../input/helpers';
import { value, type Value } from '../../ui/value';
import { placeCourse, ROOM_BOTTOM_M, type CourseMap, type RoomVolume } from './core';

/** The drone's spot on the bench top (the table's local metres): the bench draws it there, Simulate here takes off from it. */
export const BENCH_DRONE_AT = { x: 0, z: -0.04 } as const;

const slots = new WeakMap<object, Value<boolean>>();

/** True when the flight starts from the bench (Simulate here), false for the course in the room. Off at first. */
export function flyHereOf(app: Pick<XrApp, 'world'>): Value<boolean> {
  let v = slots.get(app.world);
  if (!v) {
    v = value(false);
    slots.set(app.world, v);
  }
  return v;
}

/** Side of the open field, course metres: the net is half of it from the pad, far outside any room. */
export const HERE_FIELD_M = 60;
/** The volume around the person (the chase camera keeps inside it): this far each way, and this high above the bench top. */
export const HERE_REACH_M = 3;
export const HERE_TOP_M = 1.8;

/** The course flown from the bench: the same craft rules, mode and wind, but an open field with nothing in it. */
export function hereCourse(course: Course): Course {
  const half = HERE_FIELD_M / 2;
  return { ...course, field: HERE_FIELD_M, pad: [half, half], prims: [], gates: [], checkpoints: [], missions: [] };
}

/** World point (metres) where the craft sat on the bench top. */
export interface BenchSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The volume around the person standing at `head`, its ground the bench top at `spot.y`. */
export function hereVolume(head: { readonly x: number; readonly z: number; readonly heading: Heading }, spot: BenchSpot): RoomVolume {
  const fx = head.heading.fx, fz = head.heading.fz;
  return {
    ox: head.x,
    oz: head.z,
    floorY: spot.y,
    fx,
    fz,
    rx: -fz,
    rz: fx,
    left: -HERE_REACH_M,
    right: HERE_REACH_M,
    near: -HERE_REACH_M,
    far: HERE_REACH_M,
    bottom: ROOM_BOTTOM_M,
    top: HERE_TOP_M,
  };
}

/** The course at real size with its pad on the bench spot: course +x the person's right, +y away from them. */
export function hereMap(volume: RoomVolume, course: Course, ceiling: number, spot: BenchSpot): CourseMap {
  const dx = spot.x - volume.ox, dz = spot.z - volume.oz;
  const lateral = dx * volume.rx + dz * volume.rz;
  const ahead = dx * volume.fx + dz * volume.fz;
  return placeCourse(volume, 1, course.field, ceiling, lateral - course.pad[0], ahead - course.pad[1]);
}
