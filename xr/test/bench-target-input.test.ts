/** Steadying and gesture thresholds (bench/core/steady.ts, gesture.ts). */
import { describe, expect, it } from 'vitest';
import { createOneEuro3 } from '../src/bench/core/steady';
import {
  BOARD_YAW,
  createFlick,
  createPressTracker,
  createPullTracker,
  createTrackingLoss,
  createYawStepper,
} from '../src/bench/core/gesture';

const HZ = 90;

describe('one-euro steadying', () => {
  it('passes the first sample through and holds a still point exactly', () => {
    const f = createOneEuro3();
    f.filter(0, 0.1, 0.2, 0.3);
    expect([f.x, f.y, f.z]).toEqual([0.1, 0.2, 0.3]);
    for (let i = 1; i < 30; i++) f.filter(i / HZ, 0.1, 0.2, 0.3);
    expect([f.x, f.y, f.z]).toEqual([0.1, 0.2, 0.3]);
  });

  it('settles on a new point within a second', () => {
    const f = createOneEuro3();
    f.filter(0, 0, 0, 0);
    let t = 0;
    for (let i = 1; i <= HZ; i++) f.filter((t = i / HZ), 0.01, 0, -0.01);
    expect(Math.abs(f.x - 0.01)).toBeLessThan(1e-4);
    expect(Math.abs(f.z + 0.01)).toBeLessThan(1e-4);
    // and part way there after a quarter of a second, so it lags but follows
    const g = createOneEuro3();
    g.filter(0, 0, 0, 0);
    for (let i = 1; i <= HZ / 4; i++) g.filter(i / HZ, 0.01, 0, 0);
    expect(g.x).toBeGreaterThan(0.005);
    expect(g.x).toBeLessThan(0.0099);
    expect(t).toBe(1);
  });

  it('takes most of the tremor out of a held point', () => {
    const f = createOneEuro3();
    let seed = 3;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.004;
    let raw = 0;
    let out = 0;
    for (let i = 0; i < 2 * HZ; i++) {
      const n = noise();
      f.filter(i / HZ, n, 0, 0);
      if (i > HZ / 2) {
        raw += n * n;
        out += f.x * f.x;
      }
    }
    expect(Math.sqrt(out / raw)).toBeLessThan(0.4);
  });

  it('ignores a repeated timestamp and starts afresh after reset', () => {
    const f = createOneEuro3();
    f.filter(0, 0, 0, 0);
    f.filter(1 / HZ, 1, 1, 1);
    const x = f.x;
    f.filter(1 / HZ, 5, 5, 5);
    expect(f.x).toBe(x);
    f.reset();
    expect(f.primed).toBe(false);
    f.filter(2 / HZ, 5, 5, 5);
    expect([f.x, f.y, f.z]).toEqual([5, 5, 5]);
  });
});

describe('tap or hold', () => {
  it('is a tap when released within 300 ms having moved under 10 mm', () => {
    const p = createPressTracker();
    p.start(0, 0, 0, 0);
    expect(p.move(100, 0.005, 0, 0)).toBe('pending');
    expect(p.end(250)).toBe('tap');
    expect(p.kind).toBe('idle');
  });

  it('is a hold when it lasts longer or moves 10 mm, known before the release', () => {
    const p = createPressTracker();
    p.start(0, 0, 0, 0);
    expect(p.move(301, 0, 0, 0)).toBe('hold');
    expect(p.end(320)).toBe('hold');
    p.start(1000, 0, 0, 0);
    expect(p.move(1050, 0, 0.007, 0.008)).toBe('hold');
    expect(p.end(1100)).toBe('hold');
    p.start(2000, 0, 0, 0);
    expect(p.end(2350)).toBe('hold');
  });
});

describe('pull threshold', () => {
  it('keeps a seated part tethered until it is lifted one pitch of work, then lets it go', () => {
    const pull = createPullTracker();
    // one pitch at 3x is 7.62 mm of world
    expect(pull.update(0.007, 3)).toBe('tether');
    expect(pull.update(0.0077, 3)).toBe('pulled');
    expect(pull.update(0, 3)).toBe('pulled');
    pull.reset();
    expect(pull.update(0.0077, 4)).toBe('tether');
  });
});

describe('wrist yaw', () => {
  it('turns in quarter turns with 15 degrees of hysteresis either way', () => {
    const yaw = createYawStepper();
    yaw.reset(0);
    expect(yaw.update(59)).toBe(0);
    expect(yaw.update(61)).toBe(1);
    expect(yaw.update(40)).toBe(1);
    expect(yaw.update(31)).toBe(1);
    expect(yaw.update(29)).toBe(0);
    expect(yaw.update(-61)).toBe(-1);
  });

  it('unwraps across 180 degrees', () => {
    const yaw = createYawStepper();
    yaw.reset(170);
    expect(yaw.update(-170)).toBe(0);
    expect(yaw.update(-100)).toBe(1);
  });

  it('turns boards in 15 degree steps', () => {
    const yaw = createYawStepper(BOARD_YAW);
    yaw.reset(0);
    expect(yaw.update(10)).toBe(0);
    expect(yaw.update(11)).toBe(1);
    expect(yaw.update(47)).toBe(3);
  });
});

describe('thumbstick flick', () => {
  it('fires once past 0.7 and again only after coming back under 0.3', () => {
    const flick = createFlick();
    expect([0.5, 0.75, 0.9, 0.5, 0.75, 0.2, 0.8, -0.1, -0.71].map((x) => flick.update(x))).toEqual([0, 1, 0, 0, 0, 0, 1, 0, -1]);
  });
});

describe('tracking loss', () => {
  it('freezes a held part, then sends it back after 500 ms', () => {
    const loss = createTrackingLoss();
    expect(loss.update(0)).toBe('tracking');
    loss.lost(100, 'place');
    expect(loss.update(599)).toBe('frozen');
    expect(loss.update(600)).toBe('return');
    expect(loss.update(700)).toBe('over');
    loss.found();
    expect(loss.update(800)).toBe('tracking');
  });

  it('drops a pending wire after 1000 ms, and nothing happens when tracking comes back first', () => {
    const loss = createTrackingLoss();
    loss.lost(0, 'wire');
    expect(loss.update(999)).toBe('frozen');
    expect(loss.update(1000)).toBe('drop');
    loss.found();
    loss.lost(2000, 'hold');
    expect(loss.update(2400)).toBe('frozen');
    loss.found();
    expect(loss.update(2600)).toBe('tracking');
  });
});
