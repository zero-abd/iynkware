import { Euler, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { roomVolume } from '../src/range/flight/core';
import { chasePosition, fpvCamera, frameDue, nextView, verticalFov, type Quat } from '../src/range/flight/screen/model';
import { SCREEN_STRINGS } from '../src/range/flight/screen/strings';
import { stringProblems } from '../src/range/shared';

describe('range screen', () => {
  it('cycles los, chase, fpv', () => {
    expect(nextView('los')).toBe('chase');
    expect(nextView('chase')).toBe('fpv');
    expect(nextView('fpv')).toBe('los');
  });
  it('turns the horizontal fov into a 16:9 vertical one', () => {
    expect(verticalFov(90)).toBeCloseTo(58.7, 0);
    expect(verticalFov(105)).toBeLessThan(105);
  });
  it('FPV looks along the nose, tilted up, and agrees with three.js', () => {
    const out = { x: 0, y: 0, z: 0 };
    const q: Quat = { x: 0, y: 0, z: 0, w: 1 };
    fpvCamera({ x: 1, y: 1.2, z: -1, ry: Math.PI / 2, rx: 0, rz: 0 }, 30, out, q);
    const look = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w));
    // nose along +x for a yaw of 90 degrees, tilted up by 30
    expect(look.x).toBeCloseTo(Math.cos(Math.PI / 6), 5);
    expect(look.y).toBeCloseTo(Math.sin(Math.PI / 6), 5);
    expect(look.z).toBeCloseTo(0, 5);
    expect(out).toEqual({ x: 1, y: 1.2, z: -1 });
    // pitching and rolling with the craft: three's own euler composition gives the same camera
    fpvCamera({ x: 0, y: 1, z: 0, ry: 0.4, rx: 0.2, rz: 0.3 }, 0, out, q);
    const ref = new Quaternion().setFromEuler(new Euler(0.2, 0.4, 0.3, 'YXZ')).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI));
    expect(Math.abs(ref.x * q.x + ref.y * q.y + ref.z * q.z + ref.w * q.w)).toBeCloseTo(1, 5);
  });
  it('chase sits behind and above the craft, clamped inside the volume', () => {
    const v = roomVolume(0, 0, { fx: 0, fz: -1 });
    const out = { x: 0, y: 0, z: 0 };
    chasePosition({ x: 0, y: 1, z: -2, ry: Math.PI, rx: 0, rz: 0 }, v, out); // nose along -z, away from the head
    expect(out.z).toBeCloseTo(-1.3, 5);
    expect(out.y).toBeCloseTo(1.3, 5);
    expect(out.x).toBeCloseTo(0, 5);
    // a craft against the left net with its nose along -x: behind it is inside, so far left is clamped
    chasePosition({ x: -1.4, y: 0.15, z: -2, ry: -Math.PI / 2, rx: 0, rz: 0 }, v, out);
    expect(out.x).toBeGreaterThanOrEqual(-1.5);
    expect(out.y).toBeGreaterThanOrEqual(v.bottom);
    chasePosition({ x: 1.45, y: 2.1, z: -3.45, ry: Math.PI / 2, rx: 0, rz: 0 }, v, out);
    expect(out.x).toBeLessThanOrEqual(1.5);
    expect(out.z).toBeGreaterThanOrEqual(-v.far);
    expect(out.y).toBeLessThanOrEqual(v.top);
  });
  it('draws at 15 Hz and drops a stall rather than bursting', () => {
    const s = { t: 0 };
    let n = 0;
    for (let i = 0; i < 90; i++) if (frameDue(s, 1 / 90)) n++;
    expect(n).toBe(15);
    expect(frameDue(s, 5)).toBe(true);
    expect(frameDue(s, 0.001)).toBe(false);
  });
  it('has all six languages', () => {
    expect(stringProblems(SCREEN_STRINGS.table)).toEqual([]);
  });
});
