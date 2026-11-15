import { describe, expect, it } from 'vitest';
import type { Course } from '@/lib/flight';
import { HERE_FIELD_M, hereCourse, hereMap, hereVolume } from '../src/range/flight/here';

const course = {
  id: 'c',
  title: 'C',
  brief: '',
  field: 12,
  pad: [2, 3],
  ground: 'grass',
  wind: { base: 0, gust: 0 },
  prims: [{ type: 'pole', x: 1, y: 1, h: 2 }],
  gates: [{ x: 4, y: 4, heading: 0, w: 1, h: 1 }],
  checkpoints: [],
  missions: [],
} as unknown as Course;

describe('simulate here', () => {
  it('flies an open field with nothing in it, pad in the middle', () => {
    const c = hereCourse(course);
    expect(c.field).toBe(HERE_FIELD_M);
    expect(c.pad).toEqual([HERE_FIELD_M / 2, HERE_FIELD_M / 2]);
    expect(c.prims).toEqual([]);
    expect(c.gates).toEqual([]);
    expect(c.id).toBe('c');
    expect(course.gates).toHaveLength(1);
  });

  it('puts the pad on the bench spot at real size, the bench top as the ground', () => {
    const head = { x: 1, z: 2, heading: { fx: 0, fz: -1 } };
    const spot = { x: 1.2, y: 0.85, z: 1.4 };
    const v = hereVolume(head, spot);
    const c = hereCourse(course);
    const map = hereMap(v, c, 40, spot);
    expect(map.k).toBe(1);
    const out: [number, number, number] = [0, 0, 0];
    map.toRoom(c.pad[0], c.pad[1], 0, out);
    expect(out[0]).toBeCloseTo(1.2);
    expect(out[1]).toBeCloseTo(0.85);
    expect(out[2]).toBeCloseTo(1.4);
    // one course metre up is one metre up; course +y is away from the person (world -z here)
    map.toRoom(c.pad[0], c.pad[1] + 1, 1, out);
    expect(out[1]).toBeCloseTo(1.85);
    expect(out[2]).toBeCloseTo(0.4);
  });
});
