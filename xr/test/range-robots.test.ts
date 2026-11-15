/** The robot arena's logic: the arena from the documents, the room mapping, interpolation, the trail, the readout, strings. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Project } from '@/project/generated/types';
import type { PhysicsFrame } from '../src/contracts/sim';
import { LANGS } from '../src/contracts/common';
import {
  ARENA_NEAR_M,
  arenaOf,
  createPoseTrack,
  createTrail,
  placeArena,
  readoutLines,
  sensorText,
  toRoom,
  TRAIL_POINTS,
  wrapPi,
} from '../src/range/robots/arena/model';
import { ARENA_STRINGS } from '../src/range/robots/arena/strings';
import { stringProblems } from '../src/range/shared';

const robot = (name: string): Project =>
  JSON.parse(readFileSync(new URL(`../../content/projects/robots/${name}.project.json`, import.meta.url), 'utf8')) as Project;

describe('the arena of a robot document', () => {
  it('drive-base: a 1.8 x 1.2 m floor, four walls, no line, the bodies from their shapes', () => {
    const a = arenaOf(robot('drive-base'))!;
    expect([a.width, a.depth]).toEqual([1.8, 1.2]);
    expect(a.walls).toHaveLength(4);
    expect(a.tracks).toHaveLength(0);
    expect(a.start.x).toBeCloseTo(-0.7);
    expect(a.chassis).toBe('bdy_chassis');
    const by = Object.fromEntries(a.bodies.map((b) => [b.id, b]));
    expect(by.bdy_chassis!.shape.kind).toBe('box');
    (by.bdy_chassis!.shape as unknown as { size: number[] }).size.forEach((v, i) => expect(v).toBeCloseTo([0.16, 0.11, 0.02][i]!));
    expect(by.bdy_wheel_l!.shape.kind).toBe('cylinder');
    expect((by.bdy_wheel_l!.shape as unknown as { radius: number }).radius).toBeCloseTo(0.0325);
    expect(by.bdy_caster!.shape.kind).toBe('sphere');
    expect(by.bdy_chassis!.rolls).toBe(false);
    expect(by.bdy_wheel_l!.rolls && by.bdy_caster!.rolls).toBe(true);
  });

  it('line-follower: the oval track in metres, 19 mm wide, closed', () => {
    const a = arenaOf(robot('line-follower'))!;
    expect(a.tracks).toHaveLength(1);
    const t = a.tracks[0]!;
    expect(t.closed).toBe(true);
    expect(t.widthM).toBeCloseTo(0.019);
    expect(t.points[0]).toBeCloseTo(0.7);
    expect(t.points[1]).toBeCloseTo(0);
    expect(Math.max(...t.points.filter((_, i) => i % 2 === 0))).toBeLessThan(a.width / 2);
  });

  it('a document without a robot has no arena', () => {
    expect(arenaOf({ ...robot('drive-base'), domains: {} } as Project)).toBeNull();
  });
});

describe('where the arena stands', () => {
  const a = arenaOf(robot('drive-base'))!;
  it('its near edge is 1.0 m ahead of the head and it is level on the floor', () => {
    const p = placeArena(a, { x: 0.3, z: -0.2, heading: { fx: 0, fz: -1 } });
    const near = toRoom(p, 0, -a.depth / 2, 0, [0, 0, 0]);
    expect(near[0]).toBeCloseTo(0.3);
    expect(near[2]).toBeCloseTo(-0.2 - ARENA_NEAR_M);
    expect(near[1]).toBe(0);
    // arena x is the person's right (+X when looking down -Z), arena y is ahead, and z is up
    const right = toRoom(p, 1, -a.depth / 2, 0, [0, 0, 0]);
    expect(right[0] - near[0]).toBeCloseTo(1);
    const ahead = toRoom(p, 0, -a.depth / 2 + 1, 0, [0, 0, 0]);
    expect(ahead[2] - near[2]).toBeCloseTo(-1);
    expect(toRoom(p, 0, 0, 0.5, [0, 0, 0])[1]).toBe(0.5);
  });
  it('turned heads place it ahead of where they look', () => {
    const p = placeArena(a, { x: 0, z: 0, heading: { fx: 1, fz: 0 } });
    const near = toRoom(p, 0, -a.depth / 2, 0, [0, 0, 0]);
    expect(near[0]).toBeCloseTo(1);
    expect(near[2]).toBeCloseTo(0);
  });
});

const frame = (atNs: number, x: number, yaw = 0, wheelYaw = 2.5): PhysicsFrame => ({
  atNs,
  bodies: {
    bdy_chassis: { p: [x, 0, 0.03], yawRad: yaw },
    bdy_wheel_l: { p: [x, 0.07, 0.03], yawRad: wheelYaw },
    bdy_wheel_r: { p: [x, -0.07, 0.03], yawRad: wheelYaw },
    bdy_caster: { p: [x - 0.08, 0, 0.007], yawRad: wheelYaw },
  },
});

describe('interpolating between physics frames', () => {
  const specs = arenaOf(robot('drive-base'))!.bodies;
  const at = (t: ReturnType<typeof createPoseTrack>, id: string) => t.pose.subarray(t.ids.indexOf(id) * 4, t.ids.indexOf(id) * 4 + 4);

  it('glides from the pose on show to the new frame over the gap between frames', () => {
    const t = createPoseTrack(specs, 'bdy_chassis');
    t.push(frame(0, 0), 0);
    t.sample(0);
    expect(at(t, 'bdy_chassis')[0]).toBeCloseTo(0);
    t.push(frame(33e6, 0.1), 0.1);
    t.sample(0.1);
    expect(at(t, 'bdy_chassis')[0]).toBeCloseTo(0, 5);
    t.push(frame(66e6, 0.2), 0.2);
    t.sample(0.2);
    expect(at(t, 'bdy_chassis')[0]).toBeCloseTo(0.1, 4);
    t.sample(0.25);
    expect(at(t, 'bdy_chassis')[0]).toBeCloseTo(0.15, 4);
    t.sample(5);
    expect(at(t, 'bdy_chassis')[0]).toBeCloseTo(0.2, 5);
    expect(t.simS).toBeCloseTo(0.066);
  });

  it('wheels and caster ride the chassis heading, not the yaw in their own frames', () => {
    const t = createPoseTrack(specs, 'bdy_chassis');
    t.push(frame(0, 0, 1.2, -1.7), 0);
    expect(at(t, 'bdy_wheel_l')[3]).toBeCloseTo(1.2);
    expect(at(t, 'bdy_caster')[3]).toBeCloseTo(1.2);
  });

  it('turns the short way round the circle', () => {
    const t = createPoseTrack(specs, 'bdy_chassis');
    t.push(frame(0, 0, 3.0), 0);
    t.push(frame(33e6, 0, -3.0), 0.1);
    t.push(frame(66e6, 0, -3.0), 0.2);
    t.sample(0.15);
    expect(Math.abs(wrapPi(at(t, 'bdy_chassis')[3]!))).toBeGreaterThan(3.0);
    expect(wrapPi(-3.0 - 3.0)).toBeCloseTo(2 * Math.PI - 6);
  });

  it('snaps when the sim clock goes back (Stop), and says so', () => {
    const t = createPoseTrack(specs, 'bdy_chassis');
    t.push(frame(0, -0.7), 0);
    t.push(frame(500e6, 0.5), 1);
    t.sample(5);
    expect(t.push(frame(0, -0.7), 6)).toBe(true);
    expect(at(t, 'bdy_chassis')[0]).toBeCloseTo(-0.7);
    expect(t.push(frame(30e6, -0.69), 6.1)).toBe(false);
  });

  it('ignores a frame that lacks a body and allocates nothing per frame', () => {
    const t = createPoseTrack(specs, 'bdy_chassis');
    const pose = t.pose;
    t.push({ atNs: 0, bodies: { bdy_chassis: { p: [1, 2, 3], yawRad: 0 } } }, 0);
    t.sample(0.01);
    expect(t.pose).toBe(pose);
    expect(at(t, 'bdy_chassis')[0]).toBeCloseTo(1);
  });
});

describe('the dashed trail', () => {
  it('keeps 5 s at 10 Hz in one buffer, and its dashes follow the path', () => {
    const trail = createTrail();
    expect(TRAIL_POINTS).toBe(51);
    const buffer = trail.positions, dashes = trail.dashes;
    trail.reset(0, 0, 0.003);
    let changed = 0;
    for (let i = 1; i <= 100; i++) if (trail.tick(0.05, i * 0.01, 0, 0.003)) changed++;
    expect(changed).toBe(50);
    expect(trail.positions).toBe(buffer);
    expect(trail.dashes).toBe(dashes);
    // the newest point is where the robot is, the oldest is about 5 s back
    expect(trail.positions[(TRAIL_POINTS - 1) * 3]).toBeCloseTo(1.0, 5);
    expect(trail.positions[0]).toBeCloseTo(0.0, 1);
    // every dash is a short piece of the path, and the gaps between them are the same length
    expect(trail.dashCount).toBe(25);
    for (let k = 0; k < trail.dashCount; k++) expect(trail.dashes[k * 6 + 3]! - trail.dashes[k * 6]!).toBeGreaterThan(0.005);
    for (let k = 1; k < trail.dashCount; k++) expect(trail.dashes[k * 6]! - trail.dashes[(k - 1) * 6 + 3]!).toBeGreaterThan(0.005);
  });
  it('reset collapses it onto one point', () => {
    const trail = createTrail();
    trail.tick(1, 5, 5, 0);
    trail.reset(1, 2, 3);
    expect(new Set(trail.positions).size).toBe(3);
  });
});

describe('the readout and the strings', () => {
  it('says loading, ready and failed, the run state and the sensors', () => {
    const base = { lang: 'en' as const, run: 'idle' as const, simS: 1.234, sensors: undefined, message: '' };
    expect(readoutLines({ ...base, mech: { state: 'loading-physics' } })[0]).toBe('Physics: loading the engine');
    expect(readoutLines({ ...base, mech: { state: 'ready' } })[0]).toBe('Physics: ready');
    expect(readoutLines({ ...base, mech: { state: 'failed', reason: 'invalid-robot', code: 'invalid-robot' } })[0]).toBe('Physics failed: invalid-robot');
    const lines = readoutLines({ ...base, run: 'running', mech: { state: 'ready' }, sensors: { sen_line: 0.8123, side: 'left' } });
    expect(lines[1]).toBe('Running · time 1.2 s');
    expect(lines[2]).toBe('Sensors: line 0.81 · side left');
    expect(sensorText(undefined)).toBe('');
  });
  it('has every string in all six languages with the same placeholders', () => {
    expect(stringProblems(ARENA_STRINGS.table)).toEqual([]);
    for (const l of LANGS) expect(ARENA_STRINGS.t(l, 'back').length).toBeGreaterThan(0);
  });
});
