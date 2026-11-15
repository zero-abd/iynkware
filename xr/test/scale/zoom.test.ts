/** Zoom: comfort check, thumbstick flick, two-handed gesture, strings. */
import { describe, expect, it } from 'vitest';
import { headInGrowth, type Footprint } from '../../src/scale/zoom/apply';
import { flickStep, newFlick } from '../../src/scale/zoom/flick';
import { newGesture, stepGesture, type GestureInput } from '../../src/scale/zoom/gesture';
import { ZOOM_STRINGS } from '../../src/scale/zoom/strings';
import { tableProblems } from '../../src/scale/kit/text';

describe('headInGrowth', () => {
  const fp: Footprint = { minX: -0.05, maxX: 0.05, minZ: -0.03, maxZ: 0.03, maxY: 0.02 };
  const origin = [0, 1, -0.5] as const;
  it('is true inside the grown footprint, below top plus 0.3', () => {
    expect(headInGrowth([0, 1.2, -0.5], fp, origin, 1, 6)).toBe(true);
    // x = 0.35 is inside 0.05 * 6 + 0.1 = 0.4 but outside at 3x
    expect(headInGrowth([0.35, 1.2, -0.5], fp, origin, 1, 6)).toBe(true);
    expect(headInGrowth([0.35, 1.2, -0.5], fp, origin, 1, 3)).toBe(false);
  });
  it('uses the larger of the two scales', () => {
    expect(headInGrowth([0.35, 1.2, -0.5], fp, origin, 6, 1)).toBe(true);
  });
  it('is false when the head is above the top plus 0.3 or outside the footprint', () => {
    expect(headInGrowth([0, 1.6, -0.5], fp, origin, 1, 6)).toBe(false);
    expect(headInGrowth([0, 1.2, 0.5], fp, origin, 1, 6)).toBe(false);
  });
});

describe('flick', () => {
  it('steps larger when pushed forward and released', () => {
    const s = newFlick();
    expect(flickStep(s, -0.5)).toBe(0);
    expect(flickStep(s, -0.9)).toBe(0);
    expect(flickStep(s, -0.5)).toBe(0);
    expect(flickStep(s, -0.1)).toBe(1);
    expect(flickStep(s, 0)).toBe(0);
  });
  it('steps smaller when pulled back', () => {
    const s = newFlick();
    flickStep(s, 0.8);
    expect(flickStep(s, 0.2)).toBe(-1);
  });
  it('fires once per flick and ignores a stick held out', () => {
    const s = newFlick();
    let n = 0;
    for (const y of [-0.8, -0.9, -0.95, -0.9, -0.2, 0, -0.1]) n += Math.abs(flickStep(s, y));
    expect(n).toBe(1);
  });
});

describe('two-handed gesture', () => {
  const base = (over: Partial<GestureInput>): GestureInput => ({
    t: 0, tracked: [true, true], pinching: [true, true], busy: [false, false], dist: 0.2, scale: 3, ...over,
  });
  const started = () => {
    const g = newGesture();
    stepGesture(g, base({ t: 0, pinching: [true, false] }));
    stepGesture(g, base({ t: 100 }));
    return g;
  };

  it('starts when both pinch within 400 ms, then maps spread to scale', () => {
    const g = started();
    expect(g.active).toBe(true);
    expect(stepGesture(g, base({ t: 200, dist: 0.2 })).scale).toBeCloseTo(3);
    expect(stepGesture(g, base({ t: 300, dist: 0.3 })).scale).toBeCloseTo(4.5);
    expect(stepGesture(g, base({ t: 400, dist: 0.1 })).scale).toBeCloseTo(1.5);
  });
  it('clamps at 1 and 6', () => {
    const g = started();
    expect(stepGesture(g, base({ t: 200, dist: 0.01 })).scale).toBe(1);
    expect(stepGesture(g, base({ t: 300, dist: 5 })).scale).toBe(6);
  });
  it('ticks once on reaching 6', () => {
    const g = started();
    expect(stepGesture(g, base({ t: 200, dist: 0.5 })).tick).toBe(true);
    expect(stepGesture(g, base({ t: 300, dist: 0.6 })).tick).toBe(false);
    expect(stepGesture(g, base({ t: 400, dist: 0.7 })).tick).toBe(false);
  });
  it('releases the current scale when either hand lets go', () => {
    const g = started();
    stepGesture(g, base({ t: 200, dist: 0.3 }));
    const out = stepGesture(g, base({ t: 300, dist: 0.3, pinching: [true, false] }));
    expect(out.release).toBeCloseTo(4.5);
    expect(g.active).toBe(false);
  });
  it('does not start when the second pinch comes 500 ms later', () => {
    const g = newGesture();
    stepGesture(g, base({ t: 0, pinching: [true, false] }));
    stepGesture(g, base({ t: 500 }));
    expect(g.active).toBe(false);
    expect(stepGesture(g, base({ t: 600, dist: 0.4 })).scale).toBeNull();
  });
  it('does not start on a hovered or held target', () => {
    const g = newGesture();
    stepGesture(g, base({ t: 0, busy: [false, true] }));
    expect(g.active).toBe(false);
  });
  it('holds on tracking loss, snaps when it returns or after 1 s', () => {
    let g = started();
    stepGesture(g, base({ t: 200, dist: 0.3 }));
    expect(stepGesture(g, base({ t: 300, tracked: [true, false], pinching: [true, false] })).release).toBeNull();
    expect(stepGesture(g, base({ t: 800, tracked: [true, false], pinching: [true, false] })).release).toBeNull();
    expect(stepGesture(g, base({ t: 1400, tracked: [true, false], pinching: [true, false] })).release).toBeCloseTo(4.5);
    g = started();
    stepGesture(g, base({ t: 200, dist: 0.3 }));
    stepGesture(g, base({ t: 300, tracked: [true, false], pinching: [true, false] }));
    expect(stepGesture(g, base({ t: 500, dist: 0.3 })).release).toBeCloseTo(4.5);
  });
});

describe('strings', () => {
  it('are complete in six languages', () => {
    expect(tableProblems(ZOOM_STRINGS)).toEqual([]);
  });
});
