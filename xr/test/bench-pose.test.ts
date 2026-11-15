import { describe, expect, test } from 'vitest';
import {
  BENCH_PLACE_KEY,
  beginBenchDrag,
  createBenchPlaceStore,
  draggedTop,
  FLOOR_CLEAR,
  formatBenchPlace,
  parseBenchPlace,
  type TopPose,
} from '../src/bench/pose/move';
import type { MVec3 } from '../src/ui/panels/drag';
import type { StorageLike } from '../src/ui/panels/store';

const near = (a: readonly number[], b: readonly number[], d = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i] ?? NaN, d));
const unit = (d: MVec3): MVec3 => {
  const l = Math.hypot(...d);
  return [d[0] / l, d[1] / l, d[2] / l];
};
const ray = (origin: MVec3, direction: MVec3) => ({ origin, direction: unit(direction), mode: 'ray' as const });
const hand = (origin: MVec3) => ({ origin, direction: [0, 0, -1] as MVec3, mode: 'grab' as const });
const TOP: TopPose = { position: [0, 0.74, -0.6], yawRad: 0.3 };

describe('bench/pose: moving the bench by its grip bar', () => {
  test('a hand at the bar carries the bench in all three dimensions, level and keeping its turn', () => {
    const at: MVec3 = [0.02, 0.75, -0.29];
    const hold = beginBenchDrag(TOP, hand(at), at);
    near(draggedTop(hold, hand(at), TOP.yawRad).position, TOP.position);
    const moved = draggedTop(hold, hand([0.22, 0.95, -0.49]), TOP.yawRad);
    near(moved.position, [0.2, 0.94, -0.8]);
    expect(moved.yawRad).toBe(0.3);
  });

  test('a ray holds the bar at the depth it hit it: the bench swings with the ray', () => {
    const origin: MVec3 = [0, 1.0, 0];
    const hitPoint: MVec3 = [0, 0.75, -0.3];
    const dir: MVec3 = [hitPoint[0] - origin[0], hitPoint[1] - origin[1], hitPoint[2] - origin[2]];
    const depth = Math.hypot(...dir);
    const hold = beginBenchDrag(TOP, ray(origin, dir), hitPoint);
    near(draggedTop(hold, ray(origin, dir), 0).position, TOP.position);
    // Raise the ray to level: the held point comes up to the ray's height, depth ahead, and the bench rises with it.
    const up = draggedTop(hold, ray(origin, [0, 0, -1]), 0).position;
    near(up, [0, 1.0 + (0.74 - 0.75), -depth + (-0.6 + 0.3)]);
    // Move the controller 0.1 m right and 0.2 m up without turning it: the bench translates by the same.
    const slid = draggedTop(hold, ray([0.1, 1.2, 0], dir), 0).position;
    near(slid, [0.1, 0.94, -0.6]);
  });

  test('the top never goes under the floor clearance', () => {
    const at: MVec3 = [0, 0.75, -0.3];
    const hold = beginBenchDrag(TOP, hand(at), at);
    const low = draggedTop(hold, hand([0, -1, -0.3]), 0);
    expect(low.position[1]).toBe(FLOOR_CLEAR);
    near([low.position[0], low.position[2]], [0, -0.6]);
    expect(draggedTop(hold, hand([0, 0.3, -0.3]), 0).position[1]).toBeCloseTo(0.29, 6);
  });
});

describe('bench/pose: the kept place', () => {
  test('records round trip, rounded; broken or far ones are none', () => {
    const p = parseBenchPlace(formatBenchPlace({ position: [0.123456, 0.9, -0.5], yawRad: -0.25 }));
    expect(p).toEqual({ position: [0.1235, 0.9, -0.5], yawRad: -0.25 });
    expect(parseBenchPlace(null)).toBeNull();
    expect(parseBenchPlace('{')).toBeNull();
    expect(parseBenchPlace('{"v":2,"position":[0,1,0],"yawRad":0}')).toBeNull();
    expect(parseBenchPlace('{"v":1,"position":[0,1],"yawRad":0}')).toBeNull();
    expect(parseBenchPlace('{"v":1,"position":[0,1,99],"yawRad":0}')).toBeNull();
    expect(parseBenchPlace('{"v":1,"position":[0,1,0]}')).toBeNull();
    expect(parseBenchPlace('{"v":1,"position":[0,-2,0],"yawRad":0}')?.position[1]).toBe(FLOOR_CLEAR);
  });

  test('the store keeps the place in storage, clears it, and lives on when storage throws', () => {
    const mem = new Map<string, string>();
    const storage: StorageLike = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
    const a = createBenchPlaceStore(storage);
    expect(a.get()).toBeNull();
    a.set({ position: [0.1, 0.8, -0.7], yawRad: 0 });
    expect(mem.has(BENCH_PLACE_KEY)).toBe(true);
    expect(createBenchPlaceStore(storage).get()).toEqual({ position: [0.1, 0.8, -0.7], yawRad: 0 });
    a.clear();
    expect(mem.has(BENCH_PLACE_KEY)).toBe(false);
    expect(createBenchPlaceStore(storage).get()).toBeNull();

    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => undefined,
    };
    const b = createBenchPlaceStore(broken);
    b.set({ position: [0, 0.7, -0.6], yawRad: 0 });
    expect(b.get()?.position).toEqual([0, 0.7, -0.6]);
  });
});
