/** The crash card's logic: its lines from a real crash window, mark labels and timeline positions, the fault's bench part, strings. */
import { describe, expect, it } from 'vitest';
import quad5 from '@/content/drones/quad5';
import { flightCalc } from '@/lib/dronelab/fly';
import { flightOf, type Course, type Sticks } from '@/lib/flight';
import { LANGS } from '../src/contracts/common';
import { createRunner, type FlightRunner, type ReplayWindow } from '../src/range/flight/core';
import { cardLines, causeLine, fixLine, labelRows, markLabel, partOfFault, roomSpeed, timeAtX, timelineX } from '../src/range/flight/crash/model';
import { CRASH_STRINGS } from '../src/range/flight/crash/strings';
import { stringProblems } from '../src/range/shared';
import en from '../../src/i18n/messages/en/flight.json';
import de from '../../src/i18n/messages/de/flight.json';

const { craft, courses } = flightOf(quad5)!;
const race = courses.find((c) => c.id === 'race')!;
const calc = flightCalc(quad5, quad5.design.default);
const open: Course = { ...race, kind: undefined, prims: [], gates: [], checkpoints: [], missions: [], field: 20, pad: [10, 5], ceiling: 16 };
const stick = (): Sticks => ({ throttle: 0.5, yaw: 0, pitch: 0, roll: 0 });

function crashed(faults: object): ReplayWindow {
  const r: FlightRunner = createRunner(craft, open, calc, { mode: 'alt', faults });
  const s = stick();
  r.setSticks(s);
  r.arm();
  s.throttle = 0.8;
  for (let i = 0; i < 72 * 30 && r.phase === 'armed'; i++) {
    r.setSticks(s);
    r.tick(1 / 72);
  }
  expect(r.crash).not.toBeNull();
  return r.crash!;
}

const modeTitle = (m: string) => m.toUpperCase();

describe('the crash card lines', () => {
  const win = crashed({ fcReversed: true });
  it('says what it hit, the speed in room m/s with one decimal, and the fix in words', () => {
    const lines = cardLines({ win, k: 0.075, flight: en, lang: 'en', modeTitle });
    expect(lines[0]).toBe(en.hit[win.hit as keyof typeof en.hit]);
    expect(lines[1]).toBe(`Impact at ${(win.speed * 0.075).toFixed(1)} m/s`);
    expect(lines[2]).toBe(`Fix: ${en.why.fix.fcReversed}`);
  });
  it('shows the cause instead of the fix when Why is on, in the person’s language', () => {
    const lines = cardLines({ win, k: 1, flight: de, lang: 'de', modeTitle, why: true });
    expect(lines[2]).toBe(`Warum: ${de.why.flipFc}`);
    expect(causeLine(win, en, 'en')).toBe(en.why.flipFc);
  });
  it('fills what and kmh into a hit cause, and words every kind of fix', () => {
    const hit = { cause: 'hit', hit: 'pillar', speed: 5 } as const;
    expect(causeLine(hit, en, 'en')).toMatch(/a pillar at 18 km\/h/);
    expect(fixLine({ kind: 'mode', mode: 'angle' }, en, modeTitle)).toBe('Switch to ANGLE and go again');
    expect(fixLine({ kind: 'pace' }, en, modeTitle)).toBe(en.why.fix.pace);
    expect(fixLine({ kind: 'reset' }, en, modeTitle)).toBe(en.why.fix.reset);
    expect(roomSpeed(12.34, 0.075)).toBe('0.9');
  });
  it('words the net on its own', () => {
    const net = { cause: 'net', hit: 'net', speed: 8, fix: { kind: 'reset' } } as unknown as ReplayWindow;
    const lines = cardLines({ win: net, k: 0.075, flight: en, lang: 'en', modeTitle });
    expect(lines[0]).toBe('Flew out of the field: the net');
    expect(lines[1]).toBe('Impact at 0.6 m/s');
    expect(lines[2]).toBe(`Fix: ${en.why.fix.reset}`);
  });
});

describe('the fault names its bench part', () => {
  const parts = ['FRAME', 'MOTORS', 'ESC', 'FC', 'BATT', 'PROPS'];
  it('maps each fault to the part to fix, or null when the craft has none', () => {
    expect(partOfFault('fcReversed', parts)).toBe('FC');
    expect(partOfFault('accUncalibrated', parts)).toBe('FC');
    expect(partOfFault('propsSwapped', parts)).toBe('PROPS');
    expect(partOfFault('motorDirUnchecked', parts)).toBe('MOTORS');
    expect(partOfFault('tailHeavy', parts)).toBe('BATT');
    expect(partOfFault('servosReversed', ['FRAME'])).toBeNull();
  });
  it('a real fcReversed crash window asks for the FC', () => {
    expect(crashed({ fcReversed: true }).fix).toEqual({ kind: 'fault', fault: 'fcReversed' });
  });
});

describe('the timeline', () => {
  it('lays times along a 0.40 m track and reads them back', () => {
    expect(timelineX(0, 3, 0.4)).toBeCloseTo(-0.2, 9);
    expect(timelineX(3, 3, 0.4)).toBeCloseTo(0.2, 9);
    expect(timelineX(1.5, 3, 0.4)).toBeCloseTo(0, 9);
    expect(timelineX(9, 3, 0.4)).toBeCloseTo(0.2, 9);
    expect(timeAtX(0.2, 3, 0.4)).toBeCloseTo(3, 9);
    expect(timeAtX(-9, 3, 0.4)).toBe(0);
    expect(timeAtX(timelineX(2.2, 3, 0.4), 3, 0.4)).toBeCloseTo(2.2, 9);
  });
  it('labels the marks of a real window and keeps them on the track', () => {
    const win = crashed({ fcReversed: true });
    const impact = win.marks.find((m) => m.kind === 'crash')!;
    expect(markLabel(impact, 'en')).toBe('Impact');
    expect(markLabel({ t: 1, kind: 'gate', index: 2 }, 'en')).toBe('Gate 3');
    expect(markLabel({ t: 1, kind: 'saturated' }, 'de')).toBe('Motoren voll');
    expect(timelineX(impact.t, win.duration, 0.4)).toBeLessThanOrEqual(0.2);
    expect(win.marks.every((m) => m.t >= 0 && m.t <= win.duration + 1e-9)).toBe(true);
  });
  it('puts neighbouring labels on different rows', () => {
    expect(labelRows([-0.1, -0.08, 0.1], 0.1, 2)).toEqual([0, 1, 0]);
    expect(labelRows([], 0.1, 2)).toEqual([]);
  });
});

describe('strings', () => {
  it('has all six languages, matching placeholders, no exclamation marks', () => {
    expect(stringProblems(CRASH_STRINGS.table)).toEqual([]);
    for (const l of LANGS) expect(CRASH_STRINGS.t(l, 'speed', { speed: '1.0' })).toContain('1.0');
  });
});
