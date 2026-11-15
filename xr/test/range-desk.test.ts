import { describe, expect, it } from 'vitest';
import { deskFrame, keySticks } from '../src/range/flight/desk/logic';
import { DESK_STRINGS } from '../src/range/flight/desk/strings';
import { stringProblems } from '../src/range/shared';

const sticks = () => ({ throttle: 0, yaw: 0, pitch: 0, roll: 0 });

describe('keySticks', () => {
  it('hovers with no key held', () => {
    expect(keySticks(new Set(), sticks())).toEqual({ throttle: 0.5, yaw: 0, pitch: 0, roll: 0 });
  });
  it('maps W, D, Up and Right like the mode 2 thumbsticks', () => {
    expect(keySticks(new Set(['KeyW', 'KeyD', 'ArrowUp', 'ArrowRight']), sticks())).toEqual({ throttle: 1, yaw: 1, pitch: 1, roll: -1 });
    expect(keySticks(new Set(['KeyS', 'KeyA', 'ArrowDown', 'ArrowLeft']), sticks())).toEqual({ throttle: 0, yaw: -1, pitch: -1, roll: 1 });
  });
  it('cancels opposite keys', () => {
    expect(keySticks(new Set(['KeyW', 'KeyS']), sticks()).throttle).toBe(0.5);
  });
});

describe('deskFrame', () => {
  it('stands behind and above the head and looks ahead and down', () => {
    const f = deskFrame({ x: 0, y: 1.6, z: 0, heading: { fx: 0, fz: -1 } as never });
    expect(f.position[2]).toBeGreaterThan(0);
    expect(f.position[1]).toBeGreaterThan(1.6);
    expect(f.target[2]).toBeLessThan(0);
    expect(f.target[1]).toBeLessThan(1.6);
  });
});

describe('desk strings', () => {
  it('has every key in six languages', () => {
    expect(stringProblems(DESK_STRINGS.table)).toEqual([]);
  });
});
