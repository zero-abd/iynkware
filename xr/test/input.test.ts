/** The input service's pure parts: which press grabs, which selects, and the hand's virtual stick. */
import { describe, expect, it } from 'vitest';
import {
  POSE_JOINTS,
  VIRTUAL_STICK_DEADZONE,
  VIRTUAL_STICK_FULL_M,
  fingersOpen,
  grabFlags,
  headingOf,
  isGrabPress,
  modeOf,
  palmNormal,
  sourceOf,
  virtualStick,
  type Heading,
  type PointerKind,
} from '../src/input/helpers';

/**
 * Packed joint poses for a hand lying palm down, fingers pointing -Z, wrist at the origin. `side` +1 puts the thumb
 * side at -X (a right hand), -1 at +X (a left hand). `reach` is how far the fingertips are from the wrist.
 */
function handJoints(side: 1 | -1, reach: number): Float32Array {
  const m = new Float32Array(POSE_JOINTS.length * 16);
  const put = (i: number, x: number, y: number, z: number) => m.set([x, y, z], i * 16 + 12);
  const xs = [-0.03, -0.01, 0.01, 0.03].map((x) => x * side);
  put(0, 0, 0, 0);
  xs.forEach((x, f) => put(1 + f, x, 0, -0.09));
  xs.forEach((x, f) => put(5 + f, x, 0, -reach));
  return m;
}

describe('hand pose helpers', () => {
  it('points the palm normal out of the palm for either hand', () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(palmNormal(handJoints(1, 0.18), 'right', out).map((v) => Math.round(v * 1000) / 1000 + 0)).toEqual([0, -1, 0]);
    expect(palmNormal(handJoints(-1, 0.18), 'left', out).map((v) => Math.round(v * 1000) / 1000 + 0)).toEqual([0, -1, 0]);
  });

  it('tells an open hand from a fist', () => {
    expect(fingersOpen(handJoints(1, 0.18))).toBe(true);
    expect(fingersOpen(handJoints(1, 0.08))).toBe(false);
  });
});

const KINDS: PointerKind[] = ['ray', 'grab', 'touch', 'gaze', 'mouse'];

describe('press classification', () => {
  it('maps grab options to near and distance', () => {
    expect(grabFlags(undefined)).toEqual({ near: false, distance: false });
    expect(grabFlags('none')).toEqual({ near: false, distance: false });
    expect(grabFlags('near')).toEqual({ near: true, distance: false });
    expect(grabFlags('distance')).toEqual({ near: false, distance: true });
    expect(grabFlags('both')).toEqual({ near: true, distance: true });
  });

  it('selects everything on an object that is not grabbable', () => {
    for (const kind of KINDS) expect(isGrabPress(kind, grabFlags('none'))).toBe(false);
  });

  it('grabs near with the grab sphere only, and keeps rays and pokes as selects', () => {
    const near = grabFlags('near');
    expect(KINDS.filter((k) => isGrabPress(k, near))).toEqual(['grab']);
  });

  it('grabs at a distance with every ray (controller, hand, gaze, mouse), never with a poke', () => {
    const distance = grabFlags('distance');
    expect(KINDS.filter((k) => isGrabPress(k, distance))).toEqual(['ray', 'gaze', 'mouse']);
    expect(KINDS.filter((k) => isGrabPress(k, grabFlags('both')))).toEqual(['ray', 'grab', 'gaze', 'mouse']);
  });

  it('names modes and sources the same for controllers and hands', () => {
    expect(KINDS.map(modeOf)).toEqual(['ray', 'grab', 'poke', 'ray', 'ray']);
    expect(sourceOf('ray', true)).toBe('hand');
    expect(sourceOf('ray', false)).toBe('controller');
    expect(sourceOf('touch', true)).toBe('hand');
    expect(sourceOf('grab', false)).toBe('controller');
    expect(sourceOf('mouse', true)).toBe('mouse');
    expect(sourceOf('gaze', false)).toBe('gaze');
  });
});

/** Quaternion for a yaw (radians, about +Y) then a pitch (about the new +X). */
function yawPitch(yaw: number, pitch: number): [number, number, number, number] {
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  // q = qYaw * qPitch
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

describe('heading', () => {
  const h: Heading = { fx: 0, fz: 0 };

  it('is -Z for the identity', () => {
    headingOf(0, 0, 0, 1, h);
    expect(h.fx).toBeCloseTo(0);
    expect(h.fz).toBeCloseTo(-1);
  });

  it('follows yaw and ignores pitch', () => {
    // Yaw 90 degrees left: forward is -X.
    headingOf(...yawPitch(Math.PI / 2, 0), h);
    expect(h.fx).toBeCloseTo(-1);
    expect(h.fz).toBeCloseTo(0);
    headingOf(...yawPitch(Math.PI / 2, -0.6), h);
    expect(h.fx).toBeCloseTo(-1);
    expect(h.fz).toBeCloseTo(0);
  });

  it('keeps the facing direction when looking straight down or up', () => {
    headingOf(...yawPitch(Math.PI / 2, -Math.PI / 2), h);
    expect(h.fx).toBeCloseTo(-1);
    expect(h.fz).toBeCloseTo(0);
    headingOf(...yawPitch(Math.PI / 2, Math.PI / 2), h);
    expect(h.fx).toBeCloseTo(-1);
    expect(h.fz).toBeCloseTo(0);
  });
});

describe('virtual stick', () => {
  const ahead: Heading = { fx: 0, fz: -1 };
  const out = { x: 0, y: 0 };

  it('is zero inside the deadzone', () => {
    const r = VIRTUAL_STICK_FULL_M * VIRTUAL_STICK_DEADZONE * 0.9;
    expect(virtualStick(r, 0, ahead, out)).toEqual({ x: 0, y: 0 });
    expect(virtualStick(0, 0, ahead, out)).toEqual({ x: 0, y: 0 });
  });

  it('reads like a thumbstick: right is +x, forward is -y, 6 cm is full', () => {
    virtualStick(0.06, 0, ahead, out);
    expect(out.x).toBeCloseTo(1);
    expect(out.y).toBeCloseTo(0);
    virtualStick(0, -0.06, ahead, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(-1);
    virtualStick(0, 0.2, ahead, out);
    expect(out.y).toBeCloseTo(1);
  });

  it('rescales past the deadzone and keeps the direction', () => {
    // 3 cm right, 4 cm forward: 5 cm of 6, so (5/6 - 0.15) / 0.85 along (0.6, -0.8).
    virtualStick(0.03, -0.04, ahead, out);
    const s = (0.05 / 0.06 - VIRTUAL_STICK_DEADZONE) / (1 - VIRTUAL_STICK_DEADZONE);
    expect(out.x).toBeCloseTo(0.6 * s);
    expect(out.y).toBeCloseTo(-0.8 * s);
  });

  it('is relative to the heading at pinch start', () => {
    // Facing -X: moving the hand toward -X is forward, toward -Z is right.
    const left: Heading = { fx: -1, fz: 0 };
    virtualStick(-0.06, 0, left, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(-1);
    virtualStick(0, -0.06, left, out);
    expect(out.x).toBeCloseTo(1);
    expect(out.y).toBeCloseTo(0);
  });
});
