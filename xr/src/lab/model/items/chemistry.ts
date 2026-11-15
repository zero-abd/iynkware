/**
 * Chemistry equipment. The beaker, the conical flask and the Bunsen burner are ported from the lab figures
 * (figures/lab/{beaker-250,erlenmeyer-250,bunsen-burner}.js on the lab-equipment branch): the same params, defaults,
 * actions, clock and mistake rules, most specific mistake first. The flame-test kit and the pH meter are new here and
 * plug in the same way (their figures are being drawn elsewhere; the ids match the coming `lab/<id>` assets).
 */
import { cycle, defineItem, pickSeeded, type ItemState, type LabEnv, type Prim } from '../types';

const VOLUMES = [0, 50, 100, 150, 200, 250, 300] as const;
export const LIQUIDS = ['water', 'copper-sulfate', 'permanganate', 'iodine', 'indicator', 'vinegar', 'soap'] as const;
export type Liquid = (typeof LIQUIDS)[number];
/** The pH a meter reads in each liquid (room temperature, the usual school-lab strengths). */
export const LIQUID_PH: Readonly<Record<Liquid, number>> = {
  water: 7.0,
  'copper-sulfate': 4.2,
  permanganate: 7.4,
  iodine: 5.5,
  indicator: 7.0,
  vinegar: 2.9,
  soap: 10.1,
};
/** The liquid's colour, for drawing. */
export const LIQUID_COLOUR: Readonly<Record<Liquid, string>> = {
  water: '#cfe6f2',
  'copper-sulfate': '#3f8fd6',
  permanganate: '#8e2f8f',
  iodine: '#b5651d',
  indicator: '#7fbf5a',
  vinegar: '#f1ead2',
  soap: '#e7e0f0',
};

/** The level eases to the new volume (a pour, not a jump): +120 mL/s filling, -240 mL/s emptying. */
function ease(s: Record<string, Prim>, target: number, dt: number): void {
  const vol = s.vol as number;
  if (vol === target) return;
  s.vol = target > vol ? Math.min(target, vol + 120 * dt) : Math.max(target, vol - 240 * dt);
}

export const beaker = defineItem({
  kind: 'beaker-250',
  lab: 'chemistry',
  foot: [80, 80, 95],
  params: {
    liquid: { values: LIQUIDS },
    volume: { values: VOLUMES, range: [0, 330], unit: 'mL' },
    heat: { values: [false, true] },
  },
  defaults: { liquid: 'copper-sulfate', volume: 150, heat: false },
  init: (p) => ({ vol: p.volume as number, temp: 20 }),
  actions: {
    fill: (d) => {
      if ((d.p.volume as number) >= 300) return 'beaker-full';
      d.set('volume', Math.min(300, (d.p.volume as number) + 50));
    },
    empty: (d) => d.set('volume', 0),
    heat: (d) => d.set('heat', !d.p.heat),
    liquid: (d, a) => d.set('liquid', a.value ?? cycle(beaker.params.liquid!, d.p.liquid!)),
  },
  step: (st, dt) => {
    const { p, s } = st;
    ease(s, p.volume as number, dt);
    const temp = s.temp as number;
    if (p.heat) s.temp = Math.min((p.volume as number) > 0 ? 100 : 250, temp + (600 / ((p.volume as number) + 20)) * dt);
    else s.temp = Math.max(20, temp - (temp - 20) * 0.03 * dt - 0.05 * dt);
  },
  live: (st) => st.s.vol !== st.p.volume || st.p.heat === true || (st.s.temp as number) > 20.5,
  mistakes: ['heating-empty', 'heating-too-full', 'overfilled'],
  mistake: ({ p }) =>
    p.heat && p.volume === 0 ? 'heating-empty' : p.heat && (p.volume as number) > 150 ? 'heating-too-full' : (p.volume as number) > 250 ? 'overfilled' : null,
  report: ({ p, s }) => ({ tempC: Math.round((s.temp as number) / 5) * 5, boiling: !!(p.heat && (p.volume as number) > 0 && (s.temp as number) >= 99.5) }),
  stamp: ({ p, s }) => Math.round((s.temp as number) / 5) * 2 + (p.heat && (s.temp as number) >= 99.5 ? 1 : 0),
});

const SWIRL_S = 3;
export const flask = defineItem({
  kind: 'erlenmeyer-250',
  lab: 'chemistry',
  foot: [91, 91, 145],
  params: {
    liquid: { values: LIQUIDS },
    volume: { values: VOLUMES, range: [0, 337], unit: 'mL' },
    swirling: { values: [false, true] },
  },
  defaults: { liquid: 'indicator', volume: 100, swirling: false },
  init: (p) => ({ vol: p.volume as number, swirlT: 0 }),
  actions: {
    fill: (d) => {
      if ((d.p.volume as number) >= 300) return 'flask-full';
      d.set('volume', Math.min(300, (d.p.volume as number) + 50));
    },
    empty: (d) => d.set('volume', 0),
    swirl: (d) => {
      if (!d.p.volume) return 'flask-empty';
      d.set('swirling', true);
    },
  },
  onParam: (st, k, v) => {
    if (k === 'swirling') st.s.swirlT = v ? SWIRL_S : 0;
  },
  step: (st, dt, _env, set) => {
    ease(st.s, st.p.volume as number, dt);
    const t = st.s.swirlT as number;
    if (t > 0) {
      st.s.swirlT = Math.max(0, t - dt);
      if (st.s.swirlT === 0) set('swirling', false);
    }
  },
  live: (st) => st.s.vol !== st.p.volume || (st.s.swirlT as number) > 0,
  mistakes: ['swirl-too-full', 'overfilled'],
  mistake: ({ p }) => (p.swirling && (p.volume as number) > 150 ? 'swirl-too-full' : (p.volume as number) > 250 ? 'overfilled' : null),
});

/** The burner's flame for each collar setting (the figure's FLAMES): its kind, colour and height in mm. */
export const FLAMES = {
  closed: { kind: 'luminous', colour: '#f6b73c', heightMm: 105 },
  half: { kind: 'blue', colour: '#8d93e6', heightMm: 82 },
  open: { kind: 'roaring', colour: '#7a86ea', heightMm: 66 },
} as const;
export type Collar = keyof typeof FLAMES;

export const burner = defineItem({
  kind: 'bunsen-burner',
  lab: 'chemistry',
  foot: [205, 92, 260],
  params: {
    collar: { values: ['closed', 'half', 'open'] },
    gasOn: { values: [false, true] },
    lit: { values: [false, true] },
  },
  defaults: { collar: 'closed', gasOn: false, lit: false },
  init: () => ({ gasT: 0, blueT: 0, badLight: false }),
  refuse: (next, key, value) => (key === 'lit' && value === true && !next.gasOn ? 'no-gas' : null),
  actions: {
    gas: (d) => d.set('gasOn', !d.p.gasOn),
    collar: (d, a) => d.set('collar', a.value ?? cycle(burner.params.collar!, d.p.collar!)),
    light: (d) => {
      if (!d.p.gasOn) return 'no-gas';
      if (d.p.lit) return 'already-lit';
      if (d.p.collar === 'open') {
        // The figure's failed light: the flame lifts off; the action happens (the tutor sees it) but nothing lights.
        d.s.badLight = true;
        return;
      }
      d.s.badLight = false;
      d.set('lit', true);
    },
  },
  onParam: (st, k, v) => {
    if (k === 'gasOn' && !v) {
      st.p.lit = false;
      st.s.badLight = false;
      st.s.gasT = 0;
    }
    if ((k === 'lit' && v) || k === 'collar') st.s.badLight = false;
    if (k === 'collar' || k === 'lit') st.s.blueT = 0;
  },
  step: ({ p, s }, dt) => {
    s.gasT = p.gasOn && !p.lit ? (s.gasT as number) + dt : 0;
    s.blueT = p.lit && p.collar === 'open' ? (s.blueT as number) + dt : 0;
  },
  live: (st) => st.p.gasOn === true,
  mistakes: ['light-collar-open', 'gas-unlit', 'blue-flame-idle'],
  mistake: ({ p, s }) =>
    s.badLight && p.gasOn && !p.lit
      ? 'light-collar-open'
      : p.gasOn && !p.lit && (s.gasT as number) > 2
        ? 'gas-unlit'
        : p.lit && p.collar === 'open' && (s.blueT as number) > 20
          ? 'blue-flame-idle'
          : null,
  report: ({ p, s }) => ({ flame: p.lit ? FLAMES[p.collar as Collar].kind : 'none', gasUnlitS: Math.floor(s.gasT as number) }),
  // gas-unlit and blue-flame-idle start on the clock: whole seconds of each, so the store hears when they begin.
  stamp: ({ s }) => Math.floor(s.gasT as number) * 1000 + Math.min(999, Math.floor(s.blueT as number)),
});

/* ---------- flame-test kit ---------- */

/** The salts on the tray, as their metal, and the colour each gives a blue flame. */
export const SALTS = ['Li', 'Na', 'K', 'Ca', 'Cu', 'Sr', 'Ba'] as const;
export type Salt = (typeof SALTS)[number];
export const FLAME_COLOUR: Readonly<Record<Salt, { readonly name: string; readonly hex: string }>> = {
  Li: { name: 'crimson', hex: '#d8143a' },
  Na: { name: 'yellow-orange', hex: '#ffb11a' },
  K: { name: 'lilac', hex: '#c58fe6' },
  Ca: { name: 'orange-red', hex: '#f0552a' },
  Cu: { name: 'blue-green', hex: '#1fbf9a' },
  Sr: { name: 'red', hex: '#f0202a' },
  Ba: { name: 'pale-green', hex: '#b4e36a' },
};
/** What the person sees in the flame: a metal's colour, `none` (a clean loop), `masked` (a yellow flame hides it). */
export type FlameSeen = Salt | 'none' | 'masked' | 'mixed' | 'off';
/** Seconds in a hot flame that burn a wet (acid-dipped) loop clean. */
export const CLEAN_S = 1.5;
/** Seconds in the flame before a salt's colour shows. */
export const COLOUR_S = 0.6;

const DISHES = [...SALTS, 'unknown'] as const;

/** The burner's flame as the kit sees it, through `env`. */
function flameOf(env: LabEnv): 'off' | 'luminous' | 'hot' {
  const b = env.stateOf('bunsen-burner');
  if (!b || !b.p.lit) return 'off';
  return b.p.collar === 'closed' ? 'luminous' : 'hot';
}

/** What the flame shows with the loop in it now. */
export function flameSeen(st: ItemState, env: LabEnv): FlameSeen {
  if (st.p.held !== 'flame') return 'off';
  const flame = flameOf(env);
  if (flame === 'off') return 'off';
  const coat = st.s.coat as Salt | 'none';
  if (coat === 'none' || (st.s.flameT as number) < COLOUR_S) return 'none';
  if (flame === 'luminous') return 'masked';
  // A loop dipped without cleaning carries the last salt too, and sodium's yellow swamps everything.
  return st.s.mixed ? 'mixed' : coat;
}

export const flameTestKit = defineItem({
  kind: 'flame-test-kit',
  lab: 'chemistry',
  foot: [240, 140, 40],
  params: {
    /** Where the nichrome loop is. */
    held: { values: ['rack', 'acid', 'salt', 'flame'] },
    /** The dish the loop goes into next (and was last dipped in). */
    dish: { values: DISHES },
  },
  defaults: { held: 'rack', dish: 'unknown' },
  init: (_p, seed) => ({
    coat: 'none',
    from: 'none',
    mixed: false,
    clean: false,
    wet: false,
    flameT: 0,
    dirtyDip: false,
    unknown: pickSeeded(SALTS, seed, 11),
    seen: 'off',
    seenUnknown: false,
    cleanedOnce: false,
  }),
  actions: {
    'dip-acid': (d) => {
      d.s.wet = true;
      d.s.flameT = 0;
      d.set('held', 'acid');
    },
    'dip-salt': (d, a) => {
      const dish = (a.value as string | undefined) ?? (d.p.dish as string);
      if (!DISHES.includes(dish as (typeof DISHES)[number])) return 'bad-value';
      const salt = (dish === 'unknown' ? d.s.unknown : dish) as Salt;
      const coat = d.s.coat as string;
      d.s.dirtyDip = !d.s.clean;
      d.s.mixed = !d.s.clean && coat !== 'none' && coat !== salt;
      d.s.coat = salt;
      d.s.from = dish;
      d.s.clean = false;
      d.s.wet = false;
      d.s.flameT = 0;
      d.set('dish', dish);
      d.set('held', 'salt');
    },
    'to-flame': (d, _a, env) => {
      if (!env.stateOf('bunsen-burner')) return 'no-burner';
      d.s.flameT = 0;
      d.set('held', 'flame');
    },
    'to-rack': (d) => d.set('held', 'rack'),
  },
  step: (st, dt, env) => {
    const { p, s } = st;
    if (p.held !== 'flame') return;
    const flame = flameOf(env);
    if (flame === 'off') {
      s.flameT = 0;
      return;
    }
    s.flameT = (s.flameT as number) + dt;
    if (s.wet && flame === 'hot' && (s.flameT as number) >= CLEAN_S) {
      s.wet = false;
      s.coat = 'none';
      s.from = 'none';
      s.mixed = false;
      s.clean = true;
      s.cleanedOnce = true;
      s.dirtyDip = false;
    }
    const seen = flameSeen(st, env);
    s.seen = seen;
    if (s.from === 'unknown' && seen !== 'none' && seen !== 'off' && seen !== 'masked') s.seenUnknown = true;
  },
  live: (st) => st.p.held === 'flame',
  mistakes: ['loop-no-flame', 'luminous-flame', 'dirty-loop'],
  mistake: (st, env) => {
    const { p, s } = st;
    if (p.held === 'flame') {
      const flame = flameOf(env);
      if (flame === 'off') return 'loop-no-flame';
      if (flame === 'luminous') return 'luminous-flame';
    }
    if (s.dirtyDip && s.coat !== 'none' && p.held !== 'rack') return 'dirty-loop';
    return null;
  },
  report: (st, env) => {
    const seen = flameSeen(st, env);
    return {
      coat: st.s.from === 'unknown' ? 'unknown' : (st.s.coat as string),
      clean: st.s.clean as boolean,
      wet: st.s.wet as boolean,
      flameColour: seen === 'mixed' ? FLAME_COLOUR.Na.name : SALTS.includes(seen as Salt) ? FLAME_COLOUR[seen as Salt].name : seen,
      seen,
      seenUnknown: st.s.seenUnknown as boolean,
    };
  },
  stamp: (st, env) => {
    const seen = flameSeen(st, env);
    return (st.s.clean ? 1 : 0) + (st.s.wet ? 2 : 0) + (st.s.seenUnknown ? 4 : 0) + 8 * (['off', 'none', 'masked', 'mixed', ...SALTS] as string[]).indexOf(seen);
  },
});

/* ---------- pH meter ---------- */

/** Where the pH probe is: its storage cap, the rinse water, the pH 7 buffer, or the sample in the beaker. */
export const PROBE_AT = ['stored', 'rinse', 'buffer', 'sample'] as const;
/** How far an uncalibrated meter is off, by seed, in pH. */
const OFFSETS = [0.6, -0.7, 0.9, -0.5] as const;
/** How much a probe that was not rinsed drags its last solution into the next reading. */
const CARRY = 0.35;

/** The pH of what the probe is in, or null in its storage cap. */
function truePh(where: Prim, env: LabEnv): number | null {
  if (where === 'rinse') return 7.0;
  if (where === 'buffer') return 7.0;
  if (where !== 'sample') return null;
  const b = env.stateOf('beaker-250') ?? env.stateOf('erlenmeyer-250');
  if (!b || !b.p.volume) return null;
  return LIQUID_PH[b.p.liquid as Liquid] ?? 7;
}

export function phReading(st: ItemState, env: LabEnv): number | null {
  const t = truePh(st.p.probe!, env);
  if (t === null || !st.p.on) return null;
  const offset = st.s.calibrated ? 0 : (st.s.offset as number);
  const carried = st.s.rinsed ? 0 : CARRY * ((st.s.lastPh as number) - t);
  return Math.round((t + offset + carried) * 10) / 10;
}

export const phMeter = defineItem({
  kind: 'ph-meter',
  lab: 'chemistry',
  foot: [110, 160, 60],
  params: {
    probe: { values: PROBE_AT },
    on: { values: [false, true] },
  },
  defaults: { probe: 'stored', on: false },
  init: (_p, seed) => ({ calibrated: false, rinsed: true, lastPh: 7, offset: pickSeeded(OFFSETS, seed, 5), dirtyDip: false, uncalDip: false }),
  actions: {
    power: (d) => d.set('on', !d.p.on),
    calibrate: (d) => {
      if (!d.p.on) return 'meter-off';
      if (d.p.probe !== 'buffer') return 'calibrate-in-buffer';
      d.s.calibrated = true;
    },
    probe: (d, a, env) => {
      const to = (a.value as string | undefined) ?? (cycle(phMeter.params.probe!, d.p.probe!) as string);
      if (!PROBE_AT.includes(to as (typeof PROBE_AT)[number])) return 'bad-value';
      if (to === 'sample' && truePh('sample', env) === null) return 'no-sample';
      const from = d.p.probe!;
      // Going straight from one solution to the next, without the rinse water in between, carries some of it along.
      if (to === 'rinse') d.s.rinsed = true;
      else if ((from === 'buffer' || from === 'sample') && to !== from) {
        d.s.rinsed = false;
        d.s.lastPh = truePh(from, env) ?? 7;
      }
      d.s.dirtyDip = to === 'sample' && !d.s.rinsed;
      d.s.uncalDip = to === 'sample' && !d.s.calibrated;
      d.set('probe', to);
    },
  },
  mistakes: ['ph-not-rinsed', 'ph-not-calibrated'],
  mistake: ({ p, s }) => (p.probe === 'sample' && s.dirtyDip ? 'ph-not-rinsed' : p.probe === 'sample' && s.uncalDip ? 'ph-not-calibrated' : null),
  report: (st, env) => ({ reading: phReading(st, env), calibrated: st.s.calibrated as boolean, rinsed: st.s.rinsed as boolean }),
});
