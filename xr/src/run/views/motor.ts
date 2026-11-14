/**
 * Motor views. A DC motor (`motor:` spin channel) turns its node at the reported rpm with a spin-up and a spin-down
 * lag; stalled or unpowered it winds down to rest. A stepper (`motor:` rotate channel) turns to the reported shaft
 * angle by the short way, eased. Only the channel's node moves.
 *
 * A real rotor at thousands of rpm would only strobe at 72 fps, so the drawn speed is the rpm squeezed through a soft
 * ceiling: faster still looks faster, never aliased into a crawl.
 */
import type { PartState, PartView, PartViewFactory } from '../../contracts/part-view';
import { rigOf, turnAbout } from './servo';

/** rpm to radians a second. */
export const rpmToRadPerS = (rpm: number): number => (rpm * 2 * Math.PI) / 60;

/** Time constants of the drawn rotor, seconds: a little brisker to speed up than to coast down. */
export const SPIN_UP_S = 0.25;
export const SPIN_DOWN_S = 0.45;
/** The fastest the rotor is drawn, radians a second (about 8 turns a second). */
export const VISUAL_MAX_RAD_PER_S = 50;

/** One step of a first-order lag of `omega` towards `target` over `dtSeconds`. */
export function spinStep(omega: number, target: number, dtSeconds: number): number {
  const tau = Math.abs(target) >= Math.abs(omega) ? SPIN_UP_S : SPIN_DOWN_S;
  return omega + (target - omega) * (1 - Math.exp(-Math.max(0, dtSeconds) / tau));
}

/** The speed to draw for a real speed: linear when slow, saturating towards the ceiling. Odd, so it keeps the sense. */
export function visualOmega(omega: number): number {
  return VISUAL_MAX_RAD_PER_S * Math.tanh(omega / VISUAL_MAX_RAD_PER_S);
}

/** The target rad/s of a motor state: nothing when stalled or unpowered. */
export function motorTarget(state: { rpm: number; stalled: boolean; powered: boolean }): number {
  return state.powered && !state.stalled ? rpmToRadPerS(state.rpm) : 0;
}

/** The signed way round from `from` to `to`, degrees, in (-180, 180]. */
export function shortWay(from: number, to: number): number {
  const d = (((to - from) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

/** One eased step of a stepper's drawn angle (degrees) towards the shaft angle by the short way. */
export function stepperStep(current: number, target: number, dtSeconds: number, tau = 0.06): number {
  const gap = shortWay(current, target);
  if (Math.abs(gap) < 0.05) return target;
  return current + gap * (1 - Math.exp(-Math.max(0, dtSeconds) / tau));
}

const TAU = Math.PI * 2;

export const motorView: PartViewFactory = (ctx): PartView => {
  const rig = rigOf(ctx.asset, ctx.object, 'motor:', ['spin']);
  // A spin channel's scale is +1 or -1: the sense about its axis.
  const sense = rig?.channel.scale ?? 1;
  let omega = 0;
  let target = 0;
  let angle = 0;
  return {
    partId: ctx.partId,
    update(state: PartState) {
      if (state.kind === 'motor') target = motorTarget(state);
    },
    tick(dt) {
      if (omega === 0 && target === 0) return;
      omega = spinStep(omega, target, dt);
      if (Math.abs(omega) < 1e-3 && target === 0) omega = 0;
      angle = (angle + sense * visualOmega(omega) * dt) % TAU;
      if (rig) turnAbout(rig, angle);
    },
    reset() {
      omega = target = angle = 0;
      if (rig) turnAbout(rig, 0);
    },
    dispose() {
      if (rig) turnAbout(rig, 0);
    },
  };
};

export const stepperView: PartViewFactory = (ctx): PartView => {
  const rig = rigOf(ctx.asset, ctx.object, 'motor:', ['rotate']);
  const { rest } = rig?.channel.value ?? { rest: 0 };
  const scale = rig?.channel.scale ?? Math.PI / 180;
  let current = rest;
  let target = rest;
  const show = () => {
    if (rig) turnAbout(rig, (current - rest) * scale);
  };
  return {
    partId: ctx.partId,
    update(state: PartState) {
      if (state.kind === 'stepper') target = state.angle;
    },
    tick(dt) {
      if (current === target) return;
      current = stepperStep(current, target, dt);
      show();
    },
    reset() {
      current = target = rest;
      show();
    },
    dispose() {
      current = target = rest;
      show();
    },
  };
};
