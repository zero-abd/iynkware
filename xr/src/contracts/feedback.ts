/**
 * Feedback: the event table of docs/XR_DESIGN.md section 4, shared by every pillar, so a seat sounds and buzzes the same
 * wherever it happens. Contract file: changes only in its own PR (label `contract-change`).
 *
 * Implementation: `xr/src/ui/feedback/` (`createFeedbackService`).
 */
import type { Vec3 } from './common';
import type { Hand } from './input';

/** The events of the design's table, in its words. */
export type FeedbackEvent =
  | 'hover-grabbable'
  | 'hover-ui'
  | 'hover-cell'
  | 'snap'
  | 'seat'
  | 'pull'
  | 'wire'
  | 'undo'
  | 'invalid'
  | 'ui-press'
  | 'short'
  | 'hot'
  | 'burnt'
  | 'check-pass'
  | 'check-fail'
  | 'run-start'
  | 'run-stop';

export interface FeedbackService {
  /**
   * One event at a world point, caused by `hand` (null or omitted: the mouse, or no hand). Plays the controller haptic
   * pattern through `input.pulse`, a pop ring at `at` for a hand (and for any committed event with a point while sound
   * is off), and the event's short positional sound on its bus. Follows the headset settings (sound, bus volumes, mono,
   * reduced motion) and stays silent while the system overlay is up. Never throws.
   */
  play(event: FeedbackEvent, at?: Vec3 | null, hand?: Hand | null): void;
}
