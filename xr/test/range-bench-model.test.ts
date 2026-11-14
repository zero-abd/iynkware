/** The drone bench model on quad5: build order, bench tests, phase wiring, readiness, design, document, text. */
import { describe, expect, it } from 'vitest';
import quad5 from '@/content/drones/quad5';
import { canArm } from '@/lib/dronelab/bench';
import { LANGS } from '../src/contracts/common';
import { createProjectStore, createTemplateSource } from '../src/project/store';
import {
  applyBench,
  BENCH_CRAFTS,
  BENCH_LOG,
  BENCH_MSG,
  benchArmRules,
  benchCalc,
  benchFaults,
  benchCraft,
  benchOf,
  benchOps,
  benchReport,
  benchText,
  designView,
  EMPTY_BENCH,
  englishOf,
  loadFigureText,
  pickOf,
  pickOp,
  type BenchAction,
  type BenchMessage,
  type BenchState,
} from '../src/range/flight/model';

const craft = benchCraft('quad5')!;
const pick = quad5.design.default;
const ctx = { craft, pick, cells: quad5.design.batts[pick.batt].cells };

/** Applies actions in turn; returns the last state and every message. */
function run(actions: BenchAction[], from: BenchState = EMPTY_BENCH) {
  let state = from;
  const said: BenchMessage[] = [];
  for (const a of actions) {
    const r = applyBench(state, a, ctx);
    state = r.state;
    said.push(...r.messages);
  }
  return { state, said, last: said.filter((m) => m.kind === 'say').pop() };
}
const add = (part: string, orient: 0 | 1 = 0): BenchAction => ({ type: 'add', part, orient });
const ORDER = craft.parts.map((p) => p.id); // FRAME MOTORS ESC WIRES FC XT60 CAM RX VTX TOP BATT PROPS
const allBut = (skip: string[], flip: string[] = []) => ORDER.filter((id) => id !== 'PROPS' && !skip.includes(id)).map((id) => add(id, flip.includes(id) ? 1 : 0));
const tests: BenchAction[] = [{ type: 'smoke' }, { type: 'motors' }, { type: 'unplug' }, { type: 'calibrate' }];
const arms = (st: BenchState) => canArm(benchArmRules(quad5, benchReport(craft, st), pick));
const blocked = (st: BenchState) => benchArmRules(quad5, benchReport(craft, st), pick).filter((r) => r.level === 'block' && !r.ok).map((r) => r.id);

describe('assembly in build order', () => {
  it('refuses a part before the ones it goes on after, and props before the tests', () => {
    expect(run([add('MOTORS')]).last).toEqual({ kind: 'say', key: 'after', vars: { short: { part: 'MOTORS' }, need: { part: 'FRAME', lower: true } } });
    const r = run(allBut([]));
    expect(Object.keys(r.state.placed)).toHaveLength(11);
    expect(run([add('PROPS')], r.state).last?.key).toBe('propsLast');
    expect(benchReport(craft, r.state)).toMatchObject({ fitted: 11, total: 12, next: 'PROPS', built: false });
  });

  it('never works on a live quad, takes dependants off first, and says what is on or off', () => {
    const r = run([...allBut([]), { type: 'plugIn' }]);
    expect(r.state.plugged).toBe(true);
    expect(run([add('PROPS')], r.state).last?.key).toBe('live');
    expect(run([{ type: 'remove', part: 'CAM' }], r.state).last?.key).toBe('live');
    const off = run([{ type: 'unplug' }, { type: 'remove', part: 'FC' }], r.state);
    expect(off.last).toEqual({ kind: 'say', key: 'takeOff', vars: { dep: { part: 'RX', lower: true } } });
    expect(run([{ type: 'remove', part: 'BATT' }], off.state).last?.key).toBe('off');
    expect(run([add('FRAME')], off.state).last?.key).toBe('already');
  });

  it('builds it for me, props last, the checks marked passed; strips it back to a box', () => {
    const r = run([add('FRAME', 0), add('MOTORS'), add('ESC'), add('FC', 1), { type: 'build' }]);
    expect(benchReport(craft, r.state)).toMatchObject({ built: true, fitted: 12, placed: { FC: 0 } });
    expect(r.said.map((m) => m.key)).toEqual(['auto', 'buildDone']);
    expect(arms(r.state)).toBe(true);
    expect(run([{ type: 'build' }], r.state).last?.key).toBe('built');
    const s = run([{ type: 'strip' }], r.state);
    expect(s.state.placed).toEqual({});
    expect(run([{ type: 'strip' }], s.state).last?.key).toBe('box');
  });
});

describe('the bench tests and what the flight gets', () => {
  it('a correct build with every test run arms, with no faults', () => {
    const r = run([...allBut([]), ...tests, add('PROPS')]);
    expect(r.said.filter((m) => m.kind === 'say').map((m) => m.key)).toEqual(['smokeOk', 'powered', 'motorWrong', 'unplugged', 'calOk']);
    expect(benchReport(craft, r.state)).toMatchObject({ built: true, flight: { ready: true }, wrongMotors: [] });
    expect(arms(r.state)).toBe(true);
    expect(benchFaults(quad5, benchReport(craft, r.state), pick)).toMatchObject({ fcReversed: false, propsSwapped: false, motorDirUnchecked: false, accUncalibrated: false });
  });

  it('a reversed capacitor: the smoke stopper shorts; plugged in untested it pops and blocks arming', () => {
    const smoke = run([...allBut([], ['XT60']), { type: 'smoke' }]);
    expect(smoke.last?.key).toBe('smokeShort');
    expect(smoke.state.smokeOk).toBe(false);
    const pop = run([...allBut([], ['XT60']), { type: 'plugIn' }]);
    expect(pop.last?.key).toBe('pop');
    expect(pop.state.fault).toBe('XT60');
    const built = run([{ type: 'unplug' }, { type: 'motors' }, add('PROPS')], pop.state);
    expect(built.said.find((m) => m.kind === 'say' && m.key === 'faultFix')).toBeTruthy();
    const report = benchReport(craft, run([{ type: 'unplug' }], pop.state).state);
    expect(report.flight.capFault).toBe(true);
    expect(blocked(run([{ type: 'unplug' }], pop.state).state)).toContain('capFault');
    // re-seating the capacitor the right way round fits a new one
    const fixed = run([{ type: 'unplug' }, add('XT60', 0)], pop.state);
    expect(fixed.state.fault).toBeNull();
    expect(fixed.said.some((m) => m.key === 'capNew')).toBe(true);
  });

  it('the motor test finds the crossed motor and reverses it in the ESC; crossing the leads back fixes it too', () => {
    const wired = run(allBut([]));
    expect(wired.state.crossed).toEqual(['M3']); // the figure's wrong motor: (2 + 3 x 0) % 4
    expect(benchReport(craft, wired.state).wrongMotors).toEqual(['M3']);
    const esc = run([{ type: 'motors' }], wired.state);
    expect(esc.last).toEqual({ kind: 'say', key: 'motorWrong', vars: { m: 'M3' } });
    expect(esc.state).toMatchObject({ motorOk: true, escReversed: ['M3'], wrongMotor: 'M3' });
    expect(benchReport(craft, esc.state).wrongMotors).toEqual([]);
    const wire = run([{ type: 'cross', motor: 'M3' }, { type: 'motors' }], wired.state);
    expect(wire.last?.key).toBe('motorsOk');
    expect(wire.state.escReversed).toEqual([]);
    // crossing a lead after the test clears it: arming refuses until the test runs again
    const done = run([{ type: 'unplug' }, { type: 'smoke' }, { type: 'calibrate' }, { type: 'cross', motor: 'M1' }, add('PROPS')], esc.state);
    expect(done.last?.key).toBe('propsLast');
    const noTest = run([{ type: 'smoke' }, { type: 'calibrate' }, { type: 'build' }], run([{ type: 'unplug' }, { type: 'cross', motor: 'M1' }], esc.state).state);
    expect(noTest.state.motorOk).toBe(true); // Build it for me rewires it straight
    expect(run([{ type: 'cross', motor: 'M1' }], wired.state).state.motorOk).toBe(false);
    expect(run([{ type: 'plugIn' }, { type: 'cross', motor: 'M1' }], wired.state).last?.key).toBe('live');
  });

  it('skipping the calibration blocks with acc; a reversed FC calibrates backwards, arms, and flies with fcReversed', () => {
    const skip = run([...allBut([]), { type: 'smoke' }, { type: 'motors' }, { type: 'unplug' }, add('PROPS')]);
    expect(blocked(skip.state)).toEqual(['acc']);
    expect(benchFaults(quad5, benchReport(craft, skip.state), pick).accUncalibrated).toBe(true);
    const back = run([...allBut([], ['FC']), ...tests, add('PROPS')]);
    expect(back.said.some((m) => m.key === 'calBack')).toBe(true);
    expect(arms(back.state)).toBe(true);
    expect(benchFaults(quad5, benchReport(craft, back.state), pick).fcReversed).toBe(true);
    // re-seating the FC clears its calibration
    expect(run([add('FC', 0)], run([{ type: 'remove', part: 'PROPS' }], back.state).state).state.accOk).toBe(false);
  });

  it('props swapped arms and flies with propsSwapped; Break it can force a fault on', () => {
    const r = run([...allBut([]), ...tests, add('PROPS', 1)]);
    const report = benchReport(craft, r.state);
    expect(report.flight.propsSwapped).toBe(true);
    expect(report.flight.mistakes).toEqual(['props-swapped']);
    expect(arms(r.state)).toBe(true);
    expect(benchFaults(quad5, report, pick).propsSwapped).toBe(true);
    expect(benchFaults(quad5, report, pick, { accUncalibrated: true }).accUncalibrated).toBe(true);
    expect(canArm(benchArmRules(quad5, report, pick, { accUncalibrated: true }))).toBe(false);
  });

  it('the guide steps put the first n parts on the right way round and take the rest off', () => {
    const r = run([...allBut([], ['FC']), { type: 'calibrate' }, { type: 'step', n: 5 }]);
    expect(r.state.placed).toEqual({ FRAME: 0, MOTORS: 0, ESC: 0, WIRES: 0, FC: 0 });
    expect(r.state.accOk).toBe(false);
    expect(run([{ type: 'step', n: 0 }], r.state).state.placed).toEqual({});
  });
});

describe('the design', () => {
  it('every option of quad5 changes the numbers, and 2306-2450 on 6S shows over-spin', () => {
    const base = designView(quad5, pick);
    expect(base.motors).toBe(4);
    for (const [slot, options] of [['batt', quad5.design.batts], ['motor', quad5.design.motors], ['prop', quad5.design.props]] as const)
      for (const key of Object.keys(options)) {
        if (key === pick[slot]) continue;
        const v = designView(quad5, { ...pick, [slot]: key });
        expect([v.weight, v.thrustPerMotor, v.hoverThrottle, v.flyMinutes], `${slot} ${key}`).not.toEqual([base.weight, base.thrustPerMotor, base.hoverThrottle, base.flyMinutes]);
      }
    const hot = designView(quad5, { ...pick, motor: '2306-2450' });
    expect(hot.checks.find((c) => c.code === 'over-spin')).toMatchObject({ level: 'danger' });
    expect(benchCalc(quad5, { ...pick, motor: '2306-2450' }).overKv).toBe(true);
  });

  it('reads the pick from the document and changes it with a param.set op', async () => {
    const doc = await createTemplateSource().load('prj_drone-quad5');
    expect(pickOf(doc, quad5)).toEqual(pick);
    const store = createProjectStore(doc);
    const op = pickOp(store.doc, 'motor', '2306-2450')!;
    expect(op).toMatchObject({ k: 'param.set', parameter: { id: 'par_motor', value: '2306-2450' } });
    expect(pickOp(store.doc, 'motor', 'nope')).toBeNull();
    store.apply(op);
    expect(pickOf(store.doc, quad5).motor).toBe('2306-2450');
    store.undo();
    expect(pickOf(store.doc, quad5).motor).toBe(pick.motor);
  });
});

describe('the bench in the document', () => {
  it('stores each step as a domain.patch with undo and redo', async () => {
    const store = createProjectStore(await createTemplateSource().load('prj_drone-quad5'));
    expect(benchOf(store.doc)).toEqual(EMPTY_BENCH);
    const step = (a: BenchAction) => {
      const next = applyBench(benchOf(store.doc), a, ctx).state;
      const ops = benchOps(store.doc, next);
      const res = store.apply(ops);
      expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
      return next;
    };
    step(add('FRAME'));
    step(add('MOTORS'));
    const pop = run([add('ESC'), add('WIRES'), add('FC'), add('XT60', 1), add('CAM'), add('RX'), add('VTX'), add('TOP'), add('BATT'), { type: 'plugIn' }], benchOf(store.doc)).state;
    store.apply(benchOps(store.doc, pop));
    expect(benchOf(store.doc)).toEqual(pop);
    expect(benchOps(store.doc, pop)).toEqual([]);
    store.undo();
    expect(Object.keys(benchOf(store.doc).placed)).toEqual(['FRAME', 'MOTORS']);
    store.redo();
    expect(benchOf(store.doc).fault).toBe('XT60');
    const fixed = step({ type: 'unplug' });
    expect(fixed.fault).toBe('XT60');
    const reseat = step(add('XT60', 0));
    expect(benchOf(store.doc).fault).toBeNull();
    expect(benchOf(store.doc)).toEqual(reseat);
  });
});

describe('what the bench says, in six languages', () => {
  it('every message and part name the model can emit resolves in every language', async () => {
    const said = new Set(['live', 'already', 'after', 'propsLast', 'notOn', 'takeOff', 'off', 'built', 'box', 'buildDone', 'plugNeeds', 'pop', 'powered', 'unplugged', 'faultFix', 'smokeNeeds', 'smokeShort', 'smokeOk', 'noMotors', 'motorNeeds', 'propsOff', 'needBatt', 'motorWrong', 'motorsOk', 'calNeeds', 'calBack', 'calOk']);
    const logged = Object.keys(BENCH_LOG).filter((k) => k !== 'head');
    expect([...said].every((k) => k in BENCH_MSG)).toBe(true);
    const missing: string[] = [];
    for (const lang of LANGS) {
      if (lang === 'en') continue;
      const text = await loadFigureText(lang);
      for (const c of Object.values(BENCH_CRAFTS)) {
        const en = [...[...said].map((key) => englishOf({ kind: 'say', key }, c)!), ...logged.map((key) => englishOf({ kind: 'log', key }, c)!), ...c.parts.map((p) => p.short)];
        for (const s of en) if (!(s in text)) missing.push(`${lang} ${c.id}: ${s}`);
      }
    }
    expect(missing).toEqual([]);
    const de = await loadFigureText('de');
    expect(benchText({ kind: 'say', key: 'after', vars: { short: { part: 'MOTORS' }, need: { part: 'FRAME', lower: true } } }, craft, 'de', de)).toBe(de['{short} goes on after {need}'].replace('{short}', de.MOTORS).replace('{need}', de.FRAME.toLocaleLowerCase('de')));
    expect(benchText({ kind: 'log', key: 'plugged', vars: { v: 25.2 } }, craft, 'en', {})).toBe('battery plugged: 25.2 V');
  });
});
