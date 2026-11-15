import { describe, expect, test } from 'vitest';
import { LANGS } from '../src/contracts/common';
import { say } from '../src/shell/copy';
import { SESSION } from '../src/shell/session-controls/copy';
import { angleDiff, clusterSpot, FOLLOW, startFollow, stepFollow, yawOfForward } from '../src/shell/session-controls/follow';
import { createHold } from '../src/shell/session-controls/hold';
import { lerpPose, recentreTarget } from '../src/shell/session-controls/recentre';

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

describe('lazy follow', () => {
  const head = (yaw: number) => ({ x: 0, y: 1.5, z: 0, yaw });

  test('a small turn does not move it', () => {
    const s = startFollow(head(0));
    for (let i = 0; i < 90; i++) stepFollow(s, head(20 * DEG), 1 / 90);
    expect(s.yaw).toBe(0);
  });

  test('a big turn drags it after the head, and it settles within the rest angle once the head stops', () => {
    const s = startFollow(head(0));
    stepFollow(s, head(60 * DEG), 1 / 90);
    expect(s.chasingYaw).toBe(true);
    expect(s.yaw).toBeLessThan(60 * DEG);
    for (let i = 0; i < 90 * 4; i++) stepFollow(s, head(60 * DEG), 1 / 90);
    expect(s.chasingYaw).toBe(false);
    expect(Math.abs(s.yaw - 60 * DEG)).toBeLessThan(FOLLOW.restDeg * DEG);
    const settled = s.yaw;
    stepFollow(s, head(60 * DEG), 1 / 90);
    expect(s.yaw).toBe(settled);
  });

  test('walking away brings it along', () => {
    const s = startFollow(head(0));
    for (let i = 0; i < 90 * 4; i++) stepFollow(s, { x: 1, y: 1.5, z: 0, yaw: 0 }, 1 / 90);
    expect(s.x).toBeGreaterThan(0.95);
  });

  test('sits to the left, below eye level, at touch range', () => {
    const s = startFollow(head(0));
    const { position } = clusterSpot(s);
    expect(position[0]).toBeLessThan(-0.15);
    expect(position[1]).toBeLessThan(1.5 - 0.2);
    expect(Math.hypot(position[0], position[1] - 1.5, position[2])).toBeCloseTo(FOLLOW.distance, 6);
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

describe('copy', () => {
  test('six languages, none empty', () => {
    for (const l of LANGS) for (const k of ['recentre', 'exit', 'hold'] as const) expect(say(SESSION, l, k).length).toBeGreaterThan(0);
  });
});
