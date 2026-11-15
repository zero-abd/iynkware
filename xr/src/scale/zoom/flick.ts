/** Thumbstick flick: forward past 0.7 and back under 0.3 is one step up, back is one step down (pure). */
export const FLICK_OUT = 0.7;
export const FLICK_IN = 0.3;

export interface FlickState {
  /** 0 at rest, else the direction of the flick in progress (+1 larger). */
  dir: 0 | 1 | -1;
}

export const newFlick = (): FlickState => ({ dir: 0 });

/** Feeds the stick's y (-1 is forward). Returns the step to take (+1 larger, -1 smaller) when a flick completes, else 0. */
export function flickStep(s: FlickState, y: number): 0 | 1 | -1 {
  const v = -y;
  if (s.dir === 0) {
    if (v > FLICK_OUT) s.dir = 1;
    else if (v < -FLICK_OUT) s.dir = -1;
    return 0;
  }
  if (Math.abs(v) < FLICK_IN) {
    const d = s.dir;
    s.dir = 0;
    return d;
  }
  return 0;
}

export function resetFlick(s: FlickState): void {
  s.dir = 0;
}
