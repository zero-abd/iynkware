import { describe, expect, test } from 'vitest';
import {
  BENCH_PLACE_KEY,
  beginBenchDrag,
  createBenchPlaceStore,
  draggedTop,
  facingYaw,
  orbitedTop,
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

describe('bench/pose: carried round the person', () => {
  const EYE: MVec3 = [0, 1.2, 0];
  // Straight ahead of the eyes, facing them; the bar's centre 0.3 m nearer than the top's centre.
  const AHEAD: TopPose = { position: [0, 0.74, -0.6], yawRad: 0 };
  const grip: MVec3 = [0, 0.75, -0.3];

  test('held still, the bench does not move or turn', () => {
    const hold = beginBenchDrag(AHEAD, hand(grip), grip);
    const t = orbitedTop(hold, hand(grip), 0, EYE);
    near(t.position, AHEAD.position);
    expect(t.yawRad).toBeCloseTo(0, 9);
  });

  test('carried round to the left, it turns to keep facing the eyes and the bar stays in the hand', () => {
    const hold = beginBenchDrag(AHEAD, hand(grip), grip);
    // The hand swings the bar a quarter turn to the left round the eyes: from 0.3 m ahead to 0.3 m to the left.
    const t = orbitedTop(hold, hand([-0.3, 0.75, 0]), 0, EYE);
    expect(t.yawRad).toBeCloseTo(Math.PI / 2, 6);
    near(t.position, [-0.6, 0.74, 0]);
    expect(facingYaw(t.position, EYE)).toBeCloseTo(t.yawRad, 6);
  });

  test('a ray swung to the right swings the bench round on a circle, still facing the eyes', () => {
    const origin: MVec3 = [0, 1.0, 0];
    const dir: MVec3 = [grip[0] - origin[0], grip[1] - origin[1], grip[2] - origin[2]];
    const hold = beginBenchDrag(AHEAD, ray(origin, dir), grip);
    const a = -60 * (Math.PI / 180);
    const turned: MVec3 = [dir[0] * Math.cos(a) + dir[2] * Math.sin(a), dir[1], -dir[0] * Math.sin(a) + dir[2] * Math.cos(a)];
    const t = orbitedTop(hold, ray(origin, turned), 0, [0, 1.2, 0]);
    expect(t.yawRad).toBeCloseTo(a, 6);
    expect(Math.hypot(t.position[0], t.position[2])).toBeCloseTo(0.6, 6);
    expect(t.position[1]).toBeCloseTo(0.74, 6);
  });

  test('right at the eyes it keeps its turn, and it stays above the floor', () => {
    const hold = beginBenchDrag(AHEAD, hand(grip), grip);
    const close = orbitedTop(hold, hand([0, 0.75, 0.3]), 0, EYE);
    expect(close.yawRad).toBe(0);
    expect(facingYaw([0.05, 0, 0.05], EYE)).toBeNull();
    expect(orbitedTop(hold, hand([0, -1, -0.3]), 0, EYE).position[1]).toBe(FLOOR_CLEAR);
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
