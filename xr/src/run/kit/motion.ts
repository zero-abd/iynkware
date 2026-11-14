/**
 * Motion for the run pillar: durations from docs/XR_DESIGN.md section 4, an ease, and an animated scalar that eases
 * towards a target on the run ticker. Under reduced motion (11.2) moves become instant; fades stay, at most 150 ms.
 *
 * Adapter: the look kit (`xr/src/look`) will own the motion presets; switch to them when they land and keep the names.
 */
import type { World } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { onTick } from './ticker';

/** Milliseconds. */
export const MOTION = {
  /** Hover on within a frame, off over 80 ms. */
  hoverOff: 80,
  /** A plate sinks 3 dmm and fills (UI press). */
  press: 60,
  release: 80,
  /** A state change of a control (Run turning into Pause, a badge appearing). */
  state: 150,
  fade: 150,
  /** A tool sliding to its slot, a part turning to face you. */
  settle: 200,
} as const;

export function easeOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) * (1 - c) * (1 - c);
}

/** Reduced motion: the headset's own setting when the shell adds it (#17), else the 2D app's. */
export function reducedMotion(app: Pick<XrApp, 'settings'>): boolean {
  const xr = app.settings.xr.value as unknown as { reducedMotion?: boolean };
  if (typeof xr.reducedMotion === 'boolean') return xr.reducedMotion;
  return app.settings.shared.value.reduceMotion === true;
}

export interface Animated {
  readonly value: number;
  /** Eases from the current value to `target` over `ms` (0, or reduced motion for a move: at once). */
  to(target: number, ms: number): void;
  /** Jumps. */
  set(value: number): void;
  dispose(): void;
}

/**
 * A number that eases towards its target, calling `apply` on every frame while it moves and once when it lands.
 * `kind` `move` jumps under reduced motion; `fade` keeps its fade, capped at 150 ms.
 */
export function animated(
  app: Pick<XrApp, 'world' | 'settings'>,
  initial: number,
  apply: (value: number) => void,
  kind: 'move' | 'fade' = 'move',
): Animated {
  let value = initial;
  let from = initial;
  let target = initial;
  let total = 0;
  let elapsed = 0;
  let off: Unsubscribe | null = null;
  const world: World = app.world;
  const stop = () => {
    off?.();
    off = null;
  };
  const step = (dt: number) => {
    elapsed += dt * 1000;
    const t = total <= 0 ? 1 : elapsed / total;
    value = t >= 1 ? target : from + (target - from) * easeOut(t);
    apply(value);
    if (t >= 1) stop();
  };
  apply(value);
  return {
    get value() {
      return value;
    },
    to(next, ms) {
      if (next === target && (off || value === next)) return;
      const reduce = reducedMotion(app);
      const duration = reduce ? (kind === 'move' ? 0 : Math.min(ms, MOTION.fade)) : ms;
      from = value;
      target = next;
      total = duration;
      elapsed = 0;
      if (duration <= 0) {
        stop();
        value = next;
        apply(value);
        return;
      }
      off ??= onTick(world, step);
    },
    set(next) {
      stop();
      value = target = from = next;
      apply(value);
    },
    dispose: stop,
  };
}
