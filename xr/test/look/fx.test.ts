import { Object3D, Scene, type InstancedMesh, type World } from '@iwsdk/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The runner needs a real ECS world; the effects only need its flag and a per-frame hook, so fake both.
const run = vi.hoisted(() => ({
  motion: { reducedMotion: false },
  ticks: [] as ((dt: number, t: number) => void)[],
}));
vi.mock('../../src/look/runner', () => ({
  motionOf: () => run.motion,
  onLookFrame: (_w: unknown, fn: (dt: number, t: number) => void) => {
    run.ticks.push(fn);
    return () => {
      run.ticks = run.ticks.filter((f) => f !== fn);
    };
  },
}));

import {
  createEffects,
  createPool,
  easeFromTable,
  easeTable,
  effectsOf,
  FX_CAP,
  HEAT,
  heatLineAt,
  puffAt,
  RING,
  ringAt,
  ringLife,
  SMOKE,
  SPARK,
  sparkAt,
  sparkLife,
  sparkStrokes,
  STOP_MS,
  stopFade,
  wispAt,
  writeInstance,
} from '../../src/look/fx';
import { easeIynk, REDUCED_MS } from '../../src/look/motion';

const frame = (dt: number) => run.ticks.forEach((f) => f(dt, 0));
const fakeWorld = () => ({ scene: new Scene() }) as unknown as World;

describe('instance pool', () => {
  it('hands out the lowest free slot and never more than its cap', () => {
    const p = createPool(3);
    expect([p.acquire(0, 1), p.acquire(0, 1), p.acquire(0, 1)]).toEqual([0, 1, 2]);
    expect(p.anyLive(0.5)).toBe(true);
    expect(p.anyLive(1)).toBe(false);
  });
  it('reuses the oldest live slot when full', () => {
    const p = createPool(3);
    p.acquire(0, 10);
    p.acquire(0, 5);
    p.acquire(0, 10);
    expect(p.acquire(1, 10)).toBe(0); // slot 0 was acquired first, even though slot 1 ends first
    expect(p.acquire(1, 10)).toBe(1);
    expect(p.acquire(1, 10)).toBe(2);
    expect(p.acquire(1, 10)).toBe(0);
  });
  it('takes an expired slot before reusing a live one', () => {
    const p = createPool(2);
    p.acquire(0, 1);
    p.acquire(0, 10);
    expect(p.acquire(2, 10)).toBe(0);
  });
  it('bumps a slot generation on acquire and on release', () => {
    const p = createPool(1);
    const g0 = p.generation(0);
    const s = p.acquire(0);
    const g1 = p.generation(s);
    expect(g1).toBe(g0 + 1);
    p.release(s);
    expect(p.generation(s)).toBe(g1 + 1);
    expect(p.isLive(s, 0)).toBe(false);
    p.acquire(0);
    expect(p.generation(0)).toBe(g1 + 2);
  });
  it('moves a live slot end, and ignores bad slots', () => {
    const p = createPool(2);
    const s = p.acquire(0);
    expect(p.isLive(s, 100)).toBe(true);
    p.setUntil(s, 1);
    expect(p.isLive(s, 2)).toBe(false);
    p.release(9);
    p.setUntil(-1, 5);
    expect(p.isLive(9, 0)).toBe(false);
    expect(p.generation(9)).toBe(0);
  });
});

describe('instance writes and easing table', () => {
  it('writes a translation and uniform scale, and reports changes only', () => {
    const m = new Float32Array(32);
    expect(writeInstance(m, 1, 1, 2, 3, 0.5)).toBe(true);
    expect(Array.from(m.slice(16, 32))).toEqual([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 1, 2, 3, 1]);
    expect(writeInstance(m, 1, 1, 2, 3, 0.5)).toBe(false);
    expect(writeInstance(m, 1, 1, 2, 4, 0.5)).toBe(true);
    expect(Array.from(m.slice(0, 16)).every((v) => v === 0)).toBe(true);
  });
  it('samples the iynk curve closely enough for the shaders', () => {
    const t = easeTable();
    expect(easeFromTable(t, 0)).toBe(0);
    expect(easeFromTable(t, 1)).toBe(1);
    for (const k of [0.05, 0.2, 0.5, 0.77]) expect(Math.abs(easeFromTable(t, k) - easeIynk(k))).toBeLessThan(0.03);
  });
});

describe('rings', () => {
  it('grow 12 to 24 mm across over 180 ms while fading out', () => {
    const life = ringLife('pop', false);
    expect(life).toBe(180);
    const a = ringAt(0, life, false);
    expect(a.radiusMm * 2).toBeCloseTo(12);
    expect(a.opacity).toBe(1);
    const mid = ringAt(90, life, false);
    expect(mid.radiusMm * 2).toBeGreaterThan(18); // the iynk curve is front loaded
    expect(mid.radiusMm * 2).toBeLessThan(24);
    expect(mid.opacity).toBeCloseTo(0.5);
    const end = ringAt(180, life, false);
    expect(end.radiusMm * 2).toBeCloseTo(24);
    expect(end.opacity).toBe(0);
    expect(ringAt(181, life, false).opacity).toBe(0);
    expect(ringAt(-1, life, false).opacity).toBe(0);
  });
  it('the snap ring is shorter than the pop ring', () => {
    expect(ringLife('snap', false)).toBeLessThan(ringLife('pop', false));
  });
  it('under reduced motion hold one size and fade within 150 ms', () => {
    for (const kind of ['pop', 'snap'] as const) {
      const life = ringLife(kind, true);
      expect(life).toBeLessThanOrEqual(REDUCED_MS);
      expect(ringAt(0, life, true).radiusMm).toBe(RING.reducedMm / 2);
      expect(ringAt(life / 2, life, true).radiusMm).toBe(RING.reducedMm / 2);
      expect(ringAt(life / 2, life, true).opacity).toBeCloseTo(0.5);
      expect(ringAt(life, life, true).opacity).toBe(0);
    }
  });
});

describe('spark', () => {
  it('flies out and shrinks its core over 250 ms, holds, then fades', () => {
    expect(sparkLife(false)).toBe(250);
    const a = sparkAt(0, false);
    expect(a.opacity).toBe(1);
    expect(a.coreMm).toBeCloseTo(SPARK.coreMm);
    expect(a.innerMm).toBeCloseTo(SPARK.innerMm[0]);
    const mid = sparkAt(125, false);
    expect(mid.opacity).toBe(1);
    expect(mid.outerMm).toBeGreaterThan(a.outerMm);
    expect(mid.coreMm).toBeLessThan(a.coreMm);
    const end = sparkAt(250, false);
    expect(end.opacity).toBeCloseTo(0);
    expect(end.coreMm).toBeCloseTo(0);
    expect(end.outerMm).toBeCloseTo(SPARK.outerMm[1]);
    expect(sparkAt(300, false).opacity).toBe(0);
  });
  it('is a static star fading within 150 ms under reduced motion', () => {
    expect(sparkLife(true)).toBeLessThanOrEqual(REDUCED_MS);
    const a = sparkAt(0, true);
    const b = sparkAt(75, true);
    expect([b.innerMm, b.outerMm, b.coreMm]).toEqual([a.innerMm, a.outerMm, a.coreMm]);
    expect(b.opacity).toBeCloseTo(0.5);
    expect(sparkAt(150, true).opacity).toBe(0);
  });
  it('picks 6 to 8 strokes from the seed', () => {
    const seen = new Set<number>();
    for (let s = 0; s < 1; s += 0.01) seen.add(sparkStrokes(s));
    expect([...seen].sort()).toEqual([6, 7, 8]);
    expect(sparkStrokes(1)).toBe(8);
    expect(sparkStrokes(-1)).toBe(6);
  });
});

describe('heat', () => {
  it('loops every 1.2 s: three lines a third of a loop apart, each fading in low and out high', () => {
    for (let i = 0; i < 3; i++) {
      const a = heatLineAt(i, 3000, false);
      const b = heatLineAt(i, 3000 + HEAT.loopMs, false);
      expect(b.bottomMm).toBeCloseTo(a.bottomMm, 6);
      expect(b.opacity).toBeCloseTo(a.opacity, 6);
    }
    const phases = [0, 1, 2].map((i) => heatLineAt(i, 1000, false).bottomMm);
    expect(new Set(phases.map((v) => v.toFixed(3))).size).toBe(3);
    // line 0 at age 0: bottom of its travel, and invisible
    const start = heatLineAt(0, 0, false);
    expect(start.bottomMm).toBeCloseTo(HEAT.baseMm);
    expect(start.opacity).toBe(0);
    expect(heatLineAt(0, -10, false).opacity).toBe(0);
    // middle of its loop: fully visible, half way up
    const mid = heatLineAt(0, 3000, false);
    expect(mid.opacity).toBeCloseTo(1);
    expect(mid.bottomMm).toBeCloseTo(HEAT.baseMm + HEAT.travelMm / 2);
    expect(mid.topMm - mid.bottomMm).toBe(HEAT.lengthMm);
    // end of its loop: faded out
    expect(heatLineAt(0, 1199 + 3600, false).opacity).toBeLessThan(0.05);
  });
  it('fades the whole mark in over its first 150 ms', () => {
    // line 1 sits mid-loop at these ages, so only the mark's own fade-in shows
    expect(heatLineAt(1, 75, false).opacity).toBeCloseTo(0.5);
    expect(heatLineAt(1, 150, false).opacity).toBeCloseTo(1);
  });
  it('is three static lines under reduced motion, fading in within 150 ms', () => {
    const at0 = [0, 1, 2].map((i) => heatLineAt(i, 0, true));
    const later = [0, 1, 2].map((i) => heatLineAt(i, 5000, true));
    expect(at0.every((l) => l.opacity === 0)).toBe(true);
    expect(later.every((l) => l.opacity === 1)).toBe(true);
    expect(heatLineAt(1, 75, true).opacity).toBeCloseTo(0.5);
    expect(later.map((l) => l.bottomMm)).toEqual(at0.map((l) => l.bottomMm));
    expect(later[1]!.bottomMm).toBeGreaterThan(later[0]!.bottomMm);
    expect(heatLineAt(1, 100, true).bottomMm).toBe(heatLineAt(1, 4000, true).bottomMm);
  });
});

describe('smoke', () => {
  it('rises 0.06 m and fades, puff by puff, over 1.5 s', () => {
    // the last puff starts 2 * 250 ms in and lives 1000 ms: everything is done by 1500 ms
    expect(2 * SMOKE.staggerMs + SMOKE.puffMs).toBe(SMOKE.ms);
    const first = puffAt(0, 0, false);
    expect(first.yMm).toBe(SMOKE.baseMm);
    expect(first.opacity).toBe(0);
    const mid = puffAt(0, 500, false);
    expect(mid.yMm - SMOKE.baseMm).toBeCloseTo(SMOKE.riseMm / 2);
    expect(mid.opacity).toBe(1);
    expect(mid.rMm).toBeGreaterThan(SMOKE.radiusMm[0]);
    const end = puffAt(0, 1000, false);
    expect(end.yMm - SMOKE.baseMm).toBeCloseTo(60);
    expect(end.opacity).toBeCloseTo(0);
    expect(puffAt(2, 2 * SMOKE.staggerMs + 1000, false).opacity).toBeCloseTo(0);
    expect(puffAt(0, 1100, false).opacity).toBe(0);
    // a later puff has not started yet
    expect(puffAt(2, 100, false).opacity).toBe(0);
    expect(puffAt(2, 100, false).yMm).toBe(SMOKE.baseMm);
  });
  it('then leaves a static wisp, fading in as the puffs go', () => {
    expect(wispAt(0, false)).toBe(0);
    expect(wispAt(1200, false)).toBe(0);
    expect(wispAt(1350, false)).toBeCloseTo(0.5);
    expect(wispAt(1500, false)).toBe(1);
    expect(wispAt(60000, false)).toBe(1);
    expect(wispAt(-5, false)).toBe(0);
  });
  it('under reduced motion shows only the wisp, fading in within 150 ms', () => {
    for (const age of [0, 100, 600, 1500]) expect(puffAt(0, age, true).opacity).toBe(0);
    expect(wispAt(0, true)).toBe(0);
    expect(wispAt(75, true)).toBeCloseTo(0.5);
    expect(wispAt(150, true)).toBe(1);
  });
});

describe('stop fade', () => {
  it('fades out over 150 ms and no earlier', () => {
    expect(STOP_MS).toBeLessThanOrEqual(REDUCED_MS);
    expect(stopFade(-1)).toBe(1);
    expect(stopFade(0)).toBe(1);
    expect(stopFade(STOP_MS / 2)).toBeCloseTo(0.5);
    expect(stopFade(STOP_MS)).toBe(0);
    expect(stopFade(STOP_MS * 4)).toBe(0);
  });
});

describe('createEffects', () => {
  beforeEach(() => {
    run.ticks = [];
    run.motion.reducedMotion = false;
  });
  const kind = (fx: ReturnType<typeof createEffects>, name: string) => fx.object.getObjectByName(`look:fx:${name}`) as InstancedMesh;
  const fxAttr = (m: InstancedMesh) => m.geometry.getAttribute('aFx').array as Float32Array;

  it('draws nothing while idle', () => {
    const fx = createEffects(fakeWorld());
    for (const n of ['rings', 'sparks', 'heat', 'smoke']) expect(kind(fx, n).visible).toBe(false);
    frame(0.016);
    for (const n of ['rings', 'sparks', 'heat', 'smoke']) expect(kind(fx, n).visible).toBe(false);
    fx.dispose();
  });

  it('shows a kind only while something of it is alive, then goes idle again', () => {
    const fx = createEffects(fakeWorld());
    fx.popRing({ x: 0, y: 1, z: 0 });
    expect(kind(fx, 'rings').visible).toBe(true);
    expect(kind(fx, 'sparks').visible).toBe(false);
    frame(0.1);
    expect(kind(fx, 'rings').visible).toBe(true);
    frame(0.1);
    expect(kind(fx, 'rings').visible).toBe(false);
    fx.dispose();
  });

  it('is one instanced mesh per kind with a hard cap, reusing the oldest when full', () => {
    const fx = createEffects(fakeWorld(), { max: { rings: 3 } });
    const rings = kind(fx, 'rings');
    expect(rings.count).toBe(3);
    expect(kind(fx, 'sparks').count).toBe(FX_CAP.sparks);
    for (let i = 0; i < 3; i++) {
      fx.popRing({ x: i, y: 0, z: 0 });
      frame(0.01);
    }
    fx.popRing({ x: 9, y: 0, z: 0 }); // the fourth takes slot 0, the oldest
    expect(rings.instanceMatrix.array[12]).toBe(9);
    expect(rings.instanceMatrix.array[16 + 12]).toBe(1);
    expect(rings.count).toBe(3);
    fx.dispose();
  });

  it('reads reduced motion when an effect starts, not later', () => {
    const fx = createEffects(fakeWorld());
    const rings = kind(fx, 'rings');
    fx.popRing({ x: 0, y: 0, z: 0 });
    run.motion.reducedMotion = true;
    fx.popRing({ x: 1, y: 0, z: 0 });
    const a = fxAttr(rings);
    expect([a[2], a[6]]).toEqual([0, 1]); // reduced flag per instance
    expect(a[1]).toBeCloseTo(0.18);
    expect(a[5]).toBeCloseTo(0.15);
    fx.spark({ x: 0, y: 0, z: 0 });
    expect(fxAttr(kind(fx, 'sparks'))[1]).toBeCloseTo(0.15);
    fx.dispose();
  });

  it('keeps heat on its anchor, and stop fades then frees the slot', () => {
    const fx = createEffects(fakeWorld());
    const a = new Object3D();
    a.position.set(1, 2, 3);
    a.updateMatrixWorld(true);
    const heat = fx.heat(a);
    const mesh = kind(fx, 'heat');
    expect(mesh.visible).toBe(true);
    expect(Array.from(mesh.instanceMatrix.array.slice(12, 15))).toEqual([1, 2, 3]);
    a.position.set(4, 5, 6);
    a.updateMatrixWorld(true);
    frame(0.5);
    expect(Array.from(mesh.instanceMatrix.array.slice(12, 15))).toEqual([4, 5, 6]);
    expect(fxAttr(mesh)[1]).toBeLessThan(0); // running
    heat.stop();
    expect(fxAttr(mesh)[1]).toBeCloseTo(0.5);
    heat.stop(); // harmless twice
    expect(fxAttr(mesh)[1]).toBeCloseTo(0.5);
    frame(0.1);
    expect(mesh.visible).toBe(true); // still fading
    frame(0.1);
    expect(mesh.visible).toBe(false);
    fx.dispose();
  });

  it('a stale handle cannot stop the effect that reused its slot', () => {
    const fx = createEffects(fakeWorld(), { max: { heat: 1 } });
    const first = fx.heat(new Object3D());
    const second = fx.heat(new Object3D()); // takes the only slot
    first.stop();
    expect(fxAttr(kind(fx, 'heat'))[1]).toBeLessThan(0);
    second.stop();
    expect(fxAttr(kind(fx, 'heat'))[1]).toBeGreaterThanOrEqual(0);
    fx.dispose();
  });

  it('smoke reads reduced motion at its start', () => {
    run.motion.reducedMotion = true;
    const fx = createEffects(fakeWorld());
    fx.smoke(new Object3D());
    expect(fxAttr(kind(fx, 'smoke'))[2]).toBe(1);
    fx.dispose();
  });

  it('scales sizes by a number or a live value, and dispose removes everything', () => {
    const world = fakeWorld();
    const fx = createEffects(world, { scale: { value: 2 } });
    fx.spark({ x: 0, y: 0, z: 0 });
    expect(kind(fx, 'sparks').instanceMatrix.array[0]).toBeCloseTo(0.002);
    expect(world.scene.children).toContain(fx.object);
    fx.dispose();
    fx.dispose();
    expect(world.scene.children).not.toContain(fx.object);
    expect(run.ticks.length).toBe(0);
  });

  it('effectsOf shares one instance per world and makes a new one after dispose', () => {
    const w1 = fakeWorld();
    const w2 = fakeWorld();
    const a = effectsOf(w1);
    expect(effectsOf(w1)).toBe(a);
    expect(effectsOf(w2)).not.toBe(a);
    a.dispose();
    const b = effectsOf(w1);
    expect(b).not.toBe(a);
    b.dispose();
    effectsOf(w2).dispose();
  });
});
