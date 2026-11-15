import { describe, expect, test } from 'vitest';
import { LANGS } from '../src/contracts/common';
import { say } from '../src/shell/copy';
import { SESSION } from '../src/shell/session-controls/copy';
import { createHold } from '../src/shell/session-controls/hold';
import { lerpPose, recentreTarget } from '../src/shell/session-controls/recentre';
import { angleDiff, CLUSTER, clusterHome, headingTracker, yawOfForward } from '../src/shell/session-controls/spot';

const DEG = Math.PI / 180;

describe('recentre target', () => {
  test('straight ahead: front edge 0.15 m from the eyes, centre half a depth further, top 0.47 m under the eyes', () => {
    const t = recentreTarget([0, 1.2, 0], [0, 0, -1], 'seated');
    expect(t.yawRad).toBeCloseTo(0, 9);
    expect(t.position[0]).toBeCloseTo(0, 9);
    expect(t.position[1]).toBeCloseTo(0.73, 9);
    expect(t.position[2]).toBeCloseTo(-0.4, 9);
  });

  test('follows the heading and ignores pitch', () => {
    // looking along +x and down: the bench is on +x, turned so the person is at its +z side
    const t = recentreTarget([1, 1.2, 2], [1, -0.8, 0], 'seated');
    expect(t.position[0]).toBeCloseTo(1.4, 6);
    expect(t.position[2]).toBeCloseTo(2, 6);
    const back = [Math.sin(t.yawRad), Math.cos(t.yawRad)];
    expect(back[0]).toBeCloseTo(-1, 6);
    expect(back[1]).toBeCloseTo(0, 6);
  });

  test('standing is deeper and its height is clamped for the posture', () => {
    const t = recentreTarget([0, 1.7, 0], [0, 0, -1], 'standing');
    expect(t.position[1]).toBeCloseTo(1.2, 9);
    expect(t.position[2]).toBeCloseTo(-(0.15 + 0.275), 9);
    expect(recentreTarget([0, 0.9, 0], [0, 0, -1], 'seated').position[1]).toBeCloseTo(0.62, 9);
  });

  test('straight up or down keeps the given yaw', () => {
    expect(recentreTarget([0, 1.2, 0], [0, 1, 0], 'seated', 0.7).yawRad).toBeCloseTo(0.7, 9);
  });
});

describe('eased move', () => {
  test('ends exactly on the target and starts on the origin', () => {
    const a = { position: [0, 0.7, -0.6] as const, yawRad: 0 };
    const b = { position: [1, 0.8, 0.4] as const, yawRad: 1 };
    expect(lerpPose(a, b, 0)).toEqual({ position: [0, 0.7, -0.6], yawRad: 0 });
    expect(lerpPose(a, b, 1).position).toEqual([1, 0.8, 0.4]);
    expect(lerpPose(a, b, 0.5).yawRad).toBeCloseTo(0.5, 9);
  });

  test('turns the short way round', () => {
    const a = { position: [0, 0, 0] as const, yawRad: 170 * DEG };
    const b = { position: [0, 0, 0] as const, yawRad: -170 * DEG };
    expect(lerpPose(a, b, 0.5).yawRad).toBeCloseTo(180 * DEG, 6);
    expect(angleDiff(350 * DEG, 10 * DEG)).toBeCloseTo(20 * DEG, 9);
  });
});

describe('default place of the cluster', () => {
  const eye = [0, 1.5, 0] as const;

  test('on the left, out of the forward view, 0.8 to 0.9 m away and a little below eye level, facing the eyes', () => {
    const { position: p, faceTo } = clusterHome(eye, [0, 0, -1]);
    expect(Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2])).toBeCloseTo(CLUSTER.distance, 9);
    expect(CLUSTER.distance).toBeGreaterThanOrEqual(0.8);
    expect(CLUSTER.distance).toBeLessThanOrEqual(0.9);
    // left of the heading (looking down -z, left is -x), round past the panel ring's side slot, still ahead of the
    // shoulders (about 0.1 m behind the eyes)
    expect(p[0]).toBeLessThan(-0.8);
    expect(p[2]).toBeLessThan(0);
    const off = Math.atan2(-p[0], -p[2]) / DEG;
    expect(off).toBeCloseTo(-CLUSTER.sideDeg, 6);
    expect(off).toBeGreaterThan(45);
    // below eye level, but well above the bench top (eye height minus 0.47 m)
    expect(p[1]).toBeCloseTo(1.5 - CLUSTER.distance * Math.sin(CLUSTER.belowDeg * DEG), 9);
    expect(p[1]).toBeLessThan(1.5 - 0.05);
    expect(p[1]).toBeGreaterThan(1.5 - 0.4);
    expect(faceTo).toEqual(eye);
  });

  test('takes the heading only: looking down at the bench puts it in the same place', () => {
    const level = clusterHome(eye, [0, 0, -1]).position;
    const down = clusterHome(eye, [0, -0.9, -0.3]).position;
    for (let i = 0; i < 3; i++) expect(down[i]).toBeCloseTo(level[i]!, 9);
  });

  test('turns with the heading and moves with where the person stands', () => {
    // facing +x, the left is -z
    const p = clusterHome([2, 1.2, 1], [1, 0, 0]).position;
    expect(p[0]).toBeGreaterThan(2);
    expect(p[2]).toBeLessThan(1 - 0.5);
    expect(Math.hypot(p[0] - 2, p[1] - 1.2, p[2] - 1)).toBeCloseTo(CLUSTER.distance, 9);
  });

  test('straight up or down keeps the given heading', () => {
    const kept = clusterHome(eye, [0, -1, 0], Math.PI / 2).position;
    const facing = clusterHome(eye, [-1, 0, 0]).position;
    for (let i = 0; i < 3; i++) expect(kept[i]).toBeCloseTo(facing[i]!, 9);
    expect(yawOfForward(0, 0, 0.3)).toBe(0.3);
  });
});

describe('exit guard', () => {
  test('fires once, after the full hold', () => {
    let n = 0;
    const h = createHold(700, () => n++);
    h.press(1);
    h.tick(300);
    expect(n).toBe(0);
    expect(h.progress).toBeCloseTo(300 / 700, 9);
    h.tick(300);
    expect(n).toBe(0);
    h.tick(300);
    expect(n).toBe(1);
    h.tick(2000);
    expect(n).toBe(1);
  });

  test('letting go early cancels and empties the ring', () => {
    let n = 0;
    const h = createHold(700, () => n++);
    h.press(1);
    h.tick(600);
    h.release(1);
    expect(h.progress).toBe(0);
    h.tick(600);
    expect(n).toBe(0);
    h.press(1);
    h.tick(600);
    expect(n).toBe(0);
  });

  test('a tap does nothing, and one long press cannot fire twice', () => {
    let n = 0;
    const h = createHold(700, () => n++);
    h.press(1);
    h.tick(16);
    h.release(1);
    expect(n).toBe(0);
    h.press(1);
    h.tick(800);
    h.tick(800);
    expect(n).toBe(1);
    h.release(1);
    h.press(1);
    h.tick(800);
    expect(n).toBe(2);
  });

  test('two pointers: the hold goes on while either is down', () => {
    let n = 0;
    const h = createHold(700, () => n++);
    h.press(1);
    h.press(2);
    h.tick(400);
    h.release(1);
    h.tick(400);
    expect(n).toBe(1);
  });
});

describe('the heading Recentre uses', () => {
  const CL = 86 * DEG; // the cluster, on the left of a person facing yaw 0

  test('turning to the buttons on the left keeps the heading held before', () => {
    const h = headingTracker(0);
    for (let i = 0; i < 60; i++) h.update(0, CL, 1 / 60);
    // A smooth quarter turn to the left in a third of a second, then reading the buttons for two seconds.
    for (let i = 1; i <= 20; i++) h.update((90 * DEG * i) / 20, CL, 1 / 60);
    for (let i = 0; i < 120; i++) h.update(90 * DEG, CL, 1 / 60);
    expect(h.heading(90 * DEG, CL)).toBeCloseTo(0, 9);
  });

  test('a new heading held for half a second elsewhere is the heading', () => {
    const h = headingTracker(0);
    for (let i = 0; i < 40; i++) h.update(180 * DEG, CL, 1 / 60);
    // Turned round, the buttons are now on the right; looking at them still recentres to the way they faced.
    expect(h.heading(CL, CL)).toBeCloseTo(Math.PI, 9);
  });

  test('a glance does not count, and a head not at the buttons is its own heading', () => {
    const h = headingTracker(0);
    for (let i = 0; i < 15; i++) h.update(-120 * DEG, CL, 1 / 60);
    expect(h.heading(80 * DEG, CL)).toBeCloseTo(0, 9);
    expect(h.heading(-30 * DEG, CL)).toBeCloseTo(-30 * DEG, 9);
    expect(h.heading(10 * DEG, null)).toBeCloseTo(10 * DEG, 9);
    h.reset(0.4);
    expect(h.heading(CL, CL)).toBeCloseTo(0.4, 9);
  });
});

describe('copy', () => {
  test('six languages, none empty', () => {
    for (const l of LANGS) for (const k of ['recentre', 'exit', 'hold'] as const) expect(say(SESSION, l, k).length).toBeGreaterThan(0);
  });
});
