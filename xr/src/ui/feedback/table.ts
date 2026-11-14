/**
 * The event table of docs/XR_DESIGN.md section 4 as data: each event's controller haptic pattern, its sound and the
 * sound bus it plays on. Frequent events (hover, snap) are the quietest, rare ones (short, burnt) the strongest.
 */
import type { FeedbackEvent } from '../../contracts/feedback';
import type { SoundBus } from '../../contracts/settings';

/** The short synthesized sounds (no files, nothing fetched). */
export type SoundName = 'tap' | 'tick' | 'click' | 'pluck' | 'plug' | 'zap' | 'pop' | 'rise' | 'fall' | 'start' | 'stop' | 'whoosh' | 'thud';

/** One buzz: intensity 0..1, length ms, start offset ms. A two-part pattern is two pulses. */
export interface Pulse {
  readonly intensity: number;
  readonly ms: number;
  readonly atMs: number;
}

export interface FeedbackSpec {
  readonly haptic: readonly Pulse[];
  /** Null: silent (hover is silent). */
  readonly sound: SoundName | null;
  readonly bus: SoundBus;
  /** It commits something, so a hand gets a pop ring at the contact point. Hover does not. */
  readonly commits: boolean;
}

const p = (intensity: number, ms: number, atMs = 0): Pulse => ({ intensity, ms, atMs });

export const FEEDBACK: Readonly<Record<FeedbackEvent, FeedbackSpec>> = {
  'hover-grabbable': { haptic: [p(0.08, 8)], sound: null, bus: 'interface', commits: false },
  'hover-ui': { haptic: [p(0.08, 8)], sound: null, bus: 'interface', commits: false },
  'hover-cell': { haptic: [], sound: null, bus: 'interface', commits: false },
  snap: { haptic: [p(0.25, 12)], sound: 'tick', bus: 'bench', commits: false },
  seat: { haptic: [p(0.6, 30), p(0.3, 15, 50)], sound: 'click', bus: 'bench', commits: true },
  pull: { haptic: [p(0.4, 20)], sound: 'pluck', bus: 'bench', commits: true },
  wire: { haptic: [p(0.5, 25)], sound: 'plug', bus: 'bench', commits: true },
  undo: { haptic: [p(0.3, 15)], sound: 'whoosh', bus: 'interface', commits: true },
  invalid: { haptic: [p(0.5, 40)], sound: 'thud', bus: 'bench', commits: true },
  'ui-press': { haptic: [p(0.35, 12)], sound: 'tap', bus: 'interface', commits: true },
  short: { haptic: [p(0.9, 120)], sound: 'zap', bus: 'alerts', commits: true },
  hot: { haptic: [p(0.15, 10)], sound: null, bus: 'simulation', commits: false },
  burnt: { haptic: [p(0.8, 150)], sound: 'pop', bus: 'alerts', commits: true },
  'check-pass': { haptic: [p(0.4, 25), p(0.6, 35, 100)], sound: 'rise', bus: 'alerts', commits: true },
  'check-fail': { haptic: [p(0.5, 60)], sound: 'fall', bus: 'alerts', commits: true },
  'run-start': { haptic: [p(0.3, 20)], sound: 'start', bus: 'interface', commits: true },
  'run-stop': { haptic: [p(0.3, 20)], sound: 'stop', bus: 'interface', commits: true },
};

/**
 * The run pillar's own cue names (`xr/src/run/kit/cues.ts`), which its adapter forwards once `app.feedback` exists:
 * each maps to the table event that sounds and buzzes the same, so nothing goes quiet when it switches.
 */
export const ALIASES: Readonly<Record<string, FeedbackEvent>> = {
  'ui-hover': 'hover-ui',
  clip: 'seat',
  unclip: 'pull',
  'fault-in': 'seat',
  'fault-out': 'pull',
};

/** The table entry for an event or an alias, or undefined for an unknown name. */
export function specOf(event: string): FeedbackSpec | undefined {
  const key = (Object.hasOwn(FEEDBACK, event) ? event : ALIASES[event]) as FeedbackEvent | undefined;
  return key ? FEEDBACK[key] : undefined;
}

/** The sound's level before the bus volume, so hover and snap stay quiet and short and burnt stand out. */
export const GAIN: Readonly<Record<SoundName, number>> = {
  tick: 0.12,
  tap: 0.22,
  whoosh: 0.22,
  pluck: 0.25,
  click: 0.3,
  plug: 0.3,
  start: 0.3,
  stop: 0.3,
  thud: 0.35,
  rise: 0.35,
  fall: 0.35,
  zap: 0.6,
  pop: 0.6,
};

/** At most 12 snap ticks a second (section 4). */
export const SNAP_MIN_GAP_MS = 1000 / 12;
