/**
 * Signals and systems bench: a function generator and an oscilloscope (new here; their figures are being drawn
 * elsewhere, ids `function-generator` and `oscilloscope`). The scope's screen is 10 divisions wide and 8 tall; it shows
 * the generator's output when the probe is on the generator and both are on. A wave is readable when one to six
 * periods fill the screen and it is two to eight divisions tall; the scope's Measure then reads Vpp and f exactly, and
 * a clipped or crowded trace reads wrong, as a real auto-measure does.
 */
import { cycle, defineItem, nudge, pickSeeded, type ItemState, type LabEnv, type Prim } from '../types';

export const SCREEN = { divX: 10, divY: 8 } as const;
export const FREQS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000] as const;
export const AMPS = [0.5, 1, 2, 4, 6, 10] as const;
/** What the seed hides on a mystery signal. */
export const MYSTERY_FREQS = [50, 200, 1000, 5000] as const;
export const MYSTERY_AMPS = [1, 2, 4, 6] as const;
export const TIME_DIVS = [1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2] as const;
export const VOLT_DIVS = [0.1, 0.2, 0.5, 1, 2, 5] as const;

export const generator = defineItem({
  kind: 'function-generator',
  lab: 'signals',
  foot: [220, 200, 90],
  params: {
    wave: { values: ['sine', 'square', 'triangle'] },
    freq: { values: FREQS, range: [1, 100000], unit: 'Hz' },
    amp: { values: AMPS, range: [0, 20], unit: 'Vpp' },
    on: { values: [false, true] },
    /** The display shows `???`: a teacher's signal to measure. */
    mystery: { values: [false, true] },
  },
  defaults: { wave: 'sine', freq: 1000, amp: 2, on: false, mystery: false },
  init: (p, seed) => {
    if (p.mystery) {
      p.freq = pickSeeded(MYSTERY_FREQS, seed, 21);
      p.amp = pickSeeded(MYSTERY_AMPS, seed, 23);
    }
    return {};
  },
  actions: {
    power: (d) => d.set('on', !d.p.on),
    wave: (d, a) => d.set('wave', a.value ?? cycle(generator.params.wave!, d.p.wave!)),
    freq: (d, a) => {
      if (d.p.mystery) return 'mystery-locked';
      d.set('freq', typeof a.value === 'number' ? nudge(generator.params.freq!, d.p.freq!, a.value) : cycle(generator.params.freq!, d.p.freq!));
    },
    amp: (d, a) => {
      if (d.p.mystery) return 'mystery-locked';
      d.set('amp', typeof a.value === 'number' ? nudge(generator.params.amp!, d.p.amp!, a.value) : cycle(generator.params.amp!, d.p.amp!));
    },
  },
  mistakes: [],
  report: ({ p }) => ({ shows: p.mystery ? '???' : `${p.freq} Hz ${p.amp} Vpp` }),
});

export interface Trace {
  /** The generator is on, the probe on it and the scope on. */
  readonly present: boolean;
  readonly wave: Prim;
  readonly vpp: number;
  readonly freq: number;
  /** Periods across the 10 divisions. */
  readonly periods: number;
  /** Divisions tall, peak to peak. */
  readonly divs: number;
  readonly clipped: boolean;
  readonly readable: boolean;
}

const NO_TRACE: Trace = { present: false, wave: 'sine', vpp: 0, freq: 0, periods: 0, divs: 0, clipped: false, readable: false };

/** What the scope shows, from its own settings and the generator's (through `env`). */
export function traceOf(st: ItemState, env: LabEnv): Trace {
  const g = env.stateOf('function-generator');
  if (!g || !g.p.on || !st.p.on || !st.p.probe) return NO_TRACE;
  const vpp = g.p.amp as number;
  const freq = g.p.freq as number;
  const periods = SCREEN.divX * (st.p.timeDiv as number) * freq;
  const divs = vpp / (st.p.voltsDiv as number);
  const clipped = divs > SCREEN.divY;
  return { present: true, wave: g.p.wave!, vpp, freq, periods, divs, clipped, readable: !clipped && divs >= 2 && periods >= 1 && periods <= 6 };
}

/** The scope's auto-measure on this trace: exact when readable; a clipped trace reads the screen's height, too few periods no frequency. */
export function measureOf(t: Trace, voltsDiv: number): { vpp: number; freq: number } {
  if (!t.present) return { vpp: 0, freq: 0 };
  const vpp = t.clipped ? SCREEN.divY * voltsDiv : t.vpp;
  const freq = t.periods < 1 || t.periods > 25 ? 0 : t.freq;
  return { vpp: Math.round(vpp * 100) / 100, freq };
}

export const scope = defineItem({
  kind: 'oscilloscope',
  lab: 'signals',
  foot: [320, 200, 160],
  params: {
    on: { values: [false, true] },
    /** The probe is clipped to the generator's output. */
    probe: { values: [false, true] },
    timeDiv: { values: TIME_DIVS, unit: 's/div' },
    voltsDiv: { values: VOLT_DIVS, unit: 'V/div' },
  },
  defaults: { on: false, probe: false, timeDiv: 1e-2, voltsDiv: 5 },
  init: () => ({ measured: false, mVpp: 0, mF: 0, mReadable: false }),
  actions: {
    power: (d) => d.set('on', !d.p.on),
    probe: (d, _a, env) => {
      if (!env.stateOf('function-generator')) return 'no-generator';
      d.set('probe', !d.p.probe);
    },
    // Knobs with end stops: `value` -1 or +1 (a twist, or the knob's two halves); bare select steps one finer.
    timeDiv: (d, a) => d.set('timeDiv', nudge(scope.params.timeDiv!, d.p.timeDiv!, typeof a.value === 'number' ? a.value : -1)),
    voltsDiv: (d, a) => d.set('voltsDiv', nudge(scope.params.voltsDiv!, d.p.voltsDiv!, typeof a.value === 'number' ? a.value : -1)),
    measure: (d, _a, env) => {
      if (!d.p.on) return 'scope-off';
      const t = traceOf(d, env);
      if (!t.present) return 'no-signal';
      const m = measureOf(t, d.p.voltsDiv as number);
      d.s.measured = true;
      d.s.mVpp = m.vpp;
      d.s.mF = m.freq;
      d.s.mReadable = t.readable;
    },
  },
  mistakes: ['scope-clipped', 'timebase-too-fast', 'timebase-too-slow'],
  mistake: (st, env) => {
    const t = traceOf(st, env);
    if (!t.present) return null;
    if (t.clipped) return 'scope-clipped';
    if (t.periods < 0.5) return 'timebase-too-fast';
    if (t.periods > 20) return 'timebase-too-slow';
    return null;
  },
  report: (st, env) => {
    const t = traceOf(st, env);
    return {
      signal: t.present,
      periods: Math.round(t.periods * 10) / 10,
      divs: Math.round(t.divs * 10) / 10,
      clipped: t.clipped,
      readable: t.readable,
      measured: st.s.measured as boolean,
      mVpp: st.s.mVpp as number,
      mF: st.s.mF as number,
      mReadable: st.s.mReadable as boolean,
    };
  },
});
