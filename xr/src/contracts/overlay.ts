/**
 * The overlay layer: labels, highlights and pinned notes drawn on bench targets. Shared by the guide (highlights,
 * callouts), the fault lab (findings pinned on the offending part), tools (probe readouts) and scale mode. One layer so
 * two features never fight over the same anchor. Contract file: changes only in its own PR (label `contract-change`).
 *
 * Implementation: `xr/src/ui/overlay.ts` (`createOverlay`). Text is drawn to canvas textures by the browser's own
 * shaper, so Devanagari and Chinese render (docs/XR_ARCHITECTURE.md, "Text").
 */
import type { BoardTarget } from './space';
import type { Tone } from './lesson';
import type { Unsubscribe } from './common';

export interface OverlayItem {
  /** Who owns it (`guide`, `faults`, `tools`): `clear(owner)` removes all of an owner's items. */
  readonly owner: string;
  readonly target: BoardTarget;
  readonly tone: Tone;
  /** Already in the person's language. Empty for a highlight with no label. */
  readonly text?: string;
  /** `glow` outlines the target, `pin` draws a note on a stalk above it, `label` a flat tag. */
  readonly style: 'glow' | 'pin' | 'label';
}

export interface OverlayLayer {
  /** Shows an item; the returned function removes it. */
  show(item: OverlayItem): Unsubscribe;
  clear(owner: string): void;
}
