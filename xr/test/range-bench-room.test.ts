/** The drone bench in the room: what the plates show, the tone of what the bench says, the layout, the strings. */
import { describe, expect, it } from 'vitest';
import { applyBench, benchCraft, EMPTY_BENCH } from '../src/range/flight/model';
import { BENCH_STRINGS } from '../src/range/flight/bench/strings';
import { benchView, FAIL_KEYS, lastSay, motorSequence, panelCells, toneOf } from '../src/range/flight/bench/view';
import { stringProblems } from '../src/range/shared';

const craft = benchCraft('quad5')!;
const step = (st = EMPTY_BENCH, action: Parameters<typeof applyBench>[1]) => applyBench(st, action, { craft, cells: 6 });

describe('the part plates and actions', () => {
  it('an empty bench: the first part is next, the rest wait, nothing to strip, no leads', () => {
    const v = benchView(craft, EMPTY_BENCH);
    expect(v.parts.map((p) => p.state)).toEqual(['next', ...Array(craft.parts.length - 1).fill('waiting')]);
    expect(v.strip.available).toBe(false);
    expect(v.leads).toEqual([]);
    expect(v.build.available && v.plug.available && v.smoke.available && v.motors.available && v.calibrate.available).toBe(true);
  });

  it('fitted parts are on, the next one follows, a turned part is marked', () => {
    let st = step(EMPTY_BENCH, { type: 'add', part: 'FRAME' }).state;
    st = step(st, { type: 'add', part: 'ESC' }).state;
    st = step(st, { type: 'add', part: 'XT60', orient: 1 }).state;
    const v = benchView(craft, st);
    const by = Object.fromEntries(v.parts.map((p) => [p.id, p]));
    expect([by.FRAME!.state, by.ESC!.state, by.XT60!.state]).toEqual(['on', 'on', 'on']);
    expect(by.XT60).toMatchObject({ turned: true, polar: true });
    expect(by.MOTORS!.state).toBe('next');
    expect(by.WIRES!.state).toBe('waiting');
    expect(v.strip.available).toBe(true);
  });

  it('the leads appear with the wires and show each motor straight or crossed', () => {
    const built = step(EMPTY_BENCH, { type: 'build' }).state;
    expect(built.crossed).toEqual([]);
    let st = step(EMPTY_BENCH, { type: 'step', n: craft.parts.findIndex((p) => p.id === 'WIRES') + 1 }).state;
    const v = benchView(craft, st);
    expect(v.leads.map((l) => l.motor)).toEqual(['M1', 'M2', 'M3', 'M4']);
    expect(v.leads.filter((l) => l.crossed).map((l) => l.motor)).toEqual(['M3']);
    st = step(st, { type: 'cross', motor: 'M3' }).state;
    expect(benchView(craft, st).leads.some((l) => l.crossed)).toBe(false);
  });

  it('plug and tests report done from the state', () => {
    const st = step(EMPTY_BENCH, { type: 'build' }).state;
    const v = benchView(craft, st);
    expect([v.smoke.done, v.motors.done, v.calibrate.done, v.plug.done]).toEqual([true, true, true, false]);
    expect(benchView(craft, step(st, { type: 'plug' }).state).plug.done).toBe(true);
  });

  it('a craft without a smoke stopper offers none', () => {
    expect(benchView(benchCraft('swarm')!, EMPTY_BENCH).smoke.available).toBe(false);
  });
});

describe('what the bench says', () => {
  it('refusals and faults are red, the rest pass', () => {
    const early = step(EMPTY_BENCH, { type: 'add', part: 'MOTORS' });
    expect(lastSay(early.messages)).toMatchObject({ key: 'after' });
    expect(toneOf(lastSay(early.messages)!)).toBe('fail');
    expect(toneOf({ key: 'buildDone' })).toBe('pass');
    expect(toneOf({ key: 'powered' })).toBe('pass');
    expect(toneOf({ key: 'smokeOk' })).toBe('pass');
    for (const k of ['live', 'pop', 'smokeShort', 'propsOff', 'busy']) expect(FAIL_KEYS.has(k)).toBe(true);
  });

  it('the XT60 turned round pops on plug-in; the last say wins, logs are not said', () => {
    let st = step(EMPTY_BENCH, { type: 'build' }).state;
    st = step(st, { type: 'add', part: 'XT60', orient: 1 }).state;
    const r = step(st, { type: 'plug' });
    expect(r.state.fault).toBe('XT60');
    expect(r.messages.some((m) => m.kind === 'log')).toBe(true);
    expect(lastSay(r.messages)).toMatchObject({ key: 'pop' });
    expect(lastSay([{ kind: 'log', key: 'pop' }])).toBeNull();
  });
});

describe('layout and test sequences', () => {
  it('part plates fill rows of six in build order, left to right, top row first, centred', () => {
    const c = panelCells(12);
    expect(c).toHaveLength(12);
    expect(c[0]!.y).toBeGreaterThan(c[6]!.y);
    expect(c[0]!.x).toBeCloseTo(-c[5]!.x, 6);
    expect(c[0]!.x).toBeLessThan(c[1]!.x);
    expect(c[6]!.x).toBe(c[0]!.x);
    const odd = panelCells(8);
    expect(odd[6]!.x).toBeCloseTo(-odd[7]!.x, 6);
    expect(Math.max(...panelCells(15).map((p) => Math.abs(p.x)))).toBeLessThan(0.3);
  });

  it('the motor test spins each motor in turn for 0.8 s; the wrong one is marked', () => {
    const seq = motorSequence(craft, ['M3']);
    expect(seq.map((s) => s.motor)).toEqual(['M1', 'M2', 'M3', 'M4']);
    expect(seq.map((s) => [s.from, s.to])).toEqual([[0, 0.8], [0.8, 1.6], [1.6, 2.4], [2.4, 3.2]].map((a) => a.map((x) => expect.closeTo(x, 6))));
    expect(seq.filter((s) => s.wrong).map((s) => s.motor)).toEqual(['M3']);
    expect(seq.every((s) => s.rpm > 0)).toBe(true);
  });
});

describe('strings', () => {
  it('six languages, same placeholders, no exclamation marks', () => {
    expect(stringProblems(BENCH_STRINGS.table)).toEqual([]);
  });
});
