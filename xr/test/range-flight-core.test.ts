/** The flight core on iynk's real flight model: room mapping, sticks, hand rings, guide flight, the runner, replay. */
import { describe, expect, it } from 'vitest';
import quad5 from '@/content/drones/quad5';
import { flightCalc } from '@/lib/dronelab/fly';
import { createInput, flightOf, readSticks, STEP, type Course, type Sticks } from '@/lib/flight';
import {
  clampTarget,
  controllerSticks,
  createRunner,
  climbModeFor,
  guideSpeed,
  guideSticks,
  handSticks,
  mapCourse,
  MIN_DRAWN_M,
  ReplayClock,
  ringStick,
  roomVolume,
  type FlightRunner,
  type Out3,
  type RunnerEvent,
} from '../src/range/flight/core';

const { craft, courses } = flightOf(quad5)!;
const race = courses.find((c) => c.id === 'race')!;
const calc = flightCalc(quad5, quad5.design.default);
const open: Course = { ...race, kind: undefined, prims: [], gates: [], checkpoints: [], missions: [], field: 20, pad: [10, 5], ceiling: 16 };
const ahead = { fx: 0, fz: -1 }; // looking down -Z: right is +X
const out: Out3 = [0, 0, 0];
const stick = (): Sticks => ({ throttle: 0.5, yaw: 0, pitch: 0, roll: 0 });

function record(r: FlightRunner) {
  const events: RunnerEvent[] = [];
  r.onEvent((e) => events.push(e));
  return events;
}

/** Ticks the runner at 72 Hz until `done` or `maxS` seconds, steering with `steer`. */
function fly(r: FlightRunner, maxS: number, done: () => boolean, steer?: (s: Sticks) => void) {
  const s = stick();
  for (let i = 0; i < maxS * 72 && !done(); i++) {
    if (steer) {
      steer(s);
      r.setSticks(s);
    }
    r.tick(1 / 72);
  }
}

describe('the room volume and the course in it', () => {
  it('fits quad5 race (a 40 m field, 16 m ceiling) into 3 x 3 m at k = 0.075, course +x right, +y away', () => {
    const map = mapCourse(roomVolume(0, 0, ahead), race.field, race.ceiling ?? craft.ceiling, race.pad);
    expect(map.k).toBeCloseTo(0.075, 6);
    // the field's near edge at the volume's near edge, half a metre ahead, centred on the head
    map.toRoom(0, 0, 0, out);
    expect(out[0]).toBeCloseTo(-1.5, 6);
    expect(out[2]).toBeCloseTo(-0.5, 6);
    map.toRoom(20, 6, 1, out);
    expect(out[0]).toBeCloseTo(0, 6); // pad centred
    expect(out[1]).toBeCloseTo(0.075, 6); // 1 m up
    expect(out[2]).toBeCloseTo(-0.95, 6);
    map.toCourse(out[0], out[1], out[2], out);
    expect([out[0], out[1], out[2]].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([20, 6, 1]);
    // course north (yaw 90) is away (-Z): about +Y, +X turned by +90 degrees is -Z
    expect(map.yawToWorld(90)).toBeCloseTo(Math.PI / 2, 6);
    // a 5-inch quad (about 0.3 m) is drawn at least MIN_DRAWN_M across
    expect(map.drawnScale(0.3) * 0.3).toBeCloseTo(MIN_DRAWN_M, 6);
  });

  it('puts the pad 1.5 m ahead when the field is smaller than the volume, and turns with the head', () => {
    const map = mapCourse(roomVolume(1, 2, { fx: 1, fz: 0 }), 2, 2, [1, 0.5]);
    expect(map.k).toBe(1);
    map.toRoom(1, 0.5, 0, out); // facing +X: ahead is +X, right is +Z
    expect(out[0]).toBeCloseTo(1 + 1.5, 6);
    expect(out[2]).toBeCloseTo(2, 6);
    expect(map.yawToWorld(90)).toBeCloseTo(0, 6); // course north is ahead, +X
  });

  it('fits inside a guardian polygon with the inset, and shows the net only near a face', () => {
    const poly: Array<[number, number]> = [[-1.25, 0.5], [1.25, 0.5], [1.25, -4], [-1.25, -4]];
    const vol = roomVolume(0, 0, ahead, { polygon: poly });
    expect(vol.right - vol.left).toBeLessThanOrEqual(1.9 + 1e-6);
    expect(vol.right - vol.left).toBeGreaterThan(1.5);
    expect(vol.far).toBeLessThanOrEqual(3.7 + 1e-6);
    const map = mapCourse(roomVolume(0, 0, ahead), race.field, 16, race.pad);
    expect(map.netFace(20, 20, 2)).toBeNull();
    expect(map.netFace(-1.5, 20, 2)).toBe('left');
    expect(map.netFace(20, 41, 2)).toBe('far');
    expect(map.netFace(20, 20, 15)).toBe('top');
  });
});

describe('the controller sticks', () => {
  it('mode 2 matches the 2D range: left climb and yaw, right pitch and roll, y forward is -1', () => {
    const inp = createInput();
    const s = stick();
    for (const [lx, ly, rx, ry] of [[0.5, -1, 0.3, -0.7], [-1, 0.4, -0.2, 1], [0.03, 0.02, -0.05, 0]]) {
      controllerSticks({ x: lx, y: ly }, { x: rx, y: ry }, 2, s);
      // the 2D's touch sticks are y-up and carry no deadband: feed them the deadbanded values
      inp.left = { x: s.yaw, y: (s.throttle - 0.5) * 2 };
      inp.right = { x: -s.roll, y: s.pitch };
      const ref = readSticks(inp, true, 0.016);
      expect(s).toEqual({ throttle: ref.throttle, yaw: ref.yaw, pitch: ref.pitch, roll: ref.roll });
    }
    controllerSticks({ x: 0, y: -1 }, { x: 1, y: -1 }, 2, s);
    expect(s).toEqual({ throttle: 1, yaw: 0, pitch: 1, roll: -1 }); // climb, nose down, bank right
    controllerSticks({ x: 0.04, y: 0.05 }, { x: 0, y: 0 }, 2, s);
    expect(s).toEqual({ throttle: 0.5, yaw: 0, pitch: 0, roll: 0 }); // inside the deadband
    controllerSticks({ x: 0, y: -1 }, { x: 0, y: 1 }, 1, s);
    expect(s.pitch).toBe(1); // mode 1: left y is pitch
    expect(s.throttle).toBe(0); // and right y climbs (here: descends)
  });

  it('flies the climb alternative of a manual-throttle mode', () => {
    expect(climbModeFor(craft, 'race')).toBe('alt');
    expect(climbModeFor(craft, 'range')).toBe('range');
  });
});

describe('the hand rings', () => {
  it('ignores the first 15 % of 60 mm, is full at 60 mm, and leaves zero smoothly', () => {
    const r = { x: 0, y: 0 };
    expect(ringStick(0.0089, 0, r).x).toBe(0);
    expect(ringStick(0.0095, 0, r).x).toBeGreaterThan(0);
    expect(ringStick(0.0095, 0, r).x).toBeLessThan(0.02);
    expect(ringStick(0, 0.06, r).y).toBeCloseTo(1, 9);
    expect(ringStick(0, -0.2, r).y).toBeCloseTo(-1, 9);
  });

  it('left up climbs and right yaws; right away pitches forward and right banks right, in the head frame', () => {
    const s = stick();
    const o = [0, 1, 0] as const;
    handSticks({ origin: o, point: [0.06, 1, 0], heading: ahead }, { origin: o, point: [0, 1, -0.06], heading: ahead }, s);
    expect(s.yaw).toBeCloseTo(1, 9);
    expect(s.throttle).toBeCloseTo(0.5, 9);
    expect(s.pitch).toBeCloseTo(1, 9);
    handSticks({ origin: o, point: [0, 1.06, 0], heading: ahead }, { origin: o, point: [0.06, 1, 0], heading: ahead }, s);
    expect(s.throttle).toBeCloseTo(1, 9);
    expect(s.roll).toBeCloseTo(-1, 9);
    // facing +X, away is +X
    handSticks(null, { origin: o, point: [0.06, 1, 0], heading: { fx: 1, fz: 0 } }, s);
    expect(s.pitch).toBeCloseTo(1, 9);
    expect(s.roll).toBeCloseTo(0, 9);
    handSticks(null, null, s);
    expect(s).toEqual({ throttle: 0.5, yaw: 0, pitch: 0, roll: 0 });
  });
});

describe('guide flight in the real flight model', () => {
  it('holds a hover and reaches a target 2 m away within a few seconds, without much overshoot', () => {
    const r = createRunner(craft, open, calc, { mode: 'alt' });
    const t: Out3 = [10, 5, 1.5];
    const steer = (s: Sticks) => guideSticks(r.session.sim, t[0], t[1], t[2], guideSpeed(0.15), s);
    r.setSticks(stick());
    r.arm();
    expect(r.phase).toBe('armed');
    fly(r, 4, () => false, steer);
    expect(Math.abs(r.frame.z - 1.5)).toBeLessThan(0.2);
    clampTarget(12, 5, 1.5, open.field, 16, t);
    let far = 0;
    const start = r.frame.step;
    fly(r, 6, () => false, (s) => {
      steer(s);
      far = Math.max(far, r.frame.x - 10);
    });
    expect(r.frame.crashed).toBe(false);
    expect(Math.hypot(r.frame.x - 12, r.frame.y - 5)).toBeLessThan(0.15);
    expect(far).toBeLessThan(2.3); // at most 0.3 m past it
    expect((r.frame.step - start) * STEP).toBeLessThanOrEqual(6.01);
    expect(clampTarget(-5, 30, 40, open.field, 16, t)).toEqual([1, 19, 14.5]);
  });
});

describe('the runner', () => {
  it('arms with mode-2 sticks centred, climbs, flies through the first gate of quad5 race', () => {
    const r = createRunner(craft, race, calc, { mode: 'race' });
    const events = record(r);
    expect(r.mode).toBe('alt');
    const s = stick();
    controllerSticks({ x: 0, y: -1 }, { x: 0, y: 0 }, 2, s);
    r.setSticks(s);
    r.arm();
    expect(events.some((e) => e.type === 'blocked' && e.why === 'sticks')).toBe(true);
    expect(r.phase).toBe('disarmed');
    r.setSticks(stick());
    r.arm();
    expect(r.phase).toBe('armed');
    fly(r, 3, () => r.frame.z > 0.8, (st) => controllerSticks({ x: 0, y: -0.6 }, { x: 0, y: 0 }, 2, st));
    expect(events.some((e) => e.type === 'takeoff')).toBe(true);
    fly(r, 6, () => events.some((e) => e.type === 'gate'), (st) => controllerSticks({ x: 0, y: 0 }, { x: 0, y: -0.35 }, 2, st));
    expect(events.find((e) => e.type === 'gate')).toMatchObject({ index: 1 }); // the flight model counts gates from 1
    expect(r.frame.gate).toBe(1);
    expect(r.phase).toBe('armed');
  });

  it('freezes 300 ms at an impact, then holds the crash with a replay whose crash frame and cause make sense', () => {
    const r = createRunner(craft, open, calc, { mode: 'alt', faults: { fcReversed: true } });
    const events = record(r);
    r.setSticks(stick());
    r.arm();
    fly(r, 10, () => r.phase !== 'armed', (s) => {
      s.throttle = 0.8;
    });
    expect(r.phase).toBe('frozen');
    const step = r.frame.step;
    const w = r.crash!;
    expect(w.cause).toBe('flipFc');
    expect(w.fix).toEqual({ kind: 'fault', fault: 'fcReversed' });
    expect(w.frames[w.at].crashed).toBe(true);
    expect(w.frames[w.at - 1].crashed).toBe(false);
    expect(w.marks.find((m) => m.kind === 'crash')!.t).toBeCloseTo(w.at * STEP, 6);
    r.tick(0.1);
    r.tick(0.1);
    expect(r.phase).toBe('frozen');
    expect(r.frame.step).toBe(step); // not ticked: it stays where it hit
    r.tick(0.1);
    r.tick(0.1);
    expect(r.phase).toBe('crashed');
    expect(r.openReplay()).toBe(true);
    expect(r.phase).toBe('replay');
    r.closeReplay();
    r.arm();
    expect(events.filter((e) => e.type === 'blocked').pop()).toMatchObject({ why: 'crashed' });
    r.reset();
    expect(r.phase).toBe('disarmed');
    expect(r.crash).toBeNull();
    expect(r.frame.crashed).toBe(false);
  });

  it('calls the field edge the net: a crash with its own replay window ending at the net', () => {
    const r = createRunner(craft, open, calc, { mode: 'alt' });
    const events = record(r);
    r.setSticks(stick());
    r.arm();
    fly(r, 3, () => r.frame.z > 1, (s) => {
      s.throttle = 0.8;
    });
    fly(r, 20, () => r.phase !== 'armed', (s) => {
      s.throttle = 0.5;
      s.pitch = 1;
    });
    expect(events.some((e) => e.type === 'net')).toBe(true);
    expect(r.phase).toBe('frozen');
    const w = r.crash!;
    expect(w.hit).toBe('net');
    expect(w.at).toBe(w.frames.length - 1);
    expect(w.frames[w.at].y).toBeGreaterThan(open.field + 2 - 0.5);
    expect(w.duration).toBeCloseTo(2, 1);
    expect(w.speed).toBeGreaterThan(3);
  });
});

describe('the replay clock', () => {
  it('plays at a third of real time, pauses, scrubs, and samples without allocating', () => {
    const frames = Array.from({ length: 301 }, () => ({}) as never);
    const c = new ReplayClock({ frames });
    expect(c.duration).toBeCloseTo(3, 9);
    const a = c.tick(0.3);
    expect(a.t).toBeCloseTo(0.1, 9);
    expect(a.index).toBe(10);
    expect(c.tick(0.015)).toBe(a); // one reused sample
    expect(a.index).toBe(10);
    expect(a.frac).toBeCloseTo(0.5, 6);
    c.pause();
    c.tick(1);
    expect(c.t).toBeCloseTo(0.105, 9);
    expect(c.scrub(2.995)).toMatchObject({ index: 299 });
    expect(c.scrub(99).index).toBe(299);
    expect(c.sample().frac).toBe(1);
    c.play();
    expect(c.t).toBe(0);
    c.tick(100);
    expect(c.playing).toBe(false);
  });
});
