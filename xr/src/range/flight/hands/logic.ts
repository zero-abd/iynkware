/**
 * The hand flight's logic, free of three.js: the hold-to-arm timer, the pinch to `GimbalPinch` glue, the stick claim
 * lifecycle and the guide target mapping. Nothing here allocates after construction.
 */
import { VIRTUAL_STICK_FULL_M, type Heading } from '../../../input/helpers';
import type { FreeHold } from '../../../contracts/input';
import { clampTarget, type GimbalPinch, type Out3 } from '../core';

/** How long the Arm plate is held before it arms (XR_DESIGN 8.3), milliseconds. */
export const ARM_HOLD_MS = 600;

/** Hold to arm: arms once after `holdMs` held; an early release does nothing; the next press starts over. */
export class HoldTimer {
  held = false;
  private ms = 0;
  private done = false;
  constructor(readonly holdMs: number = ARM_HOLD_MS) {}
  press(): void {
    this.held = true;
    this.ms = 0;
    this.done = false;
  }
  release(): void {
    this.held = false;
    this.ms = 0;
    this.done = false;
  }
  /** Advances by `dtMs`; true exactly once, on the tick the hold completes. */
  tick(dtMs: number): boolean {
    if (!this.held || this.done) return false;
    this.ms += dtMs;
    if (this.ms < this.holdMs) return false;
    this.done = true;
    return true;
  }
  /** 0..1 in steps of 1/20, for the plate's filling ring (a step is a redraw). */
  get progress(): number {
    if (!this.held) return 0;
    return Math.min(1, Math.round((this.ms / this.holdMs) * 20) / 20);
  }
  get fired(): boolean {
    return this.done;
  }
}

/** One hand's free pinch as the `GimbalPinch` that `handSticks` reads: origin fixed at the start, point following. */
export class PinchTrack {
  active = false;
  /** True on the one `update` that saw the pinch begin. */
  began = false;
  readonly origin: [number, number, number] = [0, 0, 0];
  readonly point: [number, number, number] = [0, 0, 0];
  readonly pinch: GimbalPinch;
  constructor(heading: Heading) {
    this.pinch = { origin: this.origin, point: this.point, heading };
  }
  /** The pinch while a free pinch (not a grip) is held, else null (a lost hand reads as let go). */
  update(hold: FreeHold | null): GimbalPinch | null {
    this.began = false;
    if (!hold || hold.by !== 'pinch') {
      this.active = false;
      return null;
    }
    if (!this.active) {
      this.active = true;
      this.began = true;
      this.origin[0] = hold.start[0];
      this.origin[1] = hold.start[1];
      this.origin[2] = hold.start[2];
    }
    this.point[0] = hold.position[0];
    this.point[1] = hold.position[1];
    this.point[2] = hold.position[2];
    return this.pinch;
  }
}

/** Claims something while `want` is true and releases it when it is not, once each. */
export class ClaimGate {
  private release: (() => void) | null = null;
  constructor(private readonly claim: () => () => void) {}
  get claimed(): boolean {
    return this.release !== null;
  }
  set(want: boolean): void {
    if (want && !this.release) this.release = this.claim();
    else if (!want && this.release) {
      const r = this.release;
      this.release = null;
      r();
    }
  }
}

/** A ring's plane offset in metres, `a` to the person's right, `b` up (left hand) or away (right hand), capped at full. */
export function ringOffset(p: GimbalPinch, hand: 'left' | 'right', out: { a: number; b: number }): { a: number; b: number } {
  const dx = p.point[0] - p.origin[0], dy = p.point[1] - p.origin[1], dz = p.point[2] - p.origin[2];
  const a = dx * -p.heading.fz + dz * p.heading.fx;
  const b = hand === 'left' ? dy : dx * p.heading.fx + dz * p.heading.fz;
  const len = Math.hypot(a, b);
  const s = len > VIRTUAL_STICK_FULL_M ? VIRTUAL_STICK_FULL_M / len : 1;
  out.a = a * s;
  out.b = b * s;
  return out;
}

/** The part of a course map the guide needs. */
export interface GuideMap {
  toCourse(wx: number, wy: number, wz: number, out: Out3): Out3;
  toRoom(x: number, y: number, z: number, out: Out3): Out3;
  readonly field: number;
  readonly ceiling: number;
}

/**
 * The guide target for a drag: the craft's world position when the drag began plus the hand's offset since, mapped to
 * the course and clamped inside the field. Writes the course point into `course` and the clamped point back in the
 * room into `world`.
 */
export function guideTarget(
  map: GuideMap,
  craft: Readonly<Out3>,
  handStart: Readonly<Out3>,
  handNow: Readonly<Out3>,
  course: Out3,
  world: Out3,
): void {
  map.toCourse(craft[0] + handNow[0] - handStart[0], craft[1] + handNow[1] - handStart[1], craft[2] + handNow[2] - handStart[2], course);
  clampTarget(course[0], course[1], course[2], map.field, map.ceiling, course);
  map.toRoom(course[0], course[1], course[2], world);
}
