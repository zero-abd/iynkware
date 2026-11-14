/**
 * The drone bench as a pure reducer: the figure engine's build flow and bench tests (`SD.actions`, `place`,
 * `finishTest` and `report` in `figures/engine/drone.js`), ported rule for rule and in the same order, with the timed
 * tests finishing at once (the room animates them). New here: the motors' phase leads. When the motor wires go on, the
 * figure's wrong motor has two leads crossed and spins the wrong way; `cross` swaps a motor's leads back (or wrong);
 * the motor test reverses each wrong motor in the ESC configurator, as the figure does.
 *
 * Not ported: a craft's own `reset`, `report` and bench buttons (the failsafe test and the like), the exploded view,
 * selection, sounds and timing.
 */
import type { DesignPick } from '@/content/schema';
import type { FlightReadiness } from '@/lib/dronelab/figure';
import type { BenchAction, BenchCraft, BenchMessage, BenchReport, BenchResult, BenchState, MessageVar } from './types';

export const EMPTY_BENCH: BenchState = {
  placed: {},
  plugged: false,
  fault: null,
  smokeOk: false,
  motorOk: false,
  accOk: false,
  wireJobs: 0,
  crossed: [],
  escReversed: [],
  wrongMotor: null,
};

const DEFAULT_MISTAKE: Readonly<Record<string, string>> = { FC: 'fc-reversed', XT60: 'cap-reversed', PROPS: 'props-swapped' };

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] extends Readonly<Record<string, infer V>> ? Record<string, V> : T[K] };

/** The figure's wrong motor for the next wire job. */
export function wrongIndex(craft: BenchCraft, wireJobs: number): number | null {
  const n = craft.motors.length;
  return n ? (2 + 3 * wireJobs) % n : null;
}

/** Motors that spin the wrong way: crossed leads not undone in the ESC (or straight leads reversed there). */
export function wrongMotors(craft: BenchCraft, st: BenchState): string[] {
  return craft.motors.map((m) => m.id).filter((id) => st.crossed.includes(id) !== st.escReversed.includes(id));
}

/** Pack voltage when full, for the plug-in log line. */
function packVolts(craft: BenchCraft, pick: DesignPick | null, cells: number): number {
  const hv = pick !== null && (craft.hvBatts ?? []).includes(pick.batt);
  return +(cells * (hv ? 4.35 : 4.2)).toFixed(2);
}

export interface BenchContext {
  readonly craft: BenchCraft;
  /** The design pick and its battery's cell count, for the plug-in line. */
  readonly pick?: DesignPick | null;
  readonly cells?: number;
}

/** Applies one bench action. Pure: returns the next state and what the bench said and logged. */
export function applyBench(state: BenchState, action: BenchAction, ctx: BenchContext): BenchResult {
  const { craft } = ctx;
  const st: Mutable<BenchState> = { ...state, placed: { ...state.placed }, crossed: [...state.crossed], escReversed: [...state.escReversed] };
  const messages: BenchMessage[] = [];
  const say = (key: string, vars?: Record<string, MessageVar>) => void messages.push(vars ? { kind: 'say', key, vars } : { kind: 'say', key });
  const log = (key: string, vars?: Record<string, MessageVar>) => void messages.push(vars ? { kind: 'log', key, vars } : { kind: 'log', key });
  const done = (): BenchResult => ({ state: st, messages });

  const byId = (id: string) => craft.parts.find((p) => p.id === id);
  const has = (id: string) => byId(id) !== undefined;
  const inPl = (id: string) => Object.hasOwn(st.placed, id);
  const orient = (id: string) => (inPl(id) ? st.placed[id] : 0);
  const part = (id: string, lower = false): MessageVar => (lower ? { part: id, lower } : { part: id });
  const motorIds = craft.motors.map((m) => m.id);
  const tests = craft.tests;
  const clearWires = () => {
    st.crossed = [];
    st.escReversed = [];
  };

  const place = (id: string, o: 0 | 1, auto = false) => {
    st.placed[id] = o;
    if (id === 'XT60') {
      if (st.fault) {
        st.fault = null;
        log('capNew');
      }
      if (!auto) st.smokeOk = false;
    }
    if (id === 'WIRES') {
      if (!auto) {
        st.motorOk = false;
        const w = wrongIndex(craft, st.wireJobs);
        st.crossed = w === null ? [] : [motorIds[w]];
        st.escReversed = [];
      }
      st.wireJobs++;
    }
    if (id === 'FC' && !auto) st.accOk = false;
  };
  const takeOff = (id: string) => {
    delete st.placed[id];
    if (id === 'XT60') st.smokeOk = false;
    if (id === 'WIRES') {
      st.motorOk = false;
      clearWires();
    }
    if (id === 'FC') st.accOk = false;
  };
  const unplug = (silent: boolean) => {
    if (!st.plugged) return;
    st.plugged = false;
    if (!silent) {
      log('unplugged');
      say('unplugged');
    }
  };
  const plugIn = () => {
    if (st.plugged) return;
    const needs = tests.plug ?? ['BATT', 'XT60'];
    if (!needs.every((id) => !has(id) || inPl(id))) return say('plugNeeds');
    if (st.fault) return say('faultFix');
    st.plugged = true;
    log('plugged', { v: packVolts(craft, ctx.pick ?? null, ctx.cells ?? 0) });
    if (has('XT60') && orient('XT60') === 1 && !st.smokeOk) {
      st.fault = 'XT60';
      log('pop');
      say('pop');
    } else say('powered');
  };

  switch (action.type) {
    case 'add': {
      const p = byId(action.part);
      if (!p) return done();
      const o: 0 | 1 = p.polar && action.orient === 1 ? 1 : 0;
      if (st.plugged && p.id !== 'BATT') return say('live'), done();
      if (inPl(p.id)) {
        if (!p.polar || orient(p.id) === o) return say('already', { short: part(p.id) }), done();
        st.placed[p.id] = o;
        if (p.id === 'XT60') {
          st.smokeOk = false;
          if (st.fault) {
            st.fault = null;
            log('capNew');
          }
        }
        if (p.id === 'FC') st.accOk = false;
        return done();
      }
      const miss = p.after.find((a) => !inPl(a));
      if (miss) return say('after', { short: part(p.id), need: part(miss, true) }), done();
      if (p.id === 'PROPS' && ((tests.smoke && !st.smokeOk) || (tests.motors && motorIds.length && !st.motorOk))) return say('propsLast'), done();
      place(p.id, o);
      return done();
    }
    case 'remove': {
      const p = byId(action.part);
      if (!p) return done();
      if (st.plugged) return say('live'), done();
      if (!inPl(p.id)) return say('notOn', { short: part(p.id) }), done();
      const dep = craft.parts.find((q) => inPl(q.id) && q.after.includes(p.id));
      if (dep) return say('takeOff', { dep: part(dep.id, true) }), done();
      if (p.id === 'XT60') {
        st.fault = null;
      }
      takeOff(p.id);
      say('off', { short: part(p.id) });
      return done();
    }
    case 'build': {
      unplug(true);
      let changed = false;
      for (const p of craft.parts)
        if (inPl(p.id) && st.placed[p.id] === 1) {
          st.placed[p.id] = 0;
          changed = true;
        }
      if (st.fault) {
        st.fault = null;
        log('capNew');
        changed = true;
      }
      const missing = craft.parts.filter((p) => !inPl(p.id)).map((p) => p.id);
      const props = missing.indexOf('PROPS');
      if (props >= 0) missing.push(...missing.splice(props, 1));
      const checks =
        (!tests.smoke || st.smokeOk) && (!tests.motors || !motorIds.length || st.motorOk) && (!tests.calibrate || !has('FC') || st.accOk);
      if (!missing.length && !changed && checks) return say('built'), done();
      st.smokeOk = true;
      st.motorOk = true;
      st.accOk = true;
      clearWires();
      log('auto');
      for (const id of missing) place(id, 0, true);
      say('buildDone');
      return done();
    }
    case 'strip': {
      if (!craft.parts.some((p) => inPl(p.id))) return say('box'), done();
      unplug(true);
      st.fault = null;
      st.placed = {};
      st.smokeOk = st.motorOk = st.accOk = false;
      clearWires();
      return done();
    }
    case 'plug':
      if (st.plugged) unplug(false);
      else plugIn();
      return done();
    case 'plugIn':
      plugIn();
      return done();
    case 'unplug':
      unplug(false);
      return done();
    case 'smoke': {
      const needs = tests.smoke;
      if (!needs) return say('noMotors'), done();
      if (!needs.every(inPl)) return say('smokeNeeds'), done();
      if (st.fault) return say('faultFix'), done();
      unplug(true);
      log('smoke');
      if (has('XT60') && orient('XT60') === 1) {
        log('smokeShort');
        say('smokeShort');
      } else {
        st.smokeOk = true;
        log('smokeOk');
        say('smokeOk');
      }
      return done();
    }
    case 'motors': {
      const needs = tests.motors;
      if (!needs || !motorIds.length) return say('noMotors'), done();
      if (!needs.every(inPl)) return say('motorNeeds'), done();
      if (has('PROPS') && inPl('PROPS')) return say('propsOff'), done();
      if (!st.plugged) {
        if (has('BATT') && !inPl('BATT')) return say('needBatt'), done();
        plugIn();
        if (!st.plugged || st.fault) return done();
      }
      log('motors', { list: motorIds.join(', ') });
      const wrong = st.motorOk ? [] : wrongMotors(craft, st);
      for (const m of wrong) {
        st.escReversed = st.escReversed.includes(m) ? st.escReversed.filter((x) => x !== m) : [...st.escReversed, m];
        log('reversed', { m });
      }
      st.motorOk = true;
      if (wrong.length) {
        st.wrongMotor = wrong[wrong.length - 1];
        say('motorWrong', { m: wrong.join(', ') });
      } else say('motorsOk');
      return done();
    }
    case 'calibrate': {
      const needs = tests.calibrate ?? ['FC'];
      if (!needs.every(inPl)) return say('calNeeds'), done();
      st.accOk = true;
      if (orient('FC') === 1) {
        log('calBack');
        say('calBack');
      } else {
        log('calOk');
        say('calOk');
      }
      return done();
    }
    case 'step': {
      unplug(true);
      craft.parts.forEach((p, i) => {
        const want = i < action.n;
        if (want && !inPl(p.id)) place(p.id, 0);
        else if (want && st.placed[p.id] === 1) {
          st.placed[p.id] = 0;
          if (p.id === 'XT60') st.smokeOk = false;
          if (p.id === 'FC') st.accOk = false;
        } else if (!want && inPl(p.id)) takeOff(p.id);
      });
      if (action.n === 0) st.fault = null;
      return done();
    }
    case 'cross': {
      if (!motorIds.includes(action.motor)) return done();
      if (st.plugged) return say('live'), done();
      if (has('WIRES') && !inPl('WIRES')) return say('notOn', { short: part('WIRES') }), done();
      st.crossed = st.crossed.includes(action.motor) ? st.crossed.filter((m) => m !== action.motor) : [...st.crossed, action.motor];
      st.motorOk = false;
      return done();
    }
  }
}

/** The figure's report for a bench state: what `armingRules` and `canArm` read. */
export function benchReport(craft: BenchCraft, st: BenchState): BenchReport {
  const placed: Record<string, 0 | 1> = {};
  for (const p of craft.parts) if (Object.hasOwn(st.placed, p.id)) placed[p.id] = st.placed[p.id];
  const fitted = Object.keys(placed).length, total = craft.parts.length;
  const next = craft.parts.find((p) => !Object.hasOwn(placed, p.id))?.id ?? null;
  const mistakes = craft.parts
    .filter((p) => p.polar && placed[p.id] === 1)
    .map((p) => p.mistake ?? DEFAULT_MISTAKE[p.id] ?? `${p.id.toLowerCase()}-reversed`);
  const hasFc = craft.parts.some((p) => p.id === 'FC');
  const smokeTested = !craft.tests.smoke || st.smokeOk;
  const motorChecked = !craft.tests.motors || !craft.motors.length || st.motorOk;
  const accCal = !hasFc || st.accOk;
  const built = fitted === total;
  const flight: FlightReadiness = {
    ready: built && !st.fault && smokeTested && motorChecked && accCal,
    fcReversed: placed.FC === 1,
    propsSwapped: placed.PROPS === 1,
    motorChecked,
    accCal,
    capFault: st.fault === 'XT60',
    smokeTested,
    mistakes,
  };
  return {
    craft: craft.id,
    fitted,
    total,
    placed,
    next,
    built,
    plugged: st.plugged,
    powered: st.plugged && !st.fault && (!hasFc || Object.hasOwn(placed, 'FC')),
    fault: st.fault,
    smokeOk: st.smokeOk,
    motorOk: st.motorOk,
    accOk: st.accOk,
    wrongMotor: st.wrongMotor,
    wrongMotors: wrongMotors(craft, st),
    flight,
  };
}
