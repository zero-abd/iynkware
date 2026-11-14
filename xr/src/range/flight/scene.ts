/**
 * The flight in the room, shared by the flight sub-modules: the room (`./room`, issue #122) sets it when a flight
 * starts and clears it when the person leaves the range; the crash card (`./crash`), the hand sticks (`./hands`) and
 * the FPV screen (`./screen`) read it. One slot per app.
 */
import type { Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Sticks } from '@/lib/flight';
import { value, type Value } from '../../ui/value';
import type { DroneHandle } from '../shared/drone-asset';
import type { CourseMap, FlightRunner } from './core';

export interface FlightScene {
  readonly contentId: string;
  readonly runner: FlightRunner;
  /** The course in the room: `toRoom`, `k`, `yawToWorld`, `drawnScale`, `netFace`. */
  readonly map: CourseMap;
  /** World-space group the course and the craft are drawn in (the room, not the bench). */
  readonly root: Object3D;
  /** The craft placement that flies. */
  readonly craft: DroneHandle;
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
