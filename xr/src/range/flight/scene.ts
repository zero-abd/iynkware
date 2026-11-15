/**
 * The flight in the room, shared by the flight sub-modules: the room (`./room`, issue #122) sets it when a flight
 * starts and clears it when the person leaves the range; the crash card (`./crash`), the hand sticks (`./hands`) and
 * the FPV screen (`./screen`) read it. One slot per app.
 */
import type { Object3D } from '@iwsdk/core';
import type { DroneContent } from '@/content/schema';
import type { XrApp } from '../../contracts/app';
import type { Course, CraftFaults, FlightCraft, Sticks } from '@/lib/flight';
import type { Heading } from '../../input/helpers';
import { value, type Value } from '../../ui/value';
import type { DroneHandle } from '../shared/drone-asset';
import type { CourseMap, FlightRunner, RoomVolume } from './core';

/** Where the person stood as the flight began (world metres, the head); UI near the person is placed from it. */
export interface FlightHead {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: Heading;
}

export interface FlightScene {
  readonly contentId: string;
  /** The craft's iynk content (design, figure, flight, fixes). */
  readonly content: DroneContent;
  /** The flight model's craft: rates, `camTilt`, `fov`, `hitRadius`, modes. */
  readonly spec: FlightCraft;
  /** The course that flies. */
  readonly course: Course;
  /** Which build flies: the bench's when it is complete, else the factory build; and its faults. */
  readonly build: { readonly source: 'bench' | 'factory'; readonly faults: CraftFaults };
  readonly runner: FlightRunner;
  /** The flight volume in the room (world metres). */
  readonly volume: RoomVolume;
  /** The course in the room: `toRoom`, `k`, `yawToWorld`, `drawnScale`, `netFace`. */
  readonly map: CourseMap;
  readonly head: FlightHead;
  /** World-space group the course and the craft are drawn in (the room, not the bench). */
  readonly root: Object3D;
  /** The craft placement that flies. */
  readonly craft: DroneHandle;
  /** The room's own Arm action: the bench's arming rules first, then the runner's (`toggleArm`). */
  arm(): void;
  /** The room's own Reset: the craft back on the pad, the trail and the next gate cleared. */
  reset(): void;
  /** Puts a line in the room's readout (already translated). */
  say(text: string): void;
  /**
   * Where the sticks come from this frame. The room reads the controller thumbsticks unless another source (the hand
   * rings, guide flight) has claimed them: `claimSticks` returns the release.
   */
  claimSticks(owner: string, read: (out: Sticks) => void): () => void;
}

const slots = new WeakMap<object, Value<FlightScene | null>>();

/** The current flight, or null when nothing flies. */
export function flightSceneOf(app: Pick<XrApp, 'world'>): Value<FlightScene | null> {
  let v = slots.get(app.world);
  if (!v) {
    v = value<FlightScene | null>(null);
    slots.set(app.world, v);
  }
  return v;
}
