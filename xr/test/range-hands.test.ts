/** Hand flight logic: the hold-to-arm timer, pinch glue, claim lifecycle, guide target mapping, strings. */
import { describe, expect, it } from 'vitest';
import type { Sticks } from '@/lib/flight';
import { handSticks, type Out3 } from '../src/range/flight/core';
import { ARM_HOLD_MS, ClaimGate, guideTarget, HoldTimer, PinchTrack, ringOffset } from '../src/range/flight/hands/logic';
import { HANDS_STRINGS } from '../src/range/flight/hands/strings';
import { stringProblems } from '../src/range/shared';

const heading = { fx: 0, fz: -1 };
const hold = (by: 'pinch' | 'grip', s: [number, number, number], p: [number, number, number]) => ({ by, start: s, position: p, sinceMs: 0 });

describe('hold to arm', () => {
  it('fires once after 600 ms and not before', () => {
    const t = new HoldTimer();
    t.press();
    expect(t.tick(300)).toBe(false);
    expect(t.progress).toBeCloseTo(0.5, 1);
    expect(t.tick(299)).toBe(false);
    expect(t.tick(2)).toBe(true);
    expect(t.tick(100)).toBe(false);
    expect(ARM_HOLD_MS).toBe(600);
  });
  it('an early release does nothing and the next press starts over', () => {
    const t = new HoldTimer();
    t.press();
    t.tick(500);
    t.release();
    expect(t.tick(500)).toBe(false);
    expect(t.progress).toBe(0);
    t.press();
    expect(t.tick(599)).toBe(false);
    expect(t.tick(1)).toBe(true);
  });
  it('arms again after a release', () => {
    const t = new HoldTimer();
    t.press();
    expect(t.tick(700)).toBe(true);
    t.release();
    t.press();
    expect(t.tick(600)).toBe(true);
  });
});

describe('pinch to GimbalPinch', () => {
  it('fixes the origin at the start and follows the point; a grip or none is not a pinch', () => {
    const t = new PinchTrack(heading);
    expect(t.update(null)).toBeNull();
    expect(t.update(hold('grip', [0, 1, 0], [0, 1, 0]))).toBeNull();
    const p = t.update(hold('pinch', [0, 1, -0.4], [0, 1, -0.4]))!;
    expect(t.began).toBe(true);
    t.update(hold('pinch', [9, 9, 9], [0, 1.03, -0.45]));
    expect(t.began).toBe(false);
    expect([...p.origin]).toEqual([0, 1, -0.4]);
    expect(p.point[2]).toBeCloseTo(-0.45);
    expect(t.update(null)).toBeNull();
    expect(t.active).toBe(false);
  });
  it('left hand up climbs, right hand away pitches', () => {
    const l = new PinchTrack(heading), r = new PinchTrack(heading);
    const out: Sticks = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    handSticks(l.update(hold('pinch', [0, 1, 0], [0, 1.06, 0])), r.update(hold('pinch', [0.2, 1, 0], [0.2, 1, -0.06])), out);
    expect(out.throttle).toBeCloseTo(1);
    expect(out.pitch).toBeCloseTo(1);
    handSticks(l.update(null), r.update(null), out);
    expect(out).toEqual({ throttle: 0.5, yaw: 0, pitch: 0, roll: 0 });
  });
  it('ring offset is capped at 60 mm', () => {
    const t = new PinchTrack(heading);
    const p = t.update(hold('pinch', [0, 1, 0], [0.3, 1, 0]))!;
    const o = { a: 0, b: 0 };
    ringOffset(p, 'right', o);
    expect(o.a).toBeCloseTo(0.06);
    expect(o.b).toBeCloseTo(0);
  });
});

describe('claim lifecycle', () => {
  it('claims on the first pinch and releases once when both let go', () => {
    let claims = 0, releases = 0;
    const g = new ClaimGate(() => {
      claims++;
      return () => releases++;
    });
    g.set(false);
    g.set(true);
    g.set(true);
    expect([claims, releases, g.claimed]).toEqual([1, 0, true]);
    g.set(false);
    g.set(false);
    expect([claims, releases, g.claimed]).toEqual([1, 1, false]);
    g.set(true);
    expect(claims).toBe(2);
  });
});

describe('guide target', () => {
  const map = {
    field: 20,
    ceiling: 10,
    toCourse: (x: number, y: number, z: number, o: Out3): Out3 => ((o[0] = x * 10), (o[1] = -z * 10), (o[2] = y * 10), o),
    toRoom: (x: number, y: number, z: number, o: Out3): Out3 => ((o[0] = x / 10), (o[1] = z / 10), (o[2] = -y / 10), o),
  };
  it('moves with the hand from the craft, and clamps inside the field', () => {
    const c: Out3 = [0, 0, 0], w: Out3 = [0, 0, 0];
    guideTarget(map, [0.5, 0.5, -1], [0, 1, 0], [0.1, 1, -0.2], c, w);
    expect(c[0]).toBeCloseTo(6);
    expect(c[1]).toBeCloseTo(12);
    expect(w[0]).toBeCloseTo(0.6);
    guideTarget(map, [0.5, 0.5, -1], [0, 1, 0], [5, 9, -9], c, w);
    expect(c[0]).toBe(19);
    expect(c[1]).toBe(19);
    expect(c[2]).toBe(8.5);
  });
});

describe('strings', () => {
  it('six languages, no exclamation marks', () => {
    expect(stringProblems(HANDS_STRINGS.table)).toEqual([]);
  });
});
