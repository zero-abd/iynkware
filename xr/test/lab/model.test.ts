import { describe, expect, it } from 'vitest';
import { MODELS, KINDS } from '../../src/lab/model/registry';
import { createLabStore } from '../../src/lab/model/store';
import { isRefusal, NO_ENV, type ItemState, type LabEnv } from '../../src/lab/model/types';
import { FLAME_COLOUR, phReading, SALTS } from '../../src/lab/model/items/chemistry';
import { solveSupply } from '../../src/lab/model/items/electrical';
import { period, periodSmall } from '../../src/lab/model/items/physics';
import { measureOf, traceOf } from '../../src/lab/model/items/signals';
import { createInventory } from '../../src/lab/model/inventory';

const act = (kind: string, st: ItemState, type: string, extra: Record<string, unknown> = {}, env: LabEnv = NO_ENV) => {
  const next = MODELS[kind]!.apply(st, { type, ...extra } as never, env);
  if (isRefusal(next)) throw new Error(`refused ${next.reason}`);
  return next;
};
const run = (kind: string, st: ItemState, ms: number, env: LabEnv = NO_ENV) => {
  for (let t = 0; t < ms; t += 50) MODELS[kind]!.step(st, 50, env);
};
const envOf = (states: Record<string, ItemState>): LabEnv => ({ stateOf: (k) => states[k] });

describe('lab item models (ported from the figures)', () => {
  it('every kind has defaults within its params and mistakes it can name', () => {
    for (const kind of KINDS) {
      const m = MODELS[kind]!;
      const st = m.init();
      for (const [k, spec] of Object.entries(m.params)) expect(spec.values.includes(st.p[k]!) || spec.range !== undefined, `${kind}.${k}`).toBe(true);
      expect(m.mistake(st, NO_ENV)).toBeNull();
    }
  });

  it('Bunsen burner: gas-unlit after 2 s, refused light without gas, failed light with the collar open', () => {
    const b = MODELS['bunsen-burner']!;
    let st = b.init();
    const r = b.apply(st, { type: 'light' }, NO_ENV);
    expect(isRefusal(r) && r.reason).toBe('no-gas');
    expect(isRefusal(b.apply(st, { type: 'set', key: 'lit', value: true }, NO_ENV))).toBe(true);
    st = act('bunsen-burner', st, 'gas');
    run('bunsen-burner', st, 1500);
    expect(b.mistake(st, NO_ENV)).toBeNull();
    run('bunsen-burner', st, 700);
    expect(b.mistake(st, NO_ENV)).toBe('gas-unlit');
    expect(b.report(st, NO_ENV).gasUnlitS).toBe(2);
    st = act('bunsen-burner', st, 'collar', { value: 'open' });
    st = act('bunsen-burner', st, 'light');
    expect(st.p.lit).toBe(false);
    expect(b.mistake(st, NO_ENV)).toBe('light-collar-open');
    st = act('bunsen-burner', st, 'gas');
    expect(b.mistake(st, NO_ENV)).toBeNull();
    st = act('bunsen-burner', st, 'collar', { value: 'closed' });
    st = act('bunsen-burner', st, 'gas');
    st = act('bunsen-burner', st, 'light');
    expect(b.report(st, NO_ENV).flame).toBe('luminous');
    st = act('bunsen-burner', st, 'collar', { value: 'open' });
    run('bunsen-burner', st, 21_000);
    expect(b.mistake(st, NO_ENV)).toBe('blue-flame-idle');
    // Gas off puts the flame out.
    st = act('bunsen-burner', st, 'gas');
    expect(st.p.lit).toBe(false);
  });

  it('beaker: heating rules in the figure’s order and the temperature climbs', () => {
    const k = MODELS['beaker-250']!;
    let st = k.init();
    st = act('beaker-250', st, 'heat');
    expect(k.mistake(st, NO_ENV)).toBeNull();
    run('beaker-250', st, 120_000);
    expect(k.report(st, NO_ENV).boiling).toBe(true);
    st = act('beaker-250', st, 'fill');
    expect(k.mistake(st, NO_ENV)).toBe('heating-too-full');
    st = act('beaker-250', st, 'empty');
    expect(k.mistake(st, NO_ENV)).toBe('heating-empty');
    st = act('beaker-250', st, 'heat');
    for (let i = 0; i < 6; i++) st = act('beaker-250', st, 'fill');
    expect(st.p.volume).toBe(300);
    expect(k.mistake(st, NO_ENV)).toBe('overfilled');
    expect(isRefusal(k.apply(st, { type: 'fill' }, NO_ENV))).toBe(true);
  });

  it('conical flask: a swirl lasts 3 s and is too full above 150 mL', () => {
    const k = MODELS['erlenmeyer-250']!;
    let st = act('erlenmeyer-250', k.init(), 'swirl');
    expect(st.p.swirling).toBe(true);
    run('erlenmeyer-250', st, 3100);
    expect(st.p.swirling).toBe(false);
    st = act('erlenmeyer-250', act('erlenmeyer-250', st, 'fill'), 'fill');
    st = act('erlenmeyer-250', st, 'swirl');
    expect(k.mistake(st, NO_ENV)).toBe('swirl-too-full');
  });

  it('bench supply: CV until the load wants more than the limit, then CC; the figure’s mistakes', () => {
    expect(solveSupply({ on: true, vSet: 5, iSet: 0.5 }, 100)).toMatchObject({ mode: 'CV', v: 5, i: 0.05 });
    expect(solveSupply({ on: true, vSet: 12, iSet: 0.5 }, 10)).toMatchObject({ mode: 'CC', v: 5, i: 0.5 });
    const k = MODELS['bench-power-supply']!;
    let st = k.init({ load: 'short', iSet: 2 });
    st = act('bench-power-supply', st, 'power');
    expect(k.mistake(st, NO_ENV)).toBe('short-high-limit');
    st = act('bench-power-supply', k.init({ load: 'r10', vSet: 9, iSet: 2 }), 'power');
    expect(k.mistake(st, NO_ENV)).toBe('resistor-overload');
    st = act('bench-power-supply', k.init({ load: 'r100', iSet: 5 }), 'power');
    expect(k.mistake(st, NO_ENV)).toBe('limit-at-max');
    // Knob halves step without wrapping.
    st = act('bench-power-supply', st, 'iSet', { value: 1 });
    expect(st.p.iSet).toBe(5);
    st = act('bench-power-supply', st, 'iSet', { value: -1 });
    expect(st.p.iSet).toBe(3);
  });

  it('bench supply: the unknown resistor and two recorded readings give R', () => {
    const k = MODELS['bench-power-supply']!;
    let st = k.init({ load: 'unknown', vSet: 5, iSet: 1 }, 7);
    const R = st.s.ohms as number;
    expect([22, 47, 68, 150, 220]).toContain(R);
    expect(isRefusal(k.apply(st, { type: 'record' }, NO_ENV))).toBe(true);
    st = act('bench-power-supply', st, 'power');
    st = act('bench-power-supply', st, 'record');
    st = act('bench-power-supply', st, 'vSet', { value: 1 });
    st = act('bench-power-supply', st, 'record');
    const r = k.report(st, NO_ENV);
    expect(r.readings).toBe(2);
    expect((r.r1V as number) / (r.r1I as number)).toBeCloseTo(R, 0);
    expect((r.r2V as number) / (r.r2I as number)).toBeCloseTo(R, 0);
  });

  it('soldering station: iron left out after 15 s, too hot, dry sponge', () => {
    const k = MODELS['soldering-station']!;
    let st = act('soldering-station', k.init(), 'power');
    st = act('soldering-station', st, 'iron');
    run('soldering-station', st, 16_000);
    expect(k.mistake(st, NO_ENV)).toBe('iron-left-out');
    expect((k.report(st, NO_ENV).tipC as number) > 300).toBe(true);
    st = act('soldering-station', act('soldering-station', st, 'iron'), 'tempSet', { value: 1 });
    st = act('soldering-station', act('soldering-station', st, 'tempSet', { value: 1 }), 'tempSet', { value: 1 });
    expect(k.mistake(st, NO_ENV)).toBe('too-hot');
  });

  it('pendulum: T = 2π√(L/g) for small swings, large-angle above 15°, record needs 10 swings', () => {
    expect(periodSmall(400)).toBeCloseTo(1.269, 3);
    expect(period(400, 45) / periodSmall(400)).toBeGreaterThan(1.03);
    const k = MODELS['pendulum-stand']!;
    let st = act('pendulum-stand', k.init({ amplitude: 10 }), 'swing');
    expect(isRefusal(k.apply(st, { type: 'record' }, NO_ENV))).toBe(true);
    run('pendulum-stand', st, 13_000);
    expect(k.report(st, NO_ENV).swings).toBe(10);
    st = act('pendulum-stand', st, 'record');
    expect(k.report(st, NO_ENV).r1T).toBeCloseTo(1.27, 2);
    expect(isRefusal(k.apply(st, { type: 'length' }, NO_ENV))).toBe(true);
    st = act('pendulum-stand', k.init({ amplitude: 20 }), 'swing');
    expect(k.mistake(st, NO_ENV)).toBe('large-angle');
  });

  it('flame-test kit: clean, dip, colour in a blue flame; masked in yellow; dirty loop', () => {
    const burner = act('bunsen-burner', act('bunsen-burner', act('bunsen-burner', MODELS['bunsen-burner']!.init(), 'gas'), 'light'), 'collar', { value: 'half' });
    const env = envOf({ 'bunsen-burner': burner });
    const k = MODELS['flame-test-kit']!;
    let st = k.init(undefined, 3);
    const unknown = st.s.unknown as string;
    expect(SALTS).toContain(unknown);
    st = act('flame-test-kit', st, 'dip-salt', { value: 'Cu' }, env);
    expect(k.mistake(st, env)).toBe('dirty-loop');
    st = act('flame-test-kit', st, 'dip-acid', {}, env);
    st = act('flame-test-kit', st, 'to-flame', {}, env);
    run('flame-test-kit', st, 2000, env);
    expect(st.s.clean).toBe(true);
    st = act('flame-test-kit', st, 'dip-salt', { value: 'Sr' }, env);
    expect(k.mistake(st, env)).toBeNull();
    st = act('flame-test-kit', st, 'to-flame', {}, env);
    run('flame-test-kit', st, 1000, env);
    expect(k.report(st, env).flameColour).toBe(FLAME_COLOUR.Sr.name);
    // A yellow flame hides it.
    const yellow = act('bunsen-burner', burner, 'collar', { value: 'closed' });
    const env2 = envOf({ 'bunsen-burner': yellow });
    expect(k.report(st, env2).seen).toBe('masked');
    expect(k.mistake(st, env2)).toBe('luminous-flame');
    // An unlit burner: no flame there.
    expect(k.mistake(st, envOf({ 'bunsen-burner': MODELS['bunsen-burner']!.init() }))).toBe('loop-no-flame');
  });

  it('flame colours are the expected ones', () => {
    expect(Object.fromEntries(SALTS.map((s) => [s, FLAME_COLOUR[s].name]))).toEqual({
      Li: 'crimson',
      Na: 'yellow-orange',
      K: 'lilac',
      Ca: 'orange-red',
      Cu: 'blue-green',
      Sr: 'red',
      Ba: 'pale-green',
    });
  });

  it('pH meter: reads the beaker, off when not calibrated, drifts when not rinsed', () => {
    const beaker = MODELS['beaker-250']!.init({ liquid: 'vinegar', volume: 150 });
    const env = envOf({ 'beaker-250': beaker });
    const k = MODELS['ph-meter']!;
    let st = act('ph-meter', k.init(undefined, 1), 'power', {}, env);
    expect(isRefusal(k.apply(st, { type: 'calibrate' }, env))).toBe(true);
    st = act('ph-meter', st, 'probe', { value: 'sample' }, env);
    expect(k.mistake(st, env)).toBe('ph-not-calibrated');
    expect(phReading(st, env)).not.toBe(2.9);
    // Straight from the sample into the buffer drags vinegar in: the buffer reads low until the probe is rinsed.
    st = act('ph-meter', st, 'probe', { value: 'buffer' }, env);
    expect(phReading(st, env)!).toBeLessThan(7);
    st = act('ph-meter', act('ph-meter', st, 'probe', { value: 'rinse' }, env), 'probe', { value: 'buffer' }, env);
    st = act('ph-meter', st, 'calibrate', {}, env);
    expect(phReading(st, env)).toBe(7);
    st = act('ph-meter', st, 'probe', { value: 'sample' }, env);
    expect(k.mistake(st, env)).toBe('ph-not-rinsed');
    expect(phReading(st, env)).not.toBe(2.9);
    st = act('ph-meter', st, 'probe', { value: 'rinse' }, env);
    st = act('ph-meter', st, 'probe', { value: 'sample' }, env);
    expect(k.mistake(st, env)).toBeNull();
    expect(phReading(st, env)).toBe(2.9);
  });

  it('scope and generator: readable window, clipped and crowded traces, Measure', () => {
    const gen = MODELS['function-generator']!.init({ freq: 1000, amp: 4, on: true });
    const env = envOf({ 'function-generator': gen });
    const k = MODELS.oscilloscope!;
    let st = act('oscilloscope', act('oscilloscope', k.init(), 'power', {}, env), 'probe', {}, env);
    expect(traceOf(st, env).periods).toBeCloseTo(100);
    expect(k.mistake(st, env)).toBe('timebase-too-slow');
    st = act('oscilloscope', st, 'set', { key: 'timeDiv', value: 2e-4 }, env);
    st = act('oscilloscope', st, 'set', { key: 'voltsDiv', value: 0.2 }, env);
    expect(traceOf(st, env)).toMatchObject({ periods: 2, clipped: true, readable: false });
    expect(k.mistake(st, env)).toBe('scope-clipped');
    expect(measureOf(traceOf(st, env), 0.2).vpp).toBe(1.6);
    st = act('oscilloscope', st, 'set', { key: 'voltsDiv', value: 1 }, env);
    expect(traceOf(st, env).readable).toBe(true);
    st = act('oscilloscope', st, 'measure', {}, env);
    expect(k.report(st, env)).toMatchObject({ mVpp: 4, mF: 1000, mReadable: true });
    // A mystery signal is seeded and its knobs are locked.
    const mystery = MODELS['function-generator']!.init({ mystery: true }, 9);
    expect([50, 200, 1000, 5000]).toContain(mystery.p.freq);
    expect(isRefusal(MODELS['function-generator']!.apply(mystery, { type: 'freq' }, NO_ENV))).toBe(true);
  });
});

describe('lab store', () => {
  it('places, applies, refuses, steps with a tick only on change, undoes and clears', () => {
    const store = createLabStore();
    const seen: string[] = [];
    store.subscribe((c) => seen.push(c.type));
    const id = store.place('bunsen-burner', { x: 0, z: 0, yaw: 0 });
    expect(store.apply(id, { type: 'light' })).toEqual({ ok: false, reason: 'no-gas' });
    expect(store.apply(id, { type: 'gas' })).toEqual({ ok: true });
    store.step(100);
    expect(seen.filter((s) => s === 'tick')).toHaveLength(0);
    for (let i = 0; i < 25; i++) store.step(100);
    expect(seen.filter((s) => s === 'tick').length).toBeGreaterThan(0);
    expect(store.mistake(id)).toBe('gas-unlit');
    expect(store.undo()).toBe(true);
    expect(store.get(id)!.state.p.gasOn).toBe(false);
    store.answer('salt', 'Na');
    expect(store.answers.salt).toBe('Na');
    store.clear();
    expect(store.items()).toHaveLength(0);
    expect(store.answers).toEqual({});
    expect(seen).toEqual(expect.arrayContaining(['place', 'refuse', 'apply', 'answer', 'clear']));
  });

  it('an unknown kind is placed as the generic stand-in', () => {
    const store = createLabStore();
    const id = store.place('fume-hood', { x: 0, z: 0, yaw: 0 }, { label: 'fume hood', placeholder: true });
    expect(store.get(id)).toMatchObject({ kind: 'generic', placeholder: true, label: 'fume hood' });
  });
});

describe('lab inventory', () => {
  it('finds items by kind, alias and translated name; a stand-in for the rest', () => {
    const inv = createInventory();
    expect(inv.request('oscilloscope')).toMatchObject({ found: true, kind: 'oscilloscope', lab: 'signals' });
    expect(inv.request('Scope')).toMatchObject({ found: true, kind: 'oscilloscope' });
    expect(inv.request('Bunsenbrenner')).toMatchObject({ found: true, kind: 'bunsen-burner' });
    expect(inv.request('pH 计')).toMatchObject({ found: true, kind: 'ph-meter' });
    expect(inv.request('fume hood')).toEqual({ found: false, kind: 'generic', name: 'fume hood', generated: false, placeholder: true });
    expect(inv.kinds()).toContain('flame-test-kit');
    expect(inv.has('generic')).toBe(false);
  });
});
