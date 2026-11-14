import { describe, expect, it } from 'vitest';
import { createMotion, cubicBezier, easeIynk, REDUCED_MS, SPRINGS, springAtRest, stepSpring } from '../../src/look/motion';
import { bandsOf, mixHex } from '../../src/look/palette';
import { fitDistance } from '../../src/look/stage';
import { dmm, scriptOf } from '../../src/look/type';

describe('easing', () => {
  it('is the site curve, cubic-bezier(0.22, 1, 0.36, 1)', () => {
    expect(easeIynk(0)).toBe(0);
    expect(easeIynk(1)).toBe(1);
    // fast out of the gate: well past half way at a quarter of the time
    expect(easeIynk(0.25)).toBeGreaterThan(0.6);
    expect(easeIynk(0.5)).toBeGreaterThan(0.85);
    // monotonic
    let prev = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const v = easeIynk(t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
  it('solves a linear bezier to the identity', () => {
    const lin = cubicBezier(1 / 3, 1 / 3, 2 / 3, 2 / 3);
    for (const t of [0.1, 0.33, 0.5, 0.9]) expect(lin(t)).toBeCloseTo(t, 5);
  });
});

describe('springs', () => {
  it('a critically damped spring lands without overshoot', () => {
    const s = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 120; i++) {
      stepSpring(s, 1, SPRINGS.snappy, 1 / 90);
      max = Math.max(max, s.x);
    }
    expect(max).toBeLessThanOrEqual(1.0001);
    expect(springAtRest(s, 1)).toBe(true);
  });
  it('settle overshoots a little, then rests', () => {
    const s = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 180; i++) {
      stepSpring(s, 1, SPRINGS.settle, 1 / 90);
      max = Math.max(max, s.x);
    }
    expect(max).toBeGreaterThan(1.05);
    expect(max).toBeLessThan(1.3);
    expect(springAtRest(s, 1)).toBe(true);
  });
  it('is stable at a long frame', () => {
    const s = { x: 0, v: 0 };
    stepSpring(s, 1, SPRINGS.wobble, 0.1);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Math.abs(s.x)).toBeLessThan(3);
  });
});

describe('runner', () => {
  it('plays a tween to its end and calls onDone once', () => {
    const m = createMotion();
    const seen: number[] = [];
    let done = 0;
    m.tween({ ms: 100, onUpdate: (k) => seen.push(k), onDone: () => done++ });
    for (let i = 0; i < 20; i++) m.tick(0.01);
    expect(seen.at(-1)).toBe(1);
    expect(done).toBe(1);
    expect(m.active).toBe(0);
  });
  it('a new tween with the same key replaces the running one', () => {
    const m = createMotion();
    const key = {};
    let a = 0;
    let b = 0;
    m.tween({ key, ms: 100, onUpdate: () => a++ });
    m.tick(0.01);
    m.tween({ key, ms: 100, onUpdate: () => b++ });
    m.tick(0.01);
    m.tick(0.01);
    expect(a).toBe(1);
    expect(b).toBe(2);
  });
  it('waits out a delay', () => {
    const m = createMotion();
    const seen: number[] = [];
    m.tween({ ms: 100, delay: 50, onUpdate: (k) => seen.push(k) });
    m.tick(0.04);
    expect(seen).toHaveLength(0);
    m.tick(0.02);
    expect(seen).toHaveLength(1);
  });
  it('reduced motion shortens tweens and lands springs at once', () => {
    const m = createMotion({ reducedMotion: true });
    let k = 0;
    m.tween({ ms: 2000, onUpdate: (v) => (k = v) });
    m.tick(REDUCED_MS / 1000 + 0.001);
    expect(k).toBe(1);
    let x = 0;
    m.spring({ from: 0, to: 5, preset: 'settle', onUpdate: (v) => (x = v) });
    m.tick(1 / 90);
    expect(x).toBe(5);
    expect(m.active).toBe(0);
  });
  it('a spring can be retargeted and keeps going', () => {
    const m = createMotion();
    let x = 0;
    const s = m.spring({ from: 0, to: 1, preset: 'snappy', onUpdate: (v) => (x = v) });
    for (let i = 0; i < 5; i++) m.tick(1 / 90);
    s.to(-1);
    for (let i = 0; i < 200; i++) m.tick(1 / 90);
    expect(x).toBeCloseTo(-1, 2);
    expect(s.done).toBe(true);
  });
  it('a loop never ends and is static under reduced motion', () => {
    const m = createMotion();
    const seen: number[] = [];
    m.tween({ ms: 100, loop: true, onUpdate: (k) => seen.push(k) });
    for (let i = 0; i < 30; i++) m.tick(0.01);
    expect(m.active).toBe(1);
    m.reducedMotion = true;
    const r = createMotion({ reducedMotion: true });
    const still: number[] = [];
    r.tween({ ms: 100, loop: true, onUpdate: (k) => still.push(k) });
    r.tick(0.05);
    r.tick(0.05);
    expect(still.every((k) => k === 0)).toBe(true);
  });
  it('a callback that throws ends only its own motion', () => {
    const m = createMotion();
    let ok = 0;
    const err = console.error;
    console.error = () => undefined;
    m.tween({ ms: 100, onUpdate: () => { throw new Error('boom'); } });
    m.tween({ ms: 100, onUpdate: () => ok++ });
    m.tick(0.01);
    m.tick(0.01);
    console.error = err;
    expect(ok).toBe(2);
    expect(m.active).toBe(1);
  });
});

describe('palette and type', () => {
  it('bandsOf is the figures matOf: 16 % and 42 % towards black', () => {
    expect(bandsOf('#808080')).toEqual({ l: '#808080', m: '#6c6c6c', d: '#4a4a4a' });
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
  it('dmm keeps the angular size', () => {
    expect(dmm(22, 0.6)).toBeCloseTo(0.0132, 6);
    expect(dmm(20, 1)).toBeCloseTo(0.02, 6);
  });
  it('picks the script that sets size and line height', () => {
    expect(scriptOf('Run')).toBe('latin');
    expect(scriptOf('चलाएँ')).toBe('devanagari');
    expect(scriptOf('运行')).toBe('han');
  });
  it('fits the bench across the flat frame', () => {
    const d = fitDistance(1, 1.6, 30);
    // half width over the tangent of half the horizontal fov
    const h = Math.atan(Math.tan((15 * Math.PI) / 180) * 1.6);
    expect(d).toBeCloseTo(0.5 / Math.tan(h), 6);
    expect(fitDistance(1, 0.5, 30)).toBeGreaterThan(d);
  });
});
