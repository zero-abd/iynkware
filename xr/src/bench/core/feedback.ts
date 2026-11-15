/**
 * Bench feedback, the event table of XR_DESIGN.md section 4. Every bench sub-module reports committed events here and
 * never pulses or plays sounds itself: `play` goes to the shared `app.feedback` (controller haptic, pop ring at the
 * contact point for hands, the event's positional sound), or to the haptics alone where an app has no feedback service.
 */
import type { XrApp } from '../../contracts/app';
import type { Vec3 } from '../../contracts/common';
import type { Hand } from '../../contracts/input';

/** Bench events of the design's table (section 4), in its words. */
export type BenchEvent =
  | 'hover-grabbable'
  | 'hover-ui'
  | 'hover-cell'
  | 'snap'
  | 'seat'
  | 'pull'
  | 'wire'
  | 'undo'
  | 'invalid'
  | 'ui-press';

/** One buzz: intensity 0..1, length ms, start offset ms. A two-part pattern is two pulses. */
export interface Pulse {
  readonly at: number;
  readonly intensity: number;
  readonly ms: number;
}

/** The controller haptic column of the design's table. Hands get the pop ring instead. */
export const HAPTICS: Readonly<Record<BenchEvent, readonly Pulse[]>> = {
  'hover-grabbable': [{ at: 0, intensity: 0.08, ms: 8 }],
  'hover-ui': [{ at: 0, intensity: 0.08, ms: 8 }],
  'hover-cell': [],
  snap: [{ at: 0, intensity: 0.25, ms: 12 }],
  seat: [
    { at: 0, intensity: 0.6, ms: 30 },
    { at: 50, intensity: 0.3, ms: 15 },
  ],
  pull: [{ at: 0, intensity: 0.4, ms: 20 }],
  wire: [{ at: 0, intensity: 0.5, ms: 25 }],
  undo: [{ at: 0, intensity: 0.3, ms: 15 }],
  invalid: [{ at: 0, intensity: 0.5, ms: 40 }],
  'ui-press': [{ at: 0, intensity: 0.35, ms: 12 }],
};

export interface BenchFeedback {
  /** A committed or hover event at a world point, by the hand that caused it (null: the mouse or no hand). */
  play(event: BenchEvent, at?: Vec3 | null, hand?: Hand | null): void;
  /** One line on the rail naming the last event ("Wire joined D13 to row 10"); already in the person's language. */
  ticker(text: string): void;
  /** The rail draws the ticker line: it registers here (the last sink wins) and is called for every `ticker` text. */
  onTicker(sink: (text: string) => void): () => void;
  dispose(): void;
}

/** The haptic part of the table over `app.input.pulse` (a no-op on hands). */
export function playHaptics(app: Pick<XrApp, 'input'>, event: BenchEvent, hand: Hand | null | undefined): void {
  if (!hand) return;
  for (const p of HAPTICS[event]) {
    if (p.at === 0) app.input.pulse(hand, p.intensity, p.ms);
    else setTimeout(() => app.input.pulse(hand, p.intensity, p.ms), p.at);
  }
}

/**
 * The shared feedback service (`app.feedback`: haptic, pop ring for hands, positional sound) when the app has one, else
 * haptics only. The ticker line is drawn by the rail module (`bench/rail`).
 */
export function createBenchFeedback(app: Pick<XrApp, 'input'> & Partial<Pick<XrApp, 'feedback'>>): BenchFeedback {
  const shared = app.feedback;
  const sinks: Array<(text: string) => void> = [];
  return {
    play: (event, at, hand) => (shared ? shared.play(event, at, hand) : playHaptics(app, event, hand)),
    ticker: (text) => sinks[sinks.length - 1]?.(text),
    onTicker(sink) {
      sinks.push(sink);
      return () => {
        const i = sinks.lastIndexOf(sink);
        if (i >= 0) sinks.splice(i, 1);
      };
    },
    dispose: () => undefined,
  };
}
