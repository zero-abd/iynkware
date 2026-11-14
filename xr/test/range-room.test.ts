/** The room flight's logic: the craft's pose signs, the build that flies, the readout, the trail and the strings. */
import { Euler, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import quad5 from '@/content/drones/quad5';
import { flightOf } from '@/lib/flight';
import { createProjectStore, createTemplateSource } from '../src/project/store';
import { applyBench, benchCraft, benchOf, benchOps, EMPTY_BENCH, type BenchAction, type BenchState } from '../src/range/flight/model';
import { mapCourse, roomVolume, type RunnerFrame } from '../src/range/flight/core';
import {
  buildThatFlies,
  craftPose,
  createTrail,
  crashText,
  firstBlocking,
  modeTitle,
  newPose,
  propRpm,
  readoutLines,
  refusedByRule,
  refusedText,
  ruleReason,
  TRAIL_HZ,
  TRAIL_POINTS,
} from '../src/range/flight/room/model';
import { ROOM_STRINGS } from '../src/range/flight/room/strings';
import { stringProblems } from '../src/range/shared';

const craft = benchCraft('quad5')!;
const pick = quad5.design.default;
const ctx = { craft, pick, cells: quad5.design.batts[pick.batt].cells };
const add = (part: string, orient: 0 | 1 = 0): BenchAction => ({ type: 'add', part, orient });
const parts = craft.parts.map((p) => p.id).filter((id) => id !== 'PROPS');
const tests: BenchAction[] = [{ type: 'smoke' }, { type: 'motors' }, { type: 'unplug' }, { type: 'calibrate' }];
const run = (actions: BenchAction[]): BenchState => actions.reduce((st, a) => applyBench(st, a, ctx).state, EMPTY_BENCH);
const built = (flip: string[] = [], skipCal = false) =>
  run([...parts.map((id) => add(id, flip.includes(id) ? 1 : 0)), ...tests.filter((t) => !(skipCal && t.type === 'calibrate')), add('PROPS')]);

async function docWith(state: BenchState) {
  const store = createProjectStore(await createTemplateSource().load('prj_drone-quad5'));
  store.apply(benchOps(store.doc, state));
  return store.doc;
}

const frame = (over: Partial<RunnerFrame> = {}): RunnerFrame => ({
  x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, spin: 0, thr: 0, speed: 0, armed: false, crashed: false, airborne: false, perCell: 4.2, low: false, gate: 0, checkpoint: 0, t: 0, step: 0, ...over,
});

// the person looks down -Z: course +x is world +X, course +y is world -Z
const volume = roomVolume(0, 0, { fx: 0, fz: -1 });
const map = mapCourse(volume, 40, 16, [20, 5]);

/** The world direction of a craft-frame vector under a pose. */
function world(pose: ReturnType<typeof newPose>, v: [number, number, number]) {
  const q = new Quaternion().setFromEuler(new Euler(pose.rx, pose.ry, pose.rz, 'YXZ'));
  return new Vector3(...v).applyQuaternion(q);
}

describe('the craft pose', () => {
  it('puts the craft at the mapped position at the drawn scale', () => {
    const p = craftPose(map, frame({ x: 20, y: 5, z: 4 }), 0.285, newPose());
    expect(p.y).toBeCloseTo(4 * map.k, 6);
    expect(p.scale).toBeCloseTo(0.08 / 0.285, 6);
    const q = craftPose(map, frame({ x: 20, y: 5, z: 0 }), 0.285, newPose());
    expect(Math.abs(q.x)).toBeLessThan(1e-6);
    expect(q.z).toBeCloseTo(-(map.ahead0 + 5 * map.k), 6);
  });

  it('points the nose along the course heading: yaw 0 flies along +x, yaw 90 along +y', () => {
    const east = world(craftPose(map, frame({ yaw: 0 }), 0.285, newPose()), [0, 0, 1]);
    expect(east.x).toBeCloseTo(1, 6);
    const north = world(craftPose(map, frame({ yaw: 90 }), 0.285, newPose()), [0, 0, 1]);
    expect(north.z).toBeCloseTo(-1, 6);
    expect(Math.abs(north.x)).toBeLessThan(1e-6);
  });

  it('pitches nose down for positive pitch and banks the left side down for positive roll', () => {
    const down = world(craftPose(map, frame({ pitch: 30 }), 0.285, newPose()), [0, 0, 1]);
    expect(down.y).toBeLessThan(-0.49);
    const up = world(craftPose(map, frame({ pitch: -30 }), 0.285, newPose()), [0, 0, 1]);
    expect(up.y).toBeGreaterThan(0.49);
    const left = world(craftPose(map, frame({ roll: 30 }), 0.285, newPose()), [1, 0, 0]);
    expect(left.y).toBeLessThan(-0.49);
    const right = world(craftPose(map, frame({ roll: 30 }), 0.285, newPose()), [-1, 0, 0]);
    expect(right.y).toBeGreaterThan(0.49);
    // the nose stays on the heading under a bank
    expect(world(craftPose(map, frame({ roll: 30 }), 0.285, newPose()), [0, 0, 1]).x).toBeGreaterThan(0.85);
  });

  it('spins the props with the motor output once armed', () => {
    expect(propRpm(1, false)).toBe(0);
    expect(propRpm(0.5, true)).toBeGreaterThan(propRpm(0, true));
    expect(propRpm(2, true)).toBe(propRpm(1, true));
  });
});

describe('the build that flies', () => {
  it('flies the factory build while the bench is incomplete', async () => {
    const b = buildThatFlies(quad5, await docWith(EMPTY_BENCH));
    expect(b.source).toBe('factory');
    expect(b.faults).toEqual({});
    expect(b.refusal).toBeNull();
  });

  it('flies a complete bench build with its faults: a reversed FC flips', async () => {
    const ok = buildThatFlies(quad5, await docWith(built()));
    expect(ok.source).toBe('bench');
    expect(ok.refusal).toBeNull();
    expect(ok.faults.fcReversed).toBeFalsy();
    const doc = await docWith(built(['FC']));
    expect(benchOf(doc).placed.FC).toBe(1);
    const back = buildThatFlies(quad5, doc);
    expect(back.source).toBe('bench');
    expect(back.faults.fcReversed).toBe(true);
    expect(back.refusal).toBeNull();
  });

  it('refuses arming with the accelerometer uncalibrated, naming the rule', async () => {
    const b = buildThatFlies(quad5, await docWith(built([], true)));
    expect(b.source).toBe('bench');
    expect(b.faults.accUncalibrated).toBe(true);
    expect(b.refusal?.id).toBe('acc');
    expect(refusedByRule(b.refusal!, 'en')).toBe('Arming refused: the accelerometer is not calibrated');
    expect(firstBlocking([{ id: 'throttle', ok: true, level: 'rule' }])).toBeNull();
  });
});

describe('the readout', () => {
  const flight = { modes: { angle: 'Angle mode' }, hit: { tree: 'Hit a tree' } };
  const input = { lang: 'en' as const, flight, source: 'factory' as const, mode: 'angle', perCell: 4.123, low: false, gate: 1, gates: 5, lap: null, message: 'Armed' };

  it('says the build, mode, battery per cell, the next gate, the lap and the last event', () => {
    expect(readoutLines(input)).toEqual(['Flying the factory build · Mode: Angle mode', 'Battery 4.12 V per cell', 'Next gate 2 of 5', 'Lap time: not started', 'Armed']);
    expect(readoutLines({ ...input, source: 'bench', low: true, gate: 4, lap: 7.26 }).slice(0, 4)).toEqual([
      'Flying your bench build · Mode: Angle mode',
      'Battery 4.12 V per cell: land now',
      'Next gate 5 of 5',
      'Lap time 7.3 s',
    ]);
    expect(readoutLines({ ...input, gates: 0 })[2]).toBe('No gates on this course');
  });

  it("falls back to the mode id and a plain crash line, and names a crash from iynk's hit.*", () => {
    expect(modeTitle(flight, 'zzz')).toBe('zzz');
    expect(crashText(flight, 'tree', 'en')).toBe('Crashed: Hit a tree. Press B to reset');
    expect(crashText(flight, 'nothing', 'en')).toBe('Crashed. Press B to reset');
  });

  it("turns the runner's refusals into sentences in every language", () => {
    for (const why of ['crashed', 'air', 'throttle', 'battery', 'acc', 'sticks'] as const) {
      expect(refusedText(why, 'de')).toMatch(/^Scharfmachen verweigert: /);
    }
    expect(ruleReason({ id: 'acc' }, 'en')).toBe('the accelerometer is not calibrated');
  });
});

describe('the trail', () => {
  it('holds 2 s, shifts the oldest out, and resets onto one point', () => {
    expect(TRAIL_POINTS).toBe(2 * TRAIL_HZ);
    const t = createTrail(4);
    t.reset(1, 2, 3);
    expect(Array.from(t.positions)).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]);
    expect(t.tick(0.01, 9, 9, 9)).toBe(false);
    expect(t.tick(1 / TRAIL_HZ, 4, 5, 6)).toBe(true);
    expect(Array.from(t.positions).slice(-6)).toEqual([1, 2, 3, 4, 5, 6]);
    t.tick(1 / TRAIL_HZ, 7, 8, 9);
    t.tick(1 / TRAIL_HZ, 10, 11, 12);
    t.tick(1 / TRAIL_HZ, 13, 14, 15);
    expect(Array.from(t.positions)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });
});

describe('the strings', () => {
  it('are complete in six languages, with matching placeholders and no exclamation marks', () => {
    expect(stringProblems(ROOM_STRINGS.table)).toEqual([]);
  });
});

describe('the course for the room', () => {
  it('has a gate course to fly: the first gates course of quad5', () => {
    const course = flightOf(quad5)!.courses.find((c) => c.kind === 'gates')!;
    expect(course.id).toBe('race');
    expect(course.gates).toHaveLength(5);
  });
});
