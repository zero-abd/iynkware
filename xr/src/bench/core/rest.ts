/**
 * Where a thing let go in the room comes to rest, like in real life: straight down onto what is under it, the bench
 * top when it is over the bench, else the floor (the local-floor reference space puts the floor at world y = 0). Used
 * by circuit parts and boards set down off the mat (`edit/carry.ts`, `edit/board.ts`) and by lab equipment
 * (`lab/items`). No physics engine: one surface test and a fall time from the height.
 */
import { Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import { benchGeometry } from './geometry';

/** World y of the floor. */
export const FLOOR_Y = 0;
const G = 9.81;
const _t = new Vector3();

export interface Rest {
  /** World y of the surface under the point. */
  readonly y: number;
  /** The bench top (true) or the floor (false). */
  readonly onBench: boolean;
}

/** What is under the world point `p`: the bench top when `p` is over it (and not below it), else the floor. */
export function restBelow(app: XrApp, p: Vector3): Rest {
  const table = app.bench.table;
  table.updateWorldMatrix(true, false);
  _t.copy(p);
  table.worldToLocal(_t);
  const xr = app.settings.xr.value;
  const { top } = benchGeometry(xr.posture, xr.dominantHand);
  const over = Math.abs(_t.x) <= top.w / 2 && Math.abs(_t.z) <= top.d / 2 && _t.y > -0.02;
  if (over) {
    _t.set(0, 0, 0);
    table.localToWorld(_t);
    return { y: _t.y, onBench: true };
  }
  return { y: FLOOR_Y, onBench: false };
}

/** How long a fall of `heightM` metres takes, in ms (free fall, at least a short settle). */
export function fallMs(heightM: number): number {
  return Math.max(120, Math.min(900, 1000 * Math.sqrt((2 * Math.max(0, heightM)) / G)));
}

/** Free fall: slow at the top, fast at the bottom. */
export const fallEase = (t: number): number => t * t;
