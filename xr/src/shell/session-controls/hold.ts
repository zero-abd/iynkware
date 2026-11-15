/**
 * The hold-to-confirm guard for Exit. A press must be kept down for `ms` before `onDone` runs, once: letting go early,
 * or the pointer leaving the button, cancels it and the ring empties. After it has fired it stays spent until every
 * pointer has let go, so one long press never fires twice. Several pointers (a hand and a controller) may hold; the
 * hold goes on while any is down. Time is fed in by `tick`, so it is tested without a clock.
 */
export interface HoldGuard {
  press(id: number): void;
  /** A pointer let go or left the button. */
  release(id: number): void;
  /** Advances by `dtMs`. Returns the progress, 0..1. */
  tick(dtMs: number): number;
  readonly progress: number;
  readonly holding: boolean;
}

export function createHold(ms: number, onDone: () => void): HoldGuard {
  const down = new Set<number>();
  let held = 0;
  let spent = false;
  return {
    press(id) {
      down.add(id);
    },
    release(id) {
      down.delete(id);
      if (down.size === 0) {
        held = 0;
        spent = false;
      }
    },
    tick(dtMs) {
      if (down.size === 0 || spent) return spent ? 1 : 0;
      held = Math.min(ms, held + dtMs);
      if (held >= ms) {
        spent = true;
        onDone();
      }
      return held / ms;
    },
    get progress() {
      return spent ? 1 : held / ms;
    },
    get holding() {
      return down.size > 0 && !spent;
    },
  };
}
