/**
 * The feedback of each run pillar event (docs/XR_DESIGN.md section 4): its controller haptic pattern and the sound it
 * plays. Pure data, tested in node. `feedback.ts` plays them.
 */

export type RunCue =
  | 'ui-hover'
  | 'ui-press'
  | 'run-start'
  | 'run-stop'
  | 'snap'
  | 'clip'
  | 'unclip'
  | 'short'
  | 'burnt'
  | 'check-pass'
  | 'check-fail'
  | 'invalid'
  | 'fault-in'
  | 'fault-out';

/** Continuous sounds: a part sizzling while hot, the meter's continuity beep. */
export type RunLoop = 'hot' | 'beep';

/** One buzz: intensity 0..1, duration ms, start offset ms. */
export type Buzz = readonly [intensity: number, ms: number, atMs: number];

/** The four sound buses of 11.2. */
export type Bus = 'interface' | 'bench' | 'simulation' | 'alerts';

export interface CueSpec {
  readonly haptic: readonly Buzz[];
  /** null: no sound (hover is silent). */
  readonly sound: SoundName | null;
  readonly bus: Bus;
}

export type SoundName = 'tap' | 'start' | 'stop' | 'tick' | 'click' | 'pluck' | 'zap' | 'pop' | 'rise' | 'fall' | 'thud' | 'sizzle' | 'beep';

export const CUES: Readonly<Record<RunCue, CueSpec>> = {
  'ui-hover': { haptic: [[0.08, 8, 0]], sound: null, bus: 'interface' },
  'ui-press': { haptic: [[0.35, 12, 0]], sound: 'tap', bus: 'interface' },
  'run-start': { haptic: [[0.3, 20, 0]], sound: 'start', bus: 'interface' },
  'run-stop': { haptic: [[0.3, 20, 0]], sound: 'stop', bus: 'interface' },
  snap: { haptic: [[0.25, 12, 0]], sound: 'tick', bus: 'bench' },
  clip: { haptic: [[0.6, 30, 0], [0.3, 15, 50]], sound: 'click', bus: 'bench' },
  unclip: { haptic: [[0.4, 20, 0]], sound: 'pluck', bus: 'bench' },
  short: { haptic: [[0.9, 120, 0]], sound: 'zap', bus: 'alerts' },
  burnt: { haptic: [[0.8, 150, 0]], sound: 'pop', bus: 'alerts' },
  'check-pass': { haptic: [[0.4, 25, 0], [0.6, 35, 100]], sound: 'rise', bus: 'alerts' },
  'check-fail': { haptic: [[0.5, 60, 0]], sound: 'fall', bus: 'alerts' },
  invalid: { haptic: [[0.5, 40, 0]], sound: 'thud', bus: 'bench' },
  'fault-in': { haptic: [[0.6, 30, 0], [0.3, 15, 50]], sound: 'click', bus: 'bench' },
  'fault-out': { haptic: [[0.4, 20, 0]], sound: 'pluck', bus: 'bench' },
};

export const LOOPS: Readonly<Record<RunLoop, { sound: SoundName; bus: Bus; gain: number }>> = {
  hot: { sound: 'sizzle', bus: 'simulation', gain: 0.2 },
  beep: { sound: 'beep', bus: 'simulation', gain: 0.35 },
};

/** Frequent events are the quietest, rare ones the strongest (section 4). Peak gain per sound, 0..1. */
export const GAIN: Readonly<Record<SoundName, number>> = {
  tick: 0.12,
  tap: 0.22,
  click: 0.3,
  pluck: 0.25,
  start: 0.3,
  stop: 0.3,
  thud: 0.35,
  rise: 0.35,
  fall: 0.35,
  zap: 0.6,
  pop: 0.6,
  sizzle: 0.2,
  beep: 0.35,
};
