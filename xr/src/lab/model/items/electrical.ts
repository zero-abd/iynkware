/**
 * Electrical bench equipment, ported from the lab figures (figures/lab/{bench-power-supply,soldering-station}.js):
 * the supply holds the set voltage (CV) until the load wants more than the current limit, then the current (CC).
 * Added here for the Ohm's law experiment: an `unknown` load (a resistor whose value the seed hides, 5 W) and a
 * `record` action that writes down the meters' reading, two slots.
 */
import { cycle, defineItem, nudge, pickSeeded, type ItemState, type Prim } from '../types';

export const UNKNOWN_OHMS = [22, 47, 68, 150, 220] as const;
const LOADS = {
  open: { ohms: Infinity, watts: 0 },
  r100: { ohms: 100, watts: 2 },
  r10: { ohms: 10, watts: 5 },
  short: { ohms: 0.05, watts: 0 },
  unknown: { ohms: NaN, watts: 5 },
} as const;
export type Load = keyof typeof LOADS;

const VSETS = [0, 1.5, 3.3, 5, 9, 12, 15, 24, 30] as const;
const ISETS = [0.1, 0.2, 0.5, 1, 2, 3, 5] as const;

export interface SupplyOut {
  readonly v: number;
  readonly i: number;
  readonly mode: 'CV' | 'CC' | null;
  readonly w: number;
}

export const ohmsOf = (st: ItemState): number => {
  const load = LOADS[st.p.load as Load];
  return st.p.load === 'unknown' ? (st.s.ohms as number) : load.ohms;
};

/** The figure's `solve`: CV until the load wants more than the limit, then CC. */
export function solveSupply(p: Readonly<Record<string, Prim>>, ohms: number): SupplyOut {
  if (!p.on) return { v: 0, i: 0, mode: null, w: 0 };
  const vSet = p.vSet as number;
  const iSet = p.iSet as number;
  const want = vSet / ohms;
  if (want > iSet) return { v: iSet * ohms, i: iSet, mode: 'CC', w: iSet * iSet * ohms };
  const finite = Number.isFinite(want);
  return { v: vSet, i: finite ? want : 0, mode: 'CV', w: finite ? vSet * want : 0 };
}

const out = (st: ItemState) => solveSupply(st.p, ohmsOf(st));
const hot = (st: ItemState, o: SupplyOut) => {
  const ld = LOADS[st.p.load as Load];
  return ld.watts > 0 && o.w > ld.watts;
};

export const supply = defineItem({
  kind: 'bench-power-supply',
  lab: 'electrical',
  foot: [160, 290, 127],
  params: {
    vSet: { values: VSETS, range: [0, 30], unit: 'V' },
    iSet: { values: ISETS, range: [0, 5], unit: 'A' },
    load: { values: ['open', 'r100', 'r10', 'short', 'unknown'] },
    on: { values: [false, true] },
  },
  defaults: { vSet: 5, iSet: 0.5, load: 'r100', on: false },
  init: (_p, seed) => ({ ohms: pickSeeded(UNKNOWN_OHMS, seed, 3), sawCC: false, readings: 0, r1V: 0, r1I: 0, r2V: 0, r2I: 0 }),
  actions: {
    power: (d) => d.set('on', !d.p.on),
    // A knob: one step up (`by` 1, the default) or down; select on the knob steps it, a twist gives `value`.
    vSet: (d, a) => d.set('vSet', typeof a.value === 'number' ? nudge(supply.params.vSet!, d.p.vSet!, a.value) : cycle(supply.params.vSet!, d.p.vSet!)),
    iSet: (d, a) => d.set('iSet', typeof a.value === 'number' ? nudge(supply.params.iSet!, d.p.iSet!, a.value) : cycle(supply.params.iSet!, d.p.iSet!)),
    load: (d, a) => d.set('load', a.value ?? cycle(supply.params.load!, d.p.load!)),
    record: (d) => {
      if (!d.p.on) return 'output-off';
      const o = out(d);
      if (o.i <= 0) return 'no-current';
      // The meters as they read: volts to 2 decimals, amps to 3.
      const v = Math.round(o.v * 100) / 100;
      const i = Math.round(o.i * 1000) / 1000;
      const n = d.s.readings as number;
      if (n === 0 || (n >= 1 && d.s.r1V === v)) {
        d.s.r1V = v;
        d.s.r1I = i;
        d.s.readings = Math.max(1, n);
      } else {
        d.s.r2V = v;
        d.s.r2I = i;
        d.s.readings = 2;
      }
    },
  },
  onParam: (st) => {
    if (out(st).mode === 'CC') st.s.sawCC = true;
  },
  mistakes: ['short-high-limit', 'resistor-overload', 'limit-at-max'],
  mistake: (st) => {
    const p = st.p;
    if (!p.on) return null;
    if (p.load === 'short' && (p.iSet as number) > 1) return 'short-high-limit';
    if (hot(st, out(st))) return 'resistor-overload';
    if (p.load !== 'open' && (p.iSet as number) >= 5) return 'limit-at-max';
    return null;
  },
  report: (st) => {
    const o = out(st);
    return {
      vOut: +o.v.toFixed(2),
      iOut: +o.i.toFixed(3),
      mode: o.mode,
      pLoadW: +o.w.toFixed(1),
      loadHot: hot(st, o),
      sawCC: st.s.sawCC as boolean,
      readings: st.s.readings as number,
      r1V: st.s.r1V as number,
      r1I: st.s.r1I as number,
      r2V: st.s.r2V as number,
      r2I: st.s.r2I as number,
    };
  },
});

const TEMPS = [200, 250, 300, 330, 350, 400, 450] as const;
export const solderingStation = defineItem({
  kind: 'soldering-station',
  lab: 'electrical',
  foot: [200, 230, 130],
  params: {
    tempSet: { values: TEMPS, range: [200, 480], unit: '°C' },
    sponge: { values: ['damp', 'dry'] },
    on: { values: [false, true] },
    inHolder: { values: [true, false] },
  },
  defaults: { tempSet: 330, sponge: 'damp', on: false, inHolder: true },
  init: () => ({ tip: 22, outT: 0 }),
  actions: {
    power: (d) => d.set('on', !d.p.on),
    iron: (d) => d.set('inHolder', !d.p.inHolder),
    tempSet: (d, a) => d.set('tempSet', typeof a.value === 'number' ? nudge(solderingStation.params.tempSet!, d.p.tempSet!, a.value) : cycle(solderingStation.params.tempSet!, d.p.tempSet!)),
    sponge: (d) => d.set('sponge', d.p.sponge === 'damp' ? 'dry' : 'damp'),
  },
  onParam: (st, k) => {
    if (k === 'inHolder' || k === 'on') st.s.outT = 0;
  },
  step: ({ p, s }, dt) => {
    const target = p.on ? (p.tempSet as number) : 22;
    const tip = s.tip as number;
    s.tip = tip + (target - tip) * (1 - Math.exp(-dt / (p.on && target > tip ? 6 : 40)));
    s.outT = p.on && !p.inHolder ? (s.outT as number) + dt : 0;
  },
  live: (st) => st.p.on === true || (st.s.tip as number) > 25 || st.p.inHolder === false,
  mistakes: ['iron-left-out', 'too-hot', 'dry-sponge'],
  mistake: ({ p, s }) =>
    !p.on ? null : !p.inHolder && (s.outT as number) > 15 ? 'iron-left-out' : (p.tempSet as number) >= 400 ? 'too-hot' : p.sponge === 'dry' ? 'dry-sponge' : null,
  report: ({ p, s }) => ({ tipC: Math.round((s.tip as number) / 10) * 10, heating: !!(p.on && (s.tip as number) < (p.tempSet as number) - 3) }),
  stamp: ({ p, s }) => Math.round((s.tip as number) / 10) * 4 + (p.on && (s.tip as number) < (p.tempSet as number) - 3 ? 1 : 0) + ((s.outT as number) > 15 ? 2 : 0),
});
