/**
 * The room flight's logic, with no three.js scene in it: how the craft is posed from a runner frame, which build flies
 * (the bench's or the factory's) and what refuses arming, the readout's text, and the short trail buffer.
 */
import type { DesignPick, DroneContent } from '@/content/schema';
import { canArm, type ArmRule } from '@/lib/dronelab/bench';
import type { BlockReason, CalcOutputs, CraftFaults } from '@/lib/flight';
import type { Project } from '@/project/generated/types';
import type { Lang } from '../../../contracts/common';
import { flightText } from '../../shared';
import type { CourseMap, Out3, RoomBlockReason, RunnerFrame } from '../core';
import { benchArmRules, benchCalc, benchFaults, benchOf, benchReport, pickOf } from '../model';
import { benchCraft } from '../model';
import { ROOM_STRINGS as S } from './strings';

const RAD = Math.PI / 180;

/** Where the craft goes in the world: position, Euler angles (order `YXZ`) and the uniform scale. */
export interface CraftPose {
  x: number;
  y: number;
  z: number;
  /** Radians about world +Y: the nose (+Z of the craft) along the course heading. */
  ry: number;
  /** Radians about the craft's left (+X): positive is nose down. */
  rx: number;
  /** Radians about the craft's nose (+Z): the left side down for a left bank, so minus the roll. */
  rz: number;
  scale: number;
}

export const newPose = (): CraftPose => ({ x: 0, y: 0, z: 0, ry: 0, rx: 0, rz: 0, scale: 1 });

const at: Out3 = [0, 0, 0];

/**
 * The craft's pose for a runner frame (docs: the drone asset's frame has the nose on +Z and the left on +X, so
 * `object.rotation.set(rx, ry, rz)` with Euler order `YXZ`). `span` is the sidecar's bounds width, course metres.
 */
export function craftPose(map: CourseMap, f: Readonly<RunnerFrame>, span: number, out: CraftPose): CraftPose {
  map.toRoom(f.x, f.y, f.z, at);
  out.x = at[0];
  out.y = at[1];
  out.z = at[2];
  out.ry = map.yawToWorld(f.yaw) + Math.PI / 2;
  out.rx = f.pitch * RAD;
  out.rz = -f.roll * RAD;
  out.scale = map.drawnScale(span);
  return out;
}

/** The rpm a prop channel spins at for a motor output 0..1 (idle just under a tenth of the sidecar's range). */
export const propRpm = (thr: number, armed: boolean, maxRpm = 44100): number => (armed ? maxRpm * (0.08 + 0.52 * Math.min(1, Math.max(0, thr))) : 0);

export type BuildSource = 'bench' | 'factory';

export interface FlyingBuild {
  readonly source: BuildSource;
  readonly calc: CalcOutputs;
  readonly faults: CraftFaults;
  readonly rules: readonly ArmRule[];
  /** The first rule that blocks arming, or null. The flight model's own refusals come on top at A. */
  readonly refusal: ArmRule | null;
}

/** The first blocking rule that is not met, or null when the build may arm. */
export function firstBlocking(rules: readonly ArmRule[]): ArmRule | null {
  if (canArm(rules as ArmRule[])) return null;
  return rules.find((r) => r.level === 'block' && !r.ok) ?? null;
}

/**
 * The build that flies: the bench build when it is complete (its faults fly, its arming rules refuse), else the factory
 * build (every part right, no faults).
 */
export function buildThatFlies(content: DroneContent, doc: Project): FlyingBuild {
  const pick: DesignPick = pickOf(doc, content);
  const craft = benchCraft(content.id);
  const report = craft ? benchReport(craft, benchOf(doc)) : null;
  if (report?.built) {
    const rules = benchArmRules(content, report, pick);
    return { source: 'bench', calc: benchCalc(content, pick), faults: benchFaults(content, report, pick), rules, refusal: firstBlocking(rules) };
  }
  return { source: 'factory', calc: benchCalc(content, pick), faults: {}, rules: [], refusal: null };
}

const RULE_KEY = {
  built: 'ruleBuilt',
  capFault: 'ruleCapFault',
  smoke: 'ruleSmoke',
  motors: 'ruleMotors',
  acc: 'ruleAcc',
  mistakes: 'ruleMistakes',
} as const;

/** Why a rule refuses arming, in `lang`. */
export function ruleReason(rule: Pick<ArmRule, 'id'>, lang: Lang): string {
  const key = (RULE_KEY as Record<string, (typeof RULE_KEY)[keyof typeof RULE_KEY]>)[rule.id];
  return S.t(lang, key ?? 'ruleBuilt');
}

const BLOCK_KEY: Record<RoomBlockReason, 'blockCrashed' | 'blockAir' | 'blockThrottle' | 'blockBattery' | 'blockAcc' | 'blockSticks'> = {
  crashed: 'blockCrashed',
  air: 'blockAir',
  throttle: 'blockThrottle',
  battery: 'blockBattery',
  acc: 'blockAcc',
  sticks: 'blockSticks',
};

/** Arming refused by the runner (the flight model's reason, or the sticks not centred), as a sentence. */
export function refusedText(why: RoomBlockReason | BlockReason, lang: Lang): string {
  return S.t(lang, 'refused', { why: S.t(lang, BLOCK_KEY[why]) });
}

export const refusedByRule = (rule: Pick<ArmRule, 'id'>, lang: Lang): string => S.t(lang, 'refused', { why: ruleReason(rule, lang) });

/** `12.34` seconds as shown: two decimals. */
export const seconds = (s: number): string => s.toFixed(2);

export interface ReadoutInput {
  readonly lang: Lang;
  /** iynk's `flight` namespace (`modes.*`, `hit.*`), when loaded. */
  readonly flight: Readonly<Record<string, unknown>>;
  readonly source: BuildSource;
  readonly mode: string;
  readonly perCell: number;
  readonly low: boolean;
  /** Index of the next gate and the gates in the course (0: none). */
  readonly gate: number;
  readonly gates: number;
  /** Seconds into the lap, or null before it starts. */
  readonly lap: number | null;
  /** The last thing that happened, already a sentence. */
  readonly message: string;
}

/** The mode's title: iynk's `modes.<id>` where it has one, else the id. */
export function modeTitle(flight: ReadoutInput['flight'], mode: string): string {
  const text = flightText(flight, `modes.${mode}`);
  return text === `modes.${mode}` ? mode : text;
}

/** The readout's lines: the build and mode, the battery, the gate and the lap, the last event. */
export function readoutLines(i: ReadoutInput): string[] {
  const v = i.perCell.toFixed(2);
  return [
    `${S.t(i.lang, i.source === 'bench' ? 'bench' : 'factory')} · ${S.t(i.lang, 'mode', { mode: modeTitle(i.flight, i.mode) })}`,
    S.t(i.lang, i.low ? 'batteryLow' : 'battery', { v }),
    i.gates > 0 ? S.t(i.lang, 'gate', { n: Math.min(i.gates, i.gate + 1), total: i.gates }) : S.t(i.lang, 'noGate'),
    i.lap === null ? S.t(i.lang, 'noLap') : S.t(i.lang, 'lap', { time: i.lap.toFixed(1) }),
    i.message,
  ];
}

/** The crash reason: iynk's `hit.<why>`, else a plain sentence. */
export function crashText(flight: ReadoutInput['flight'], why: string, lang: Lang): string {
  const hit = flightText(flight, `hit.${why}`);
  return hit === `hit.${why}` ? S.t(lang, 'crashedPlain') : S.t(lang, 'crashed', { why: hit });
}

/** Trail points: 2 s of the craft's path, sampled at `TRAIL_HZ`, in one preallocated buffer. */
export const TRAIL_S = 2;
export const TRAIL_HZ = 15;
export const TRAIL_POINTS = TRAIL_S * TRAIL_HZ;

export interface Trail {
  /** x, y, z per point, oldest first; every point is the craft's start until it has moved. */
  readonly positions: Float32Array;
  /** Advances by `dt`; samples the craft at `TRAIL_HZ`. Returns true when the buffer changed. */
  tick(dt: number, x: number, y: number, z: number): boolean;
  /** Collapses the trail onto one point. */
  reset(x: number, y: number, z: number): void;
}

export function createTrail(points = TRAIL_POINTS): Trail {
  const positions = new Float32Array(points * 3);
  let acc = 0;
  return {
    positions,
    tick(dt, x, y, z) {
      acc += dt;
      if (acc < 1 / TRAIL_HZ) return false;
      acc %= 1 / TRAIL_HZ;
      positions.copyWithin(0, 3);
      const e = (points - 1) * 3;
      positions[e] = x;
      positions[e + 1] = y;
      positions[e + 2] = z;
      return true;
    },
    reset(x, y, z) {
      for (let i = 0; i < points; i++) {
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
      }
      acc = 0;
    },
  };
}
