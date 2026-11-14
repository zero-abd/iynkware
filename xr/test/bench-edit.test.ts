/** The pure pieces of carrying and seating (bench/edit/place.ts, strings.ts, carry.ts maths) and press resolution (core/router.ts). */
import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/contracts/common';
import { parity } from '../src/bench/core/text';
import { pickVerb } from '../src/bench/core/router';
import { createPullTracker, createTrackingLoss } from '../src/bench/core/gesture';
import { rectRelativeToCorner } from '../src/bench/edit/carry';
import {
  decideRelease,
  freeSpot,
  headingDeg,
  matOf,
  onMatRect,
  overlaps,
  progress,
  refusalOfProblem,
  rotationOfYaw,
  turned,
  yawOfRotation,
  type RectMm,
} from '../src/bench/edit/place';
import { editStrings, reasonText } from '../src/bench/edit/strings';

const fit = { anchorHole: 'c14', rotation: 0 as const, x_mm: 1, y_mm: 2, legs: { A: 'c14', K: 'c15' } };

describe('the release decision', () => {
  it('seats at a valid ghost, wherever the hand is over the mat', () => {
    expect(decideRelease({ ghost: { shown: true, fit, problem: null }, onMat: true })).toEqual({ kind: 'seat', fit });
    expect(decideRelease({ ghost: { shown: true, fit, problem: null }, onMat: false }).kind).toBe('seat');
  });
  it('slides beside the board when the ghost shows no fit, and carries the reason', () => {
    const problem = { pin: 'A', hole: 'c14', state: 'taken', holder: 'cmp_led1', holderRefdes: 'LED1' } as const;
    expect(decideRelease({ ghost: { shown: true, fit: null, problem }, onMat: true })).toEqual({ kind: 'beside', problem });
  });
  it('lies where it was dropped on the mat, goes back when released off it', () => {
    expect(decideRelease({ ghost: null, onMat: true }).kind).toBe('loose');
    expect(decideRelease({ ghost: { shown: false, fit: null, problem: null }, onMat: true }).kind).toBe('loose');
    expect(decideRelease({ ghost: null, onMat: false }).kind).toBe('back');
    expect(decideRelease({ ghost: { shown: true, fit: null, problem: null }, onMat: false }).kind).toBe('back');
  });
});

describe('the free spot beside a board', () => {
  const rel: RectMm = { minX: 0, maxX: 10, minY: 0, maxY: 4 };
  const board: RectMm = { minX: 0, maxX: 80, minY: 0, maxY: 54 };
  const anywhere = () => true;
  it('keeps a free spot as it is', () => {
    expect(freeSpot({ x: 100, y: 10 }, rel, [board], anywhere)).toEqual({ x: 100, y: 10 });
  });
  it('moves a spot over the board to the nearest clear one, never overlapping', () => {
    const spot = freeSpot({ x: 40, y: 20 }, rel, [board], anywhere)!;
    expect(spot).not.toBeNull();
    const placed = { minX: spot.x, maxX: spot.x + 10, minY: spot.y, maxY: spot.y + 4 };
    expect(overlaps(placed, board)).toBe(false);
    // the nearest side is the top (20 mm in) or the left/bottom: nothing is further than the board is wide
    expect(Math.hypot(spot.x - 40, spot.y - 20)).toBeLessThan(45);
  });
  it('stays on the mat', () => {
    const mat = (r: RectMm) => r.minX >= -50 && r.maxX <= 200 && r.minY >= -30 && r.maxY <= 100;
    const spot = freeSpot({ x: 40, y: 20 }, rel, [board], mat)!;
    expect(mat({ minX: spot.x, maxX: spot.x + 10, minY: spot.y, maxY: spot.y + 4 })).toBe(true);
  });
  it('says there is none when nothing is free', () => {
    expect(freeSpot({ x: 0, y: 0 }, rel, [board], () => false, 5)).toBeNull();
  });
});

describe('turning in quarter steps', () => {
  it('maps a yaw to the document rotation and back (space.ts: yaw = -rotation)', () => {
    for (const r of [0, 90, 180, 270] as const) expect(rotationOfYaw(yawOfRotation(r))).toBe(r);
    expect(rotationOfYaw(0.1)).toBe(0);
    expect(rotationOfYaw(-Math.PI / 2 + 0.2)).toBe(90);
  });
  it('turns counter-clockwise steps against the rotation', () => {
    expect(turned(0, 1)).toBe(270);
    expect(turned(0, -1)).toBe(90);
    expect(turned(90, 4)).toBe(90);
    expect(turned(270, -2)).toBe(90);
  });
  it('reads a heading about +y and ignores a vertical normal', () => {
    expect(headingDeg(0, 1)).toBeCloseTo(0);
    expect(headingDeg(1, 0)).toBeCloseTo(90);
    expect(headingDeg(0.01, 0.01)).toBeNull();
  });
});

describe('the mat', () => {
  const work = { x: 0, z: 0.0, w: 0.54, d: 0.3 };
  const back = { x: 0, z: -0.2, w: 0.54, d: 0.1 };
  it('joins the work zone and the back strip', () => {
    const m = matOf(work, back);
    expect(m.z - m.d / 2).toBeCloseTo(-0.25);
    expect(m.z + m.d / 2).toBeCloseTo(0.15);
    expect(onMatRect(m, 0, -0.2)).toBe(true);
    expect(onMatRect(m, 0.4, 0)).toBe(false);
    expect(onMatRect(m, 0, 0.3)).toBe(false);
  });
});

describe('the reason of an invalid release', () => {
  it('turns a failing leg into iynk-shaped refusals', () => {
    expect(refusalOfProblem({ pin: 'A', hole: 'c14', state: 'taken', holder: 'cmp_led1', holderRefdes: 'LED1' })).toEqual({
      reason: 'hole-taken',
      args: { pin: 'A', hole: 'c14', holder: 'LED1' },
    });
    expect(refusalOfProblem({ pin: 'K', hole: 'c15', state: 'same-strip', with: 'A', withHole: 'c14' })).toEqual({ reason: 'same-strip', args: { a: 'c14', b: 'c15' } });
    expect(refusalOfProblem({ pin: 'P2', hole: null, state: 'off-grid' })).toEqual({ reason: 'off-grid', args: { pin: 'P2' } });
  });
  it('words it in six languages, with iynk own message where it has one', () => {
    expect(parity(editStrings)).toEqual([]);
    for (const lang of LANGS) {
      expect(reasonText(lang, { reason: 'hole-taken', args: { pin: 'A', hole: 'c14', holder: 'LED1' } })).toContain('c14');
      expect(reasonText(lang, { reason: 'hole-taken', args: { pin: 'A', hole: 'c14', holder: 'LED1' } })).toContain('LED1');
      expect(reasonText(lang, { reason: 'off-grid', args: { pin: 'P2' } })).toContain('P2');
      expect(reasonText(lang, { reason: 'same-strip', args: { a: 'c14', b: 'c15' } }).length).toBeGreaterThan(3);
    }
  });
});

describe('what a press means', () => {
  it('a cell wins over a body, a body over an edge', () => {
    expect(pickVerb({ cell: true, body: true, edge: true })).toBe('cell');
    expect(pickVerb({ cell: false, body: true, edge: true })).toBe('body');
    expect(pickVerb({ cell: false, body: false, edge: true })).toBe('edge');
    expect(pickVerb({ cell: false, body: false, edge: false })).toBeNull();
  });
});

describe('a part rectangle relative to its layout corner', () => {
  const asset = { sidecar: { bounds: { min: [-0.002, 0, -0.001], max: [0.008, 0.003, 0.002] } }, footprint: { x: -0.002, z: -0.001, w: 0.01, d: 0.003 } } as never;
  it('starts at the corner when unturned', () => {
    const r = rectRelativeToCorner(asset, 0);
    expect(r.minX).toBeCloseTo(0);
    expect(r.minY).toBeCloseTo(0);
    expect(r.maxX).toBeCloseTo(10);
    expect(r.maxY).toBeCloseTo(3);
  });
  it('turns about the corner a quarter turn', () => {
    const r = rectRelativeToCorner(asset, -Math.PI / 2);
    expect(r.maxX - r.minX).toBeCloseTo(3);
    expect(r.maxY - r.minY).toBeCloseTo(10);
  });
});

describe('the pull and the loss timers the carry runs on', () => {
  it('a seated part stays until lifted one pitch of work', () => {
    const p = createPullTracker();
    expect(p.update(0.007, 3)).toBe('tether');
    expect(p.update(0.0077, 3)).toBe('pulled');
    expect(p.update(0, 3)).toBe('pulled');
  });
  it('a held part freezes, and goes back after 500 ms', () => {
    const l = createTrackingLoss();
    l.lost(1000, 'hold');
    expect(l.update(1200)).toBe('frozen');
    expect(l.update(1500)).toBe('return');
    expect(l.update(1600)).toBe('over');
  });
  it('progress clamps', () => {
    expect(progress(-5, 90)).toBe(0);
    expect(progress(45, 90)).toBe(0.5);
    expect(progress(500, 90)).toBe(1);
  });
});
