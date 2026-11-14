import { describe, expect, it } from 'vitest';
import { BoxGeometry, Vector3 } from '@iwsdk/core';
import { arcPoint, cornerPose, flightMs, seatedPose, turnTo, wireControl, yawTowards } from '../../src/assistant/presence/pose';
import { spotsOf } from '../../src/assistant/presence/spots';
import { bandOf, hullOf, merge, paintBands, paintFlat } from '../../src/assistant/presence/ink';

const close = (a: Vector3, b: Vector3) => a.distanceTo(b) < 1e-9;

describe('where a step puts things (board frame)', () => {
  it('puts a board with its footprint corner on the placement, turned about that corner', () => {
    const fp = { x: -0.03, z: -0.02, w: 0.06, d: 0.04 };
    const p = cornerPose(fp, -90, 10);
    expect(close(p.position, new Vector3(-0.09 + 0.03, 0, 0.01 + 0.02))).toBe(true);
    expect(p.yaw).toBeCloseTo(0);
    // Turned 90 degrees: the corner stays on the placement, the centre swings round it.
    const q = cornerPose(fp, 0, 0, 90);
    expect(q.yaw).toBeCloseTo(-Math.PI / 2);
    const corner = new Vector3(fp.x, 0, fp.z).applyAxisAngle(new Vector3(0, 1, 0), q.yaw).add(q.position);
    expect(corner.length()).toBeLessThan(1e-9);
  });

  it('seats a part so its first two legs sit in their holes', () => {
    const anchors: Record<string, [number, number, number]> = { A: [-0.00127, -0.002, 0], K: [0.00127, -0.002, 0] };
    const holes: Record<string, Vector3> = { c14: new Vector3(0.05, 0.008, 0.02), c15: new Vector3(0.05, 0.008, 0.02254) };
    const p = seatedPose(
      [
        ['A', 'c14'],
        ['K', 'c15'],
      ],
      (leg) => anchors[leg],
      (hole) => holes[hole]?.clone() ?? null,
    )!;
    const at = (leg: string) => new Vector3(...anchors[leg]!).applyAxisAngle(new Vector3(0, 1, 0), p.yaw).add(p.position);
    expect(at('A').distanceTo(holes.c14!)).toBeLessThan(1e-9);
    expect(at('K').distanceTo(holes.c15!)).toBeLessThan(1e-9);
    expect(seatedPose([['A', 'z99']], (l) => anchors[l], () => null)).toBeNull();
  });

  it("draws a wire on the bench's own arc, above the higher end", () => {
    const a = new Vector3(0, 0.01, 0);
    const b = new Vector3(0.1, 0.002, 0);
    const c = wireControl(a, b);
    expect(c.x).toBeCloseTo(0.05);
    expect(c.y).toBeCloseTo(0.01 + 0.007 + 0.1 * 0.18);
  });
});

describe('the companion moves', () => {
  it('flies an arc that starts and ends where asked and rises between', () => {
    const a = new Vector3(-0.4, 0.3, -0.2);
    const b = new Vector3(0.36, 0.05, 0.1);
    const out = new Vector3();
    expect(close(arcPoint(a, b, 0.1, 0, out), a)).toBe(true);
    expect(close(arcPoint(a, b, 0.1, 1, out), b)).toBe(true);
    expect(arcPoint(a, b, 0.1, 0.5, out).y).toBeGreaterThan((a.y + b.y) / 2);
  });

  it('takes about the site move for a short flight and never drags a long one', () => {
    expect(flightMs(0)).toBe(450);
    expect(flightMs(0.3)).toBeGreaterThan(450);
    expect(flightMs(5)).toBe(1100);
  });

  it('turns the short way round', () => {
    expect(turnTo(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(turnTo(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(yawTowards(0, 1)).toBeCloseTo(0);
    expect(yawTowards(1, 0)).toBeCloseTo(Math.PI / 2);
  });
});

describe('where the assistant waits', () => {
  it('keeps the card and the companion off the dominant side, the shelf on it, and mirrors for the left hand', () => {
    const r = spotsOf({ posture: 'seated', dominantHand: 'right' });
    const l = spotsOf({ posture: 'seated', dominantHand: 'left' });
    expect(r.shelf.x).toBeGreaterThan(0);
    expect(r.card.x).toBeLessThan(0);
    expect(r.home.x).toBeLessThan(0);
    expect(l.shelf.x).toBeCloseTo(-r.shelf.x);
    expect(l.card.x).toBeCloseTo(-r.card.x);
    expect(l.cardTurn).toBeCloseTo(-r.cardTurn);
    // Raised over the back of the bench, so the eyes look down past it to the work.
    expect(r.card.y).toBeGreaterThan(0.2);
    expect(r.card.z).toBeLessThan(0);
    expect(spotsOf({ posture: 'standing', dominantHand: 'right' }).top.halfW).toBeGreaterThan(r.top.halfW);
  });
});

describe('the inked figure', () => {
  it('bands faces by the fixed light, merges into one geometry and grows an ink shell', () => {
    expect(bandOf(0, 1, 0)).toBe('l');
    expect(bandOf(0, -1, 0)).toBe('d');
    const a = paintBands(new BoxGeometry(0.01, 0.01, 0.01), '#f4b829');
    const b = paintFlat(new BoxGeometry(0.002, 0.002, 0.002), '#231e16');
    const m = merge([a, b]);
    expect(m.getAttribute('position').count).toBe(a.getAttribute('position').count + b.getAttribute('position').count);
    expect(m.getAttribute('color').count).toBe(m.getAttribute('position').count);
    const h = hullOf(m, 0.001);
    m.computeBoundingBox();
    h.computeBoundingBox();
    expect(h.boundingBox!.max.x).toBeGreaterThan(m.boundingBox!.max.x);
  });
});
