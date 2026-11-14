import { describe, expect, test } from 'vitest';
import { buttonColours } from '../src/shell/kit/button';
import { faceSize } from '../src/shell/kit/face';
import { placementFrom } from '../src/shell/kit/place';
import { ACCENT, FIGURE_ACCENT, INK, MUTED, PAPER, PAPER_DIM, STATE } from '../src/look/palette';
import { PX_PER_DMM } from '../src/look/paint';

const near = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i] ?? NaN, 6));

describe('shell kit: placement', () => {
  test('straight ahead at eye height along the yaw', () => {
    const p = placementFrom([0, 1.6, 0], [0, 0, -1], { distance: 1.3 });
    near(p.position, [0, 1.6, -1.3]);
    near(p.faceTo, [0, 1.6, 0]);
  });

  test('ignores head pitch: looking down still places at the same distance on the floor plan', () => {
    const p = placementFrom([1, 1.5, 2], [0, -0.9, -0.3], { distance: 1 });
    near(p.position, [1, 1.5, 1]);
  });

  test('below eye level by the angle, distance kept along the line of sight', () => {
    const p = placementFrom([0, 1.6, 0], [0, 0, -1], { distance: 1.3, belowDeg: 8 });
    const r = (8 * Math.PI) / 180;
    near(p.position, [0, 1.6 - 1.3 * Math.sin(r), -1.3 * Math.cos(r)]);
    expect(Math.hypot(p.position[0], p.position[1] - 1.6, p.position[2])).toBeCloseTo(1.3, 6);
  });

  test('sideDeg turns towards the right, negative to the left', () => {
    const right = placementFrom([0, 1.6, 0], [0, 0, -1], { distance: 1, sideDeg: 90 });
    near(right.position, [1, 1.6, 0]);
    const left = placementFrom([0, 1.6, 0], [0, 0, -1], { distance: 1, sideDeg: -90 });
    near(left.position, [-1, 1.6, 0]);
  });

  test('looking straight up or down falls back to -z', () => {
    const p = placementFrom([0, 1.6, 0], [0, 1, 0], { distance: 0.5 });
    near(p.position, [0, 1.6, -0.5]);
  });
});

describe('shell kit: button colours', () => {
  test('idle plain button is paper with an ink edge; hover turns the edge accent', () => {
    expect(buttonColours({ label: 'x' }, 'idle')).toEqual({ fill: PAPER, ink: INK, edge: INK, label: INK, shadow: true });
    expect(buttonColours({ label: 'x' }, 'hover').edge).toBe(ACCENT);
  });

  test('pressed fills with the accent, whatever the look', () => {
    expect(buttonColours({ label: 'x' }, 'press').fill).toBe(ACCENT);
    expect(buttonColours({ label: 'x', danger: true }, 'press').fill).toBe(ACCENT);
  });

  test('primary, selected and danger', () => {
    expect(buttonColours({ label: 'x', primary: true }, 'idle').fill).toBe(ACCENT);
    expect(buttonColours({ label: 'x', selected: true }, 'idle').fill).toBe(FIGURE_ACCENT);
    const d = buttonColours({ label: 'x', danger: true }, 'idle');
    expect(d.fill).toBe(STATE.bad);
    expect(d.label).toBe(PAPER);
  });

  test('disabled is dim, muted and flat in every state', () => {
    for (const s of ['idle', 'hover', 'press'] as const) {
      expect(buttonColours({ label: 'x', disabled: true, primary: true }, s)).toEqual({ fill: PAPER_DIM, ink: MUTED, edge: MUTED, label: MUTED, shadow: false });
    }
  });
});

describe('shell kit: face size', () => {
  test('two texels per dmm at the viewing distance', () => {
    // 0.52 m wide at 1.3 m is 400 dmm: 800 texels.
    const s = faceSize(0.52, 0.26, 1.3);
    expect(s.px).toBe(PX_PER_DMM);
    expect(s.cw).toBe(800);
    expect(s.ch).toBe(400);
  });

  test('caps the long side at 2048 and scales px with it', () => {
    const s = faceSize(2.6, 1.3, 1.3);
    expect(s.cw).toBe(2048);
    expect(s.ch).toBe(1024);
    expect(s.px).toBeCloseTo((PX_PER_DMM * 2048) / 4000, 6);
  });

  test('never smaller than 8 texels', () => {
    const s = faceSize(0.001, 0.001, 1);
    expect(s.cw).toBe(8);
    expect(s.ch).toBe(8);
  });
});
