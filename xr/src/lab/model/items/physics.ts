/**
 * The simple pendulum, ported from the lab figure (figures/lab/pendulum-stand.js): T = 2π√(L/g) for small swings, with
 * the figure's large-angle correction (1 + θ²/16 + 11θ⁴/3072) for the period the bob really keeps. Added for the
 * experiment: `record` writes down the period timed over the swings counted so far (at least 10), two slots.
 */
import { cycle, defineItem, type Prim } from '../types';

export const G = 9.81;
const rad = (d: number) => (d * Math.PI) / 180;
/** The small-angle period, seconds, for a length in mm. */
export const periodSmall = (mm: number): number => 2 * Math.PI * Math.sqrt(mm / 1000 / G);
/** The period the bob keeps from a release angle in degrees. */
export const period = (mm: number, deg: number): number => {
  const q = rad(deg);
  return periodSmall(mm) * (1 + (q * q) / 16 + (11 * q ** 4) / 3072);
};
/** The bob's angle in degrees, `t` seconds after release; `side` is -1 when it was let go on the near side. */
export const angleAt = (p: Readonly<Record<string, Prim>>, t: number, side = 1): number =>
  p.swinging ? side * (p.amplitude as number) * Math.cos((2 * Math.PI * t) / period(p.length as number, p.amplitude as number)) : 0;
/** The largest release angle the stand allows, degrees (the amplitude's range). */
export const MAX_RELEASE = 60;

export const BOB_GRAMS = { brass: 50, wood: 5 } as const;
/** Swings to time before `record` takes the period (the figure's advice: time 10 and divide by 10). */
export const MIN_SWINGS = 10;

const swingsOf = (p: Readonly<Record<string, Prim>>, t: number) => (p.swinging ? Math.floor(t / period(p.length as number, p.amplitude as number)) : 0);

export const pendulum = defineItem({
  kind: 'pendulum-stand',
  lab: 'physics',
  foot: [220, 300, 620],
  params: {
    length: { values: [200, 300, 400, 500], range: [100, 520], unit: 'mm' },
    amplitude: { values: [5, 10, 20, 45], range: [0, 60], unit: 'deg' },
    bob: { values: ['brass', 'wood'] },
    swinging: { values: [false, true] },
  },
  defaults: { length: 400, amplitude: 10, bob: 'brass', swinging: false },
  init: () => ({ swingT: 0, side: 1, records: 0, r1L: 0, r1T: 0, r1A: 0, r2L: 0, r2T: 0, r2A: 0 }),
  actions: {
    swing: (d) => d.set('swinging', !d.p.swinging),
    /** The bob pulled aside by hand and let go at `value` degrees (signed): it swings from there. */
    release: (d, a) => {
      const deg = a.value;
      if (typeof deg !== 'number' || !Number.isFinite(deg)) return 'bad-value';
      const amp = Math.min(MAX_RELEASE, Math.round(Math.abs(deg)));
      if (amp < 1) return void d.set('swinging', false);
      d.s.side = deg < 0 ? -1 : 1;
      d.set('amplitude', amp);
      d.set('swinging', true);
    },
    length: (d, a) => {
      d.set('length', a.value ?? cycle(pendulum.params.length!, d.p.length!));
    },
    amplitude: (d, a) => {
      d.set('amplitude', a.value ?? cycle(pendulum.params.amplitude!, d.p.amplitude!));
    },
    bob: (d) => d.set('bob', d.p.bob === 'brass' ? 'wood' : 'brass'),
    record: (d) => {
      // The stopwatch over n whole swings divided by n, to the hundredth: what a person would write down.
      const T = Math.round(period(d.p.length as number, d.p.amplitude as number) * 100) / 100;
      const L = d.p.length as number;
      const slot = (d.s.records as number) === 0 || d.s.r1L === L ? 1 : 2;
      d.s[`r${slot}L`] = L;
      d.s[`r${slot}T`] = T;
      d.s[`r${slot}A`] = d.p.amplitude as number;
      d.s.records = Math.max(d.s.records as number, slot);
    },
  },
  onParam: (st, k) => {
    if (k === 'swinging' || k === 'length' || k === 'amplitude') st.s.swingT = 0;
  },
  step: ({ p, s }, dt) => {
    if (p.swinging) s.swingT = (s.swingT as number) + dt;
  },
  live: (st) => st.p.swinging === true,
  mistakes: ['large-angle'],
  mistake: ({ p }) => (p.swinging && (p.amplitude as number) > 15 ? 'large-angle' : null),
  report: ({ p, s }) => ({
    // live: seconds since release and the bob's angle now (held at the release angle until it swings)
    tS: +(s.swingT as number).toFixed(2),
    angleDeg: +(p.swinging ? angleAt(p, s.swingT as number, (s.side as number) ?? 1) : (p.amplitude as number)).toFixed(1),
    swings: swingsOf(p, s.swingT as number),
    periodS: +period(p.length as number, p.amplitude as number).toFixed(2),
    periodSmallS: +periodSmall(p.length as number).toFixed(2),
    bobGrams: BOB_GRAMS[p.bob as keyof typeof BOB_GRAMS],
    records: s.records as number,
    r1L: s.r1L as number,
    r1T: s.r1T as number,
    r2L: s.r2L as number,
    r2T: s.r2T as number,
  }),
  stamp: ({ p, s }) => swingsOf(p, s.swingT as number),
});
