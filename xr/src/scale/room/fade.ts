/**
 * The Room size fade as a pure state machine. One progress `p` runs 0 (bench) to 1 (room). Going in, the bench fades
 * out over `outMs` and then the room copy fades in over `inMs`; going back is the same run in reverse, from wherever
 * `p` is, so a change of mind mid-fade turns round without a jump. Nothing here scales or moves anything.
 */
export interface FadeTimes {
  /** The bench fading out (and, going back, in). */
  readonly outMs: number;
  /** The room copy fading in (and, going back, out). */
  readonly inMs: number;
}

export interface FadeState {
  /** 0 bench .. 1 room. */
  readonly p: number;
  /** 1 target is the room, 0 the bench. */
  readonly target: 0 | 1;
  /** Opacity of the bench content, 0..1. */
  readonly bench: number;
  /** Opacity of the room copy, 0..1. */
  readonly room: number;
  /** True while `p` is not at its target. */
  readonly moving: boolean;
}

export interface RoomFade {
  readonly state: FadeState;
  /** Sets where the fade goes; the progress keeps its value. */
  go(target: 0 | 1): void;
  /** Jumps to the end at once (the session ended). */
  snap(target: 0 | 1): void;
  /** Changes the times, keeping the progress as the same point of the run (reduced motion toggled). */
  setTimes(times: FadeTimes): void;
  step(dtMs: number): FadeState;
}

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const smooth = (x: number): number => x * x * (3 - 2 * x);

export function createFade(times: FadeTimes, start: 0 | 1 = 0): RoomFade {
  let t = times;
  let p: number = start;
  let target: 0 | 1 = start;

  const derive = (): FadeState => {
    const total = Math.max(1, t.outMs + t.inMs);
    const split = t.outMs / total;
    const bench = 1 - smooth(split <= 0 ? (p > 0 ? 1 : 0) : clamp01(p / split));
    const room = smooth(split >= 1 ? (p >= 1 ? 1 : 0) : clamp01((p - split) / (1 - split)));
    return { p, target, bench, room, moving: p !== target };
  };
  let state = derive();

  return {
    get state() {
      return state;
    },
    go(next) {
      target = next;
      state = derive();
    },
    snap(next) {
      target = next;
      p = next;
      state = derive();
    },
    setTimes(next) {
      t = next;
      state = derive();
    },
    step(dtMs) {
      if (p !== target) {
        const total = Math.max(1, t.outMs + t.inMs);
        const d = Math.max(0, dtMs) / total;
        p = target > p ? Math.min(target, p + d) : Math.max(target, p - d);
      }
      state = derive();
      return state;
    },
  };
}
