/**
 * The robot arena's logic, with nothing drawn: the arena of a robot document in metres, where it stands in the room,
 * the bodies' shapes, the interpolation between physics frames, the dashed trail of the chassis path and the readout.
 *
 * Arena axes are the sim's: x to the person's right, y away from them, z up (metres). The room mapping keeps handedness
 * (right, ahead, up) so nothing mirrors.
 */
import type { Project } from '@/project/generated/types';
import type { Lang } from '../../../contracts/common';
import type { MechStatus, PhysicsFrame, RunState } from '../../../contracts/sim';
import { ARENA_STRINGS as S } from './strings';

/** The arena's near edge stands this far ahead of the head at entry (docs/XR_DESIGN.md 8.3). */
export const ARENA_NEAR_M = 1.0;
/** The path trail keeps the last 5 s, one point per 0.1 s. */
export const TRAIL_S = 5;
export const TRAIL_HZ = 10;
export const TRAIL_POINTS = TRAIL_S * TRAIL_HZ + 1;
/** The trail floats this far above the floor. */
export const TRAIL_LIFT_M = 0.003;

export interface Wall {
  readonly id: string;
  /** Centre, metres. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Full sizes along the wall's own x, y, z. */
  readonly w: number;
  readonly d: number;
  readonly h: number;
  /** Rotation about z, radians. */
  readonly yaw: number;
}

export interface TrackLine {
  readonly id: string;
  readonly closed: boolean;
  readonly widthM: number;
  /** x, y pairs, metres. */
  readonly points: readonly number[];
}

export type Shape =
  | { readonly kind: 'box'; readonly size: readonly [number, number, number] }
  | { readonly kind: 'cylinder'; readonly radius: number; readonly height: number }
  | { readonly kind: 'sphere'; readonly radius: number };

export interface BodySpec {
  readonly id: string;
  readonly shape: Shape;
  /** A wheel or anything else that rolls: its yaw in the frame is not a heading, so it takes the chassis's. */
  readonly rolls: boolean;
}

export interface ArenaSpec {
  readonly width: number;
  readonly depth: number;
  readonly start: { readonly x: number; readonly y: number; readonly yaw: number };
  readonly walls: readonly Wall[];
  readonly tracks: readonly TrackLine[];
  readonly bodies: readonly BodySpec[];
  /** The body whose path is trailed and whose yaw orients the rolling bodies. */
  readonly chassis: string;
}

const MM = 0.001;
const DEG = Math.PI / 180;

type Num3 = readonly number[];
interface RobotData {
  readonly arena?: {
    readonly floor?: { readonly size_mm?: readonly number[] };
    readonly start?: { readonly x_mm?: number; readonly y_mm?: number; readonly yaw_deg?: number };
    readonly statics?: ReadonlyArray<{ id: string; pose: { position_mm: Num3; rpy_deg?: Num3 }; size_mm: Num3 }>;
    readonly tracks?: ReadonlyArray<{ id: string; closed?: boolean; points_mm: ReadonlyArray<readonly number[]>; width_mm?: number }>;
  };
}

function shapeOf(raw: { kind: string; [k: string]: unknown }): Shape | null {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v * MM : 0);
  if (raw.kind === 'box' && Array.isArray(raw.size_mm)) {
    const s = raw.size_mm as number[];
    return { kind: 'box', size: [n(s[0]), n(s[1]), n(s[2])] };
  }
  if (raw.kind === 'cylinder') return { kind: 'cylinder', radius: n(raw.radius_mm), height: n(raw.height_mm) };
  if (raw.kind === 'sphere') return { kind: 'sphere', radius: n(raw.radius_mm) };
  return null;
}

/** The arena a robot document describes: floor, walls, line tracks and the bodies' shapes, all in metres. */
export function arenaOf(doc: Project): ArenaSpec | null {
  const data = (doc.domains as { robotics?: { data?: RobotData } } | undefined)?.robotics?.data;
  const arena = data?.arena;
  if (!arena) return null;
  const size = arena.floor?.size_mm ?? [1800, 1200];
  const start = arena.start ?? {};
  const walls: Wall[] = (arena.statics ?? []).map((s) => ({
    id: s.id,
    x: (s.pose.position_mm[0] ?? 0) * MM,
    y: (s.pose.position_mm[1] ?? 0) * MM,
    z: (s.pose.position_mm[2] ?? 0) * MM,
    w: (s.size_mm[0] ?? 0) * MM,
    d: (s.size_mm[1] ?? 0) * MM,
    h: (s.size_mm[2] ?? 0) * MM,
    yaw: (s.pose.rpy_deg?.[2] ?? 0) * DEG,
  }));
  const tracks: TrackLine[] = (arena.tracks ?? []).map((t) => ({
    id: t.id,
    closed: !!t.closed,
    widthM: (t.width_mm ?? 19) * MM,
    points: t.points_mm.flatMap((p) => [(p[0] ?? 0) * MM, (p[1] ?? 0) * MM]),
  }));
  const bodies: BodySpec[] = [];
  for (const b of doc.mechanical?.bodies ?? []) {
    const shape = shapeOf(b.shape as { kind: string });
    if (shape) bodies.push({ id: b.id, shape, rolls: shape.kind === 'cylinder' || shape.kind === 'sphere' });
  }
  if (!bodies.length) return null;
  const chassis = bodies.find((b) => b.id === 'bdy_chassis') ?? bodies.find((b) => b.shape.kind === 'box') ?? bodies[0]!;
  return {
    width: (size[0] ?? 1800) * MM,
    depth: (size[1] ?? 1200) * MM,
    start: { x: (start.x_mm ?? 0) * MM, y: (start.y_mm ?? 0) * MM, yaw: (start.yaw_deg ?? 0) * DEG },
    walls,
    tracks,
    bodies,
    chassis: chassis.id,
  };
}

/** Where the arena stands: its centre in the room and the person's right and ahead directions at entry. */
export interface Placement {
  readonly cx: number;
  readonly cz: number;
  readonly floorY: number;
  readonly rx: number;
  readonly rz: number;
  readonly fx: number;
  readonly fz: number;
}

/** The arena level on the real floor, its near edge `ARENA_NEAR_M` ahead of the head and its width across the person. */
export function placeArena(arena: Pick<ArenaSpec, 'depth'>, head: { x: number; z: number; heading: { fx: number; fz: number } }, floorY = 0): Placement {
  const { fx, fz } = head.heading;
  const rx = -fz, rz = fx;
  const ahead = ARENA_NEAR_M + arena.depth / 2;
  return { cx: head.x + ahead * fx, cz: head.z + ahead * fz, floorY, rx, rz, fx, fz };
}

/** An arena point (x right, y ahead, z up) to the room, written into `out`. */
export function toRoom(p: Placement, x: number, y: number, z: number, out: [number, number, number]): [number, number, number] {
  out[0] = p.cx + x * p.rx + y * p.fx;
  out[1] = p.floorY + z;
  out[2] = p.cz + x * p.rz + y * p.fz;
  return out;
}

/** The yaw to give an object in arena coordinates so it faces the same way: arena yaw is counter-clockwise from +x. */
export const wrapPi = (a: number): number => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

/**
 * The poses of the arena's bodies, interpolated between the last two physics frames. A frame that arrives starts a glide
 * from the pose on show to it over the interval the frames were apart (a frame earlier in time snaps: Stop and Reset).
 * Everything is in preallocated arrays; `sample` writes `x, y, z, yaw` per body.
 */
export interface PoseTrack {
  readonly ids: readonly string[];
  /** x, y, z, yaw per body, in `ids` order. */
  readonly pose: Float32Array;
  /** Takes a frame that arrived at wall time `now` (seconds). Returns true when the sim clock went back (a restart). */
  push(frame: PhysicsFrame, now: number): boolean;
  /** Poses at wall time `now`. */
  sample(now: number): void;
  /** Sim seconds of the last frame. */
  readonly simS: number;
  readonly hasFrame: boolean;
}

const MAX_GLIDE_S = 0.4;
const MIN_GLIDE_S = 1 / 60;

export function createPoseTrack(specs: readonly BodySpec[], chassis: string): PoseTrack {
  const ids = specs.map((b) => b.id);
  const rollsFlag = specs.map((b) => b.rolls);
  const n = ids.length;
  const from = new Float32Array(n * 4);
  const to = new Float32Array(n * 4);
  const pose = new Float32Array(n * 4);
  const chassisAt = Math.max(0, ids.indexOf(chassis));
  const index = new Map(ids.map((id, i) => [id, i] as const));
  let t0 = 0, span = MIN_GLIDE_S, lastArrival = 0, lastNs = -1;
  let hasFrame = false;
  const track: PoseTrack = {
    ids,
    pose,
    get simS() {
      return lastNs / 1e9;
    },
    get hasFrame() {
      return hasFrame;
    },
    push(frame, now) {
      const restart = hasFrame && frame.atNs < lastNs;
      // where the glide stands now becomes the new start, so a frame in mid-glide does not jump
      if (hasFrame && !restart) {
        track.sample(now);
        from.set(pose);
      }
      const bodies = frame.bodies;
      for (const [id, i] of index) {
        const b = bodies[id];
        if (!b) continue;
        to[i * 4] = b.p[0];
        to[i * 4 + 1] = b.p[1];
        to[i * 4 + 2] = b.p[2];
        to[i * 4 + 3] = b.yawRad;
      }
      // rolling bodies' yaw is the roll about their axle once they turn; they ride the chassis heading
      const heading = to[chassisAt * 4 + 3]!;
      for (let i = 0; i < n; i++) if (ids[i] !== chassis && rollsFlag[i]) to[i * 4 + 3] = heading;
      if (!hasFrame || restart) {
        from.set(to);
        pose.set(to);
        span = MIN_GLIDE_S;
      } else {
        span = Math.min(MAX_GLIDE_S, Math.max(MIN_GLIDE_S, now - lastArrival));
      }
      t0 = now;
      lastArrival = now;
      lastNs = frame.atNs;
      hasFrame = true;
      return restart;
    },
    sample(now) {
      if (!hasFrame) return;
      const a = Math.min(1, Math.max(0, (now - t0) / span));
      for (let i = 0; i < n; i++) {
        const k = i * 4;
        pose[k] = from[k]! + (to[k]! - from[k]!) * a;
        pose[k + 1] = from[k + 1]! + (to[k + 1]! - from[k + 1]!) * a;
        pose[k + 2] = from[k + 2]! + (to[k + 2]! - from[k + 2]!) * a;
        pose[k + 3] = from[k + 3]! + wrapPi(to[k + 3]! - from[k + 3]!) * a;
      }
    },
  };
  return track;
}

/**
 * The trail of the chassis path: `TRAIL_POINTS` points at `TRAIL_HZ` in one preallocated buffer, and `dashes`, the
 * line segments of every other pair, refilled when a point is added so the dashes march with the path.
 */
export interface Trail {
  readonly positions: Float32Array;
  /** Segment end points (6 floats per dash): the dashed line to draw. */
  readonly dashes: Float32Array;
  readonly dashCount: number;
  /** Advances by `dt`, sampling at `TRAIL_HZ`. True when `dashes` changed. */
  tick(dt: number, x: number, y: number, z: number): boolean;
  reset(x: number, y: number, z: number): void;
}

export function createTrail(points = TRAIL_POINTS): Trail {
  const positions = new Float32Array(points * 3);
  const dashCount = Math.floor((points - 1) / 2);
  const dashes = new Float32Array(dashCount * 6);
  let acc = 0;
  let parity = 0;
  const fill = () => {
    for (let k = 0; k < dashCount; k++) {
      const a = (2 * k + parity) * 3;
      const b = a + 3;
      const o = k * 6;
      dashes[o] = positions[a]!;
      dashes[o + 1] = positions[a + 1]!;
      dashes[o + 2] = positions[a + 2]!;
      dashes[o + 3] = positions[b]!;
      dashes[o + 4] = positions[b + 1]!;
      dashes[o + 5] = positions[b + 2]!;
    }
  };
  return {
    positions,
    dashes,
    dashCount,
    tick(dt, x, y, z) {
      acc += dt;
      if (acc < 1 / TRAIL_HZ) return false;
      acc %= 1 / TRAIL_HZ;
      positions.copyWithin(0, 3);
      const e = (points - 1) * 3;
      positions[e] = x;
      positions[e + 1] = y;
      positions[e + 2] = z;
      parity ^= 1;
      fill();
      return true;
    },
    reset(x, y, z) {
      for (let i = 0; i < points; i++) {
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
      }
      acc = 0;
      parity = 0;
      fill();
    },
  };
}

/** The mech state in words: loading physics, ready, or failed with the reason. */
export function mechText(status: MechStatus | null, lang: Lang): string {
  if (!status) return S.t(lang, 'mechNone');
  if (status.state === 'loading-physics') return S.t(lang, 'mechLoading');
  if (status.state === 'ready') return S.t(lang, 'mechReady');
  return S.t(lang, 'mechFailed', { why: status.reason });
}

const RUN_KEYS = {
  idle: 'runIdle',
  running: 'runRunning',
  paused: 'runPaused',
  halted: 'runHalted',
  done: 'runDone',
  limit: 'runLimit',
  unloaded: 'runUnloaded',
  error: 'runError',
} as const satisfies Record<RunState, string>;

export const runText = (state: RunState, lang: Lang): string => S.t(lang, RUN_KEYS[state]);

/** The sensors' readings: `line 0.82 · dist 0.4`, at most `max` of them, numbers to two places. */
export function sensorText(sensors: PhysicsFrame['sensors'], max = 4): string {
  if (!sensors) return '';
  return Object.entries(sensors)
    .slice(0, max)
    .map(([k, v]) => `${k.replace(/^(sen|snr)_/, '')} ${typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : v}`)
    .join(' · ');
}

export interface ReadoutInput {
  readonly lang: Lang;
  readonly mech: MechStatus | null;
  readonly run: RunState;
  readonly simS: number;
  readonly sensors: PhysicsFrame['sensors'];
  /** The last thing that happened (a refused load), already a sentence; empty for none. */
  readonly message: string;
}

/** The readout's lines: physics state, run state and clock, sensors, the last message. */
export function readoutLines(i: ReadoutInput): string[] {
  const lines = [mechText(i.mech, i.lang), `${runText(i.run, i.lang)} · ${S.t(i.lang, 'clock', { s: i.simS.toFixed(1) })}`];
  const sensors = sensorText(i.sensors);
  lines.push(sensors ? S.t(i.lang, 'sensors', { list: sensors }) : S.t(i.lang, 'noSensors'));
  if (i.message) lines.push(i.message);
  return lines;
}
