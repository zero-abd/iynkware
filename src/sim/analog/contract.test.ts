// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inhouseBackend } from './backend.ts';
import { PWL_OPTIONS } from './elements.ts';
import { ANALOG_LAYERS } from './layers.ts';
import type { LiveAnalog } from './live.ts';
import { solve } from './solve.ts';
import type { Element } from './types.ts';
import { waveValue, type Wave } from './waveform.ts';

const SAMPLES: Record<string, Element> = {
  C: { id: 'C1', kind: 'C', a: 1, b: 0, farads: 1e-6, esrOhms: 0.1, v0: 0, polarized: false, ratedVolts: 16 },
  L: { id: 'L1', kind: 'L', a: 1, b: 0, henries: 1e-3, dcrOhms: 0.2, i0: 0, ratedAmps: 1 },
  VW: { id: 'VW1', kind: 'VW', a: 1, b: 0, shape: 'sine', amplitudeV: 1, offsetV: 0, hz: 1000, duty: 0.5, phaseDeg: 0, rSeriesOhms: 50, limit: { amps: 0.1, mode: 'droop' } },
  OA: { id: 'U1', kind: 'OA', inP: 1, inN: 2, out: 3, vcc: 4, vee: 0, openLoopGain: 1e5, gbwHz: 1e6, slewVPerUs: 0.5, rOutOhms: 75, headroomVolts: 1.5, headroomLowVolts: 0.02, rating: { vabsVolts: 32, icmaxAmps: 0.06 } },
  TMR: { id: 'U2', kind: 'TMR', gnd: 0, trig: 1, out: 2, reset: 3, ctrl: 4, thr: 5, dis: 6, vcc: 7, rOutOhms: 20, highDropVolts: 1.7, disOnOhms: 10, quiescentAmps: 0.003, rating: { vabsVolts: 18, icmaxAmps: 0.225 } },
  D: {
    id: 'DZ1', kind: 'D', a: 1, b: 0, modelId: 'model:diode.pwl@1', vf: 0.7, rdOhms: 0.2, maxAmps: 0.05,
    junction: { kind: 'shockley', isAmps: 1e-14, n: 1, rsOhms: 0, rzOhms: 7, vbrVolts: 5.1 }, rating: { pmaxWatts: 0.5 },
  },
};

const NEW_KINDS = ['C', 'L', 'VW', 'OA', 'TMR'];

describe('new element kinds', () => {
  it('are reported as not modelled yet by the pwl solver and change nothing else', () => {
    const rail: Element = { id: 'V1', kind: 'V', a: 1, b: 0, volts: 5, rSeriesOhms: 0.5 };
    const load: Element = { id: 'R1', kind: 'R', a: 1, b: 0, ohms: 100 };
    const base = solve({ nodes: 8, ground: 0, elements: [rail, load] }, PWL_OPTIONS);
    for (const kind of NEW_KINDS) {
      const r = solve({ nodes: 8, ground: 0, elements: [rail, load, SAMPLES[kind]] }, PWL_OPTIONS);
      expect(r.diagnostics.filter((d) => d.id === 'not-modelled-yet').map((d) => d.ref.part)).toEqual([SAMPLES[kind].id]);
      expect(r.branch[SAMPLES[kind].id]).toBeUndefined();
      expect(r.v[1]).toBeCloseTo(base.v[1], 12);
    }
  });

  it('are modelled by the newton solver, whose operating point reads them', () => {
    const rail: Element = { id: 'V1', kind: 'V', a: 1, b: 0, volts: 5, rSeriesOhms: 0.5 };
    const load: Element = { id: 'R1', kind: 'R', a: 1, b: 0, ohms: 100 };
    for (const kind of NEW_KINDS) {
      const r = solve({ nodes: 8, ground: 0, elements: [rail, load, SAMPLES[kind]] }, { ...PWL_OPTIONS, mode: 'newton' });
      expect(r.diagnostics.filter((d) => d.id === 'not-modelled-yet'), kind).toEqual([]);
      expect(r.branch[SAMPLES[kind].id], kind).toBeDefined();
    }
  });

  it('keeps a Zener a diode with a breakdown voltage', () => {
    const r = solve({ nodes: 3, ground: 0, elements: [{ id: 'V1', kind: 'V', a: 1, b: 0, volts: 12, rSeriesOhms: 0.5 }, { id: 'R1', kind: 'R', a: 1, b: 2, ohms: 470 }, { ...SAMPLES.D, a: 0, b: 2 } as Element] }, { ...PWL_OPTIONS, mode: 'newton', reltol: 1e-9 });
    expect(r.converged).toBe(true);
    expect(r.v[2]).toBeGreaterThan(4.5);
    expect(r.v[2]).toBeLessThan(6);
  });
});

describe('descriptor layers', () => {
  const schema = JSON.parse(readFileSync('docs/MASTER_PLAN/04_ARCHITECTURE/schemas/component.schema.json', 'utf8')) as { $defs: { elementKind: { enum: string[] } } };

  it('are all element kinds the component schema allows', () => {
    for (const name of Object.keys(ANALOG_LAYERS)) expect(schema.$defs.elementKind.enum).toContain(name);
  });

  it.each(Object.entries(ANALOG_LAYERS))('%s names real fields of its element', (_name, layer) => {
    const sample = SAMPLES[layer.element] as unknown as Record<string, unknown>;
    const has = (path: string) => path.split('.').reduce<unknown>((o, key) => (o as Record<string, unknown> | undefined)?.[key], sample) !== undefined;
    for (const field of Object.values(layer.terminals)) expect(typeof sample[field], field).toBe('number');
    for (const field of Object.values(layer.params)) expect(has(field), field).toBe(true);
  });
});

describe('waveValue', () => {
  const wave = (shape: Wave['shape'], extra: Partial<Wave> = {}): Wave => ({ shape, amplitudeV: 2, offsetV: 1, hz: 1000, duty: 0.25, phaseDeg: 0, ...extra });
  const at = (w: Wave, turns: number) => waveValue(w, turns / w.hz);

  it('swings a sine, a triangle and a square around the offset, starting at the offset and rising', () => {
    expect(at(wave('sine'), 0)).toBeCloseTo(1, 12);
    expect(at(wave('sine'), 0.25)).toBeCloseTo(3, 12);
    expect(at(wave('sine'), 0.75)).toBeCloseTo(-1, 12);
    expect(at(wave('triangle'), 0.25)).toBeCloseTo(3, 12);
    expect(at(wave('triangle'), 0.5)).toBeCloseTo(1, 12);
    expect(at(wave('triangle'), 0.75)).toBeCloseTo(-1, 12);
    expect(at(wave('square'), 0.1)).toBe(3);
    expect(at(wave('square'), 0.6)).toBe(-1);
  });

  it('holds a pulse high for the duty fraction of the period, from the offset up', () => {
    expect(at(wave('pulse'), 0.1)).toBe(3);
    expect(at(wave('pulse'), 0.3)).toBe(1);
  });

  it('shifts by the phase and holds the phase-0 value when there is no frequency', () => {
    expect(waveValue(wave('sine', { phaseDeg: 90 }), 0)).toBeCloseTo(3, 12);
    expect(waveValue(wave('sine', { hz: 0, phaseDeg: 90 }), 0.123)).toBeCloseTo(3, 12);
  });
});

describe('inhouseBackend', () => {
  it('forwards to the live solver, applying changes first, and can step through time', () => {
    const calls: string[] = [];
    const live = {
      load: () => (calls.push('load'), { ok: true }),
      apply: (c: unknown[]) => void calls.push(`apply ${c.length}`),
      advanceTo: (t: number) => (calls.push(`advance ${t}`), { at: t }),
    } as unknown as LiveAnalog;
    const backend = inhouseBackend(live);
    expect(backend.kind).toBe('mna-inhouse');
    expect(backend.capabilities).toEqual({ transient: true, coSimulate: true, interactive: true });
    backend.advanceTo(50, [{ kind: 'source', element: 'V1', volts: 3 }]);
    expect(calls).toEqual(['apply 1', 'advance 50']);
  });
});
