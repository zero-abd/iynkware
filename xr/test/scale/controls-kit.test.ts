import { describe, expect, it } from 'vitest';
import { CONTROL_STRINGS, PANEL, panelGrid, panelSpot, RAIL_GAP, RAIL_PLATE, railXs } from '../../src/scale/kit/controls';
import { tableProblems } from '../../src/scale/kit/text';

describe('control hosts layout', () => {
  it('lays rail plates left to right next to the run cluster, away from the dominant hand', () => {
    const right = railXs(4, 1);
    for (let i = 1; i < right.length; i++) expect(right[i]! - right[i - 1]!).toBeCloseTo(RAIL_PLATE.w + RAIL_GAP);
    // Right-handed: the group ends next to the cluster (x -0.15) and fits a seated bench's half width with the Menu.
    expect(right[3]).toBeLessThan(-0.15 - RAIL_PLATE.w / 2);
    expect(Math.abs(right[0]!) + RAIL_PLATE.w / 2).toBeLessThan(0.41);
    const left = railXs(4, -1);
    expect(left[0]).toBeGreaterThan(0.15 + RAIL_PLATE.w / 2);
    expect(left).toEqual(right.map((x) => -x).reverse());
  });

  it('grows the panel by one row per control under the title', () => {
    const one = panelGrid(1);
    const five = panelGrid(5);
    expect(five.w).toBeCloseTo(one.w);
    expect(five.h - one.h).toBeCloseTo(4 * (PANEL.rowH + PANEL.gap));
    expect(five.cells).toHaveLength(5);
    for (let i = 1; i < 5; i++) expect(five.cells[i - 1]![1] - five.cells[i]![1]).toBeCloseTo(PANEL.rowH + PANEL.gap);
    for (const [x, y] of five.cells) {
      expect(Math.abs(x) + PANEL.rowW / 2).toBeLessThanOrEqual(five.w / 2 + 1e-9);
      expect(y + PANEL.rowH / 2).toBeLessThanOrEqual(five.h / 2 - PANEL.title + 1e-9);
      expect(y - PANEL.rowH / 2).toBeGreaterThanOrEqual(-five.h / 2 - 1e-9);
    }
  });

  it('stands the panel 0.8 m from the eyes, below and away from the dominant hand, facing them', () => {
    const eye = [0, 0.47, 0.4] as const;
    const right = panelSpot({ eye, d: 1 });
    const left = panelSpot({ eye, d: -1 });
    const [x, y, z] = right.position;
    expect(Math.hypot(x - eye[0], y - eye[1], z - eye[2])).toBeCloseTo(PANEL.distance);
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(eye[1]);
    expect(left.position[0]).toBeCloseTo(-x);
    expect(right.tiltRad).toBeLessThan(0);
    // Yaw turns its +z towards the eyes: from the panel, the eyes lie along (sin yaw, -, cos yaw).
    expect(Math.sign(Math.sin(right.yawRad))).toBe(Math.sign(eye[0] - x));
  });

  it('has the title in six languages', () => {
    expect(tableProblems(CONTROL_STRINGS)).toEqual([]);
  });
});
