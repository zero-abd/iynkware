import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { stringProblems } from '../src/run/kit/strings';
import { inputStrings } from '../src/run/inputs/strings';
import {
  BODY_C,
  KNOB_DRAG_M,
  KNOB_SWEEP_RAD,
  SHADE_FLOOR,
  SHADE_REACH_M,
  approach,
  breathStep,
  crossedTenth,
  inCone,
  inputsOf,
  knobPos,
  limiter,
  rangeCm,
  shadeAmount,
  shadedLux,
  soilStep,
  twistAbout,
  warmStep,
  wetSoil,
  type DescriptorLike,
  type Soil,
} from '../src/run/inputs/map';

const part = (id: string): DescriptorLike =>
  JSON.parse(readFileSync(new URL(`../../src/parts/data/${id}.component.json`, import.meta.url), 'utf8')) as DescriptorLike;

describe('what a descriptor takes', () => {
  const kinds = (id: string) => inputsOf(part(id)).map((s) => s.kind + ':' + s.path);
  test('buttons, switches and pots', () => {
    expect(kinds('push-button-6mm')).toEqual(['button:pressed']);
    expect(kinds('slide-switch')).toEqual(['switch:closed']);
    expect(kinds('potentiometer-10k')).toEqual(['pot:pos']);
  });
  test('sensors', () => {
    expect(kinds('ldr')).toEqual(['light:lux']);
    expect(kinds('tmp36')).toEqual(['temp:temp_c']);
    expect(kinds('soil-moisture')).toEqual(['moisture:moisture']);
    expect(kinds('hc-sr04')).toEqual(['distance:distance']);
  });
  test('a part with nothing to act on takes nothing', () => {
    expect(kinds('breadboard')).toEqual([]);
    expect(inputsOf(undefined)).toEqual([]);
  });
  test('defaults and the ranger beam come from the descriptor', () => {
    expect(inputsOf(part('ldr'))[0]).toMatchObject({ rest: 300 });
    expect(inputsOf(part('hc-sr04'))[0]).toMatchObject({ beamDeg: 30, minM: 0.02, maxM: 4 });
  });
});

describe('the knob', () => {
  test('a quarter turn of the wrist is a proportional step', () => {
    expect(knobPos(0.5, KNOB_SWEEP_RAD / 4, 0)).toBeCloseTo(0.5 + 0.25);
    expect(knobPos(0.5, -KNOB_SWEEP_RAD / 4, 0)).toBeCloseTo(0.25);
  });
  test('a ray drag of 0.15 m is the full range, and the position is clamped', () => {
    expect(knobPos(0, 0, KNOB_DRAG_M)).toBeCloseTo(1);
    expect(knobPos(0.9, 5, 0)).toBe(1);
    expect(knobPos(0.1, -5, 0)).toBe(0);
  });
  test('twist about an axis', () => {
    const half = Math.PI / 6;
    expect(twistAbout(0, 0, -Math.sin(half), Math.cos(half), 0, 0, -1)).toBeCloseTo(Math.PI / 3);
    expect(twistAbout(0, 0, Math.sin(half), Math.cos(half), 0, 0, -1)).toBeCloseTo(-Math.PI / 3);
    expect(twistAbout(Math.sin(half), 0, 0, Math.cos(half), 0, 0, -1)).toBeCloseTo(0);
  });
  test('a tick each tenth', () => {
    expect(crossedTenth(0.05, 0.11)).toBe(true);
    expect(crossedTenth(0.11, 0.19)).toBe(false);
    expect(crossedTenth(0.31, 0.29)).toBe(true);
  });
});

describe('a hand over a light sensor', () => {
  test('no shade out of reach or to the side', () => {
    expect(shadeAmount(SHADE_REACH_M + 0.01, 0)).toBe(0);
    expect(shadeAmount(0.05, 0.2)).toBe(0);
    expect(shadeAmount(-0.1, 0)).toBe(0);
  });
  test('the closer the darker, smoothly', () => {
    const a = shadeAmount(0.12, 0);
    const b = shadeAmount(0.08, 0);
    const c = shadeAmount(0.02, 0);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThanOrEqual(1);
  });
  test('room light to nearly dark', () => {
    expect(shadedLux(300, 0)).toBe(300);
    expect(shadedLux(300, 1)).toBeCloseTo(300 * SHADE_FLOOR);
  });
});

describe('a hand before a distance sensor', () => {
  test('the cone test', () => {
    const half = (15 * Math.PI) / 180;
    expect(inCone(0, 0, 0.3, 0, 0, 1, half)).toBe(true);
    expect(inCone(0.3 * Math.tan(0.2), 0, 0.3, 0, 0, 1, half)).toBe(true);
    expect(inCone(0.3 * Math.tan(0.4), 0, 0.3, 0, 0, 1, half)).toBe(false);
    expect(inCone(0, 0, -0.3, 0, 0, 1, half)).toBe(false);
    expect(inCone(0, 0, 0, 0, 0, 1, half)).toBe(false);
  });
  test('the bench distance is divided by the work scale, clamped to the range, in centimetres', () => {
    expect(rangeCm(0.9, 3, 0.02, 4)).toBe(30);
    expect(rangeCm(0.03, 3, 0.02, 4)).toBe(2);
    expect(rangeCm(0.03, 1, 0.02, 4)).toBe(3);
    expect(rangeCm(30, 3, 0.02, 4)).toBeNull();
  });
});

describe('warmth, breath and soil', () => {
  test('a hand held over a sensor warms it towards body warmth and never past', () => {
    let t = 22;
    for (let i = 0; i < 60; i++) t = warmStep(t, true, 22, 0.1);
    expect(t).toBeGreaterThan(30);
    expect(t).toBeLessThanOrEqual(BODY_C);
    for (let i = 0; i < 600; i++) t = warmStep(t, true, 22, 0.1);
    expect(t).toBeCloseTo(BODY_C, 1);
  });
  test('removed, it falls back, slower than it rose', () => {
    const rose = warmStep(22, true, 22, 1) - 22;
    const fell = 34 - warmStep(34, false, 22, 1);
    expect(fell).toBeLessThan(rose);
    let t = 34;
    for (let i = 0; i < 1200; i++) t = warmStep(t, false, 22, 0.1);
    expect(t).toBeCloseTo(22, 1);
  });
  test('a warm room is not cooled by a hand', () => {
    expect(warmStep(40, true, 40, 1)).toBeCloseTo(40);
  });
  test('breath raises humidity and it falls back', () => {
    let h = 45;
    for (let i = 0; i < 20; i++) h = breathStep(h, true, 45, 0.1);
    expect(h).toBeGreaterThan(60);
    for (let i = 0; i < 2000; i++) h = breathStep(h, false, 45, 0.1);
    expect(h).toBeCloseTo(45, 0);
  });
  test('water soaks in over a moment, then the soil dries slowly to where it was', () => {
    const soil: Soil = { value: 40, target: 40 };
    wetSoil(soil);
    for (let i = 0; i < 30; i++) soilStep(soil, 40, 0.1);
    expect(soil.value).toBeGreaterThan(60);
    expect(soil.value).toBeLessThanOrEqual(75);
    const wet = soil.value;
    for (let i = 0; i < 100; i++) soilStep(soil, 40, 0.1);
    expect(soil.value).toBeLessThan(wet);
    expect(soil.value).toBeGreaterThan(40);
    for (let i = 0; i < 5000; i++) soilStep(soil, 40, 0.1);
    expect(soil.value).toBe(40);
  });
  test('more water never passes 100', () => {
    const soil: Soil = { value: 90, target: 90 };
    wetSoil(soil);
    wetSoil(soil);
    expect(soil.target).toBe(100);
  });
  test('approach is a lag', () => {
    expect(approach(0, 10, 1, 0)).toBe(0);
    expect(approach(0, 10, 1, 1)).toBeCloseTo(10 * (1 - Math.exp(-1)));
    expect(approach(3, 9, 0, 1)).toBe(9);
  });
});

describe('sending', () => {
  test('at most 20 a second and only on a change', () => {
    const l = limiter(0.1, 50, 0);
    expect(l.take(0.05, 0)).toBe(false);
    expect(l.take(1, 0)).toBe(true);
    expect(l.take(2, 20)).toBe(false);
    expect(l.take(2, 60)).toBe(true);
    expect(l.take(2.05, 200)).toBe(false);
  });
  test('the last value of a gesture goes out when the window opens', () => {
    const l = limiter(0.5, 50, 0);
    expect(l.take(1, 0)).toBe(true);
    expect(l.take(1.2, 100)).toBe(false);
    expect(l.settle(1.2, 120)).toBe(true);
    expect(l.settle(1.2, 400)).toBe(false);
  });
  test('reset forgets what was sent', () => {
    const l = limiter(0.1, 50, 5);
    l.take(7, 0);
    l.reset();
    expect(l.last).toBe(5);
    expect(l.take(7, 1000)).toBe(true);
  });
});

describe('words', () => {
  test('six languages, same placeholders', () => {
    expect(stringProblems(inputStrings.table)).toEqual([]);
  });
});
