import { describe, expect, it } from 'vitest';
import { channelsOf } from '../../src/lab/items/channels';
import { CONTROLS } from '../../src/lab/items/controls';
import { bobPoint, pullAngle, SPATULA_TIP, spatulaMove, type BenchThing, type V3 } from '../../src/lab/items/hands';
import { NOTES } from '../../src/lab/model/catalogue';
import { angleAt, pendulum, period } from '../../src/lab/model/items/physics';
import { SPATULA_KIND } from '../../src/lab/model/items/spatula';
import { MODELS } from '../../src/lab/model/registry';
import { isRefusal, NO_ENV, type ItemState } from '../../src/lab/model/types';
import { LAB_LAYOUTS } from '../../src/lab/experiments/list';

const ok = (r: ItemState | { refused: true }) => {
  expect(isRefusal(r as never)).toBe(false);
  return r as ItemState;
};
const footOf = (kind: string) => MODELS[kind]!.foot;

describe('pendulum bob, held on its own', () => {
  it('the angle read back from where the bob is drawn is the angle it was drawn at, both sides, clamped to 60', () => {
    const p: V3 = { x: 0, y: 0, z: 0 };
    for (const deg of [-45, -10, 0, 7, 30, 59]) expect(pullAngle(bobPoint(400, deg, p))).toBeCloseTo(deg, 6);
    expect(pullAngle(bobPoint(300, 85, p))).toBe(60);
    expect(pullAngle(bobPoint(300, -85, p))).toBe(-60);
  });

  it('release swings from the angle it was let go at, on that side, with that period', () => {
    const st = ok(pendulum.apply(pendulum.init({ amplitude: 20 }), { type: 'release', value: -8.4 }, NO_ENV));
    expect(st.p.swinging).toBe(true);
    expect(st.p.amplitude).toBe(8);
    expect(st.s.side).toBe(-1);
    expect(angleAt(st.p, 0, st.s.side as number)).toBeCloseTo(-8);
    expect(pendulum.report(st, NO_ENV).periodS).toBeCloseTo(period(400, 8), 2);
    expect(pendulum.mistake(st, NO_ENV)).toBeNull();
    const wide = ok(pendulum.apply(pendulum.init(), { type: 'release', value: 75 }, NO_ENV));
    expect(wide.p.amplitude).toBe(60);
    expect(pendulum.mistake(wide, NO_ENV)).toBe('large-angle');
    const none = ok(pendulum.apply(st, { type: 'release', value: 0.3 }, NO_ENV));
    expect(none.p.swinging).toBe(false);
    expect(isRefusal(pendulum.apply(st, { type: 'release' }, NO_ENV))).toBe(true);
  });

  it('the bob is no longer a press-only control; the stand keeps its pads', () => {
    expect(CONTROLS['pendulum-stand']!.some((c) => c.id === 'bob')).toBe(false);
    expect(CONTROLS['pendulum-stand']!.map((c) => c.id)).toEqual(['length', 'angle', 'record']);
  });
});

describe('spatula', () => {
  const thing = (id: string, kind: string, x: number, z: number, p: Record<string, string | number | boolean> = {}): BenchThing => ({
    id,
    kind,
    pose: { x, z, yaw: 0 },
    state: { p },
  });
  const bench = [
    thing('salt', 'substance', 150, 170, { substance: 'sodium-chloride' }),
    thing('acid', 'substance', -100, 170, { substance: 'hydrochloric-acid' }),
    thing('na', 'element-sample', 0, 170, { symbol: 'Na' }),
    thing('beaker', 'beaker-250', 250, -20),
  ];

  it('an empty blade in a solid takes a scoop; a liquid gives none; a loaded blade over a beaker tips in', () => {
    expect(spatulaMove({ x: 0.15, y: 0.01, z: 0.17 }, '', bench, footOf)).toEqual({ type: 'scoop', id: 'salt', what: 'sodium-chloride' });
    expect(spatulaMove({ x: 0.0, y: 0.05, z: 0.17 }, '', bench, footOf)).toEqual({ type: 'scoop', id: 'na', what: 'Na' });
    expect(spatulaMove({ x: -0.1, y: 0.02, z: 0.17 }, '', bench, footOf)).toBeNull();
    expect(spatulaMove({ x: 0.15, y: 0.3, z: 0.17 }, '', bench, footOf)).toBeNull();
    expect(spatulaMove({ x: 0.25, y: 0.12, z: -0.02 }, '', bench, footOf)).toBeNull();
    expect(spatulaMove({ x: 0.25, y: 0.12, z: -0.02 }, 'sodium-chloride', bench, footOf)).toEqual({ type: 'tip', id: 'beaker' });
    expect(spatulaMove({ x: 0.15, y: 0.01, z: 0.17 }, 'sodium-chloride', bench, footOf)).toBeNull();
  });

  it('scoop and tip go through the models: the spatula carries it, the vessel records it', () => {
    const sp = MODELS[SPATULA_KIND]!;
    const loaded = ok(sp.apply(sp.init(), { type: 'scoop', value: 'sodium-chloride' }, NO_ENV));
    expect(sp.report(loaded, NO_ENV).load).toBe('sodium-chloride');
    expect(channelsOf(SPATULA_KIND, loaded, sp.report(loaded, NO_ENV), NO_ENV)).toEqual([['tint:LOAD', '#f7f7f3']]);
    const empty = ok(sp.apply(loaded, { type: 'tip' }, NO_ENV));
    expect(sp.report(empty, NO_ENV).load).toBeNull();
    expect(channelsOf(SPATULA_KIND, empty, sp.report(empty, NO_ENV), NO_ENV)).toEqual([['tint:LOAD', '']]);
    for (const kind of ['beaker-250', 'erlenmeyer-250']) {
      const m = MODELS[kind]!;
      const a = ok(m.apply(m.init(), { type: 'add', value: 'sodium-chloride' }, NO_ENV));
      const b = ok(m.apply(a, { type: 'add', value: 'Na' }, NO_ENV));
      expect(m.report(b, NO_ENV).added, kind).toBe('sodium-chloride,Na');
    }
  });

  it('lies in the chemistry lab beside a dish of salt, its tip on the blade, with notes in six languages', () => {
    const kinds = LAB_LAYOUTS.chemistry.map((k) => k.kind);
    expect(kinds).toContain(SPATULA_KIND);
    expect(kinds).toContain('substance');
    expect(SPATULA_TIP.x).toBeLessThanOrEqual(MODELS[SPATULA_KIND]!.foot[0] / 2000);
    expect(Object.values(NOTES[SPATULA_KIND]!.name).every((s) => s.length > 0)).toBe(true);
  });
});
