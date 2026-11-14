/**
 * The shared feedback service (contracts/feedback.ts): one call per event plays the design's haptic pattern on the
 * controller that caused it, the pop ring at the contact point for a hand (or for anyone while sound is off), and the
 * event's sound on its bus. Settings are read when an event plays, so a change in the menu applies to the next event.
 */
import { VisibilityState, type Object3D } from '@iwsdk/core';
import type { ReadonlyValue, Vec3 } from '../../contracts/common';
import type { FeedbackEvent, FeedbackService } from '../../contracts/feedback';
import type { Hand, InputService } from '../../contracts/input';
import type { SettingsStore } from '../../contracts/settings';
import { createSynth, type Synth } from './sound';
import { GAIN, SNAP_MIN_GAP_MS, specOf } from './table';

export { FEEDBACK, ALIASES, GAIN, SNAP_MIN_GAP_MS, specOf, type FeedbackSpec, type Pulse, type SoundName } from './table';
export { createSynth, type Synth } from './sound';

export interface FeedbackDeps {
  readonly world: { readonly camera: Object3D; readonly visibilityState: ReadonlyValue<VisibilityState> };
  readonly input: Pick<InputService, 'pulse' | 'sources'>;
  readonly settings: Pick<SettingsStore, 'xr'>;
  /** Draws the pop ring at a world point (the look kit's shared effects in the app). Without it, no ring. */
  readonly ring?: (at: Vec3) => void;
  /** Default: WebAudio synthesis, listening from `world.camera`. */
  readonly synth?: Synth;
  /** Milliseconds, for the snap rate. Default `performance.now`. */
  readonly now?: () => number;
}

export interface FeedbackServiceImpl extends FeedbackService {
  dispose(): void;
}

export function createFeedbackService(deps: FeedbackDeps): FeedbackServiceImpl {
  const synth = deps.synth ?? createSynth(() => deps.world.camera);
  const now = deps.now ?? (() => performance.now());
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let lastSnap = -Infinity;
  let disposed = false;

  const buzz = (hand: Hand, intensity: number, ms: number, atMs: number) => {
    if (atMs <= 0) return deps.input.pulse(hand, intensity, ms);
    const t = setTimeout(() => {
      timers.delete(t);
      if (!disposed) deps.input.pulse(hand, intensity, ms);
    }, atMs);
    timers.add(t);
  };

  return {
    play(event: FeedbackEvent, at?: Vec3 | null, hand?: Hand | null) {
      if (disposed) return;
      try {
        const spec = specOf(event);
        if (!spec) return;
        if (hand) for (const p of spec.haptic) buzz(hand, p.intensity, p.ms, p.atMs);

        const xr = deps.settings.xr.value;
        const blurred = deps.world.visibilityState.value === VisibilityState.VisibleBlurred;
        if (spec.sound && xr.sound && !blurred) {
          const t = now();
          const throttled = event === 'snap' && t - lastSnap < SNAP_MIN_GAP_MS;
          if (!throttled) {
            if (event === 'snap') lastSnap = t;
            const level = GAIN[spec.sound] * (xr.volumes[spec.bus] ?? 1);
            synth.play(spec.sound, level, at ?? null, xr.monoSound);
          }
        }

        // Hands have no haptics: a committed event shows a pop ring at the contact point, and so does every committed
        // event while sound is off (the ring and the ticker carry it). Hover commits nothing.
        const isHand = !!hand && deps.input.sources.value[hand] === 'hand';
        if (at && spec.commits && !blurred && (isHand || !xr.sound)) deps.ring?.(at);
      } catch {
        // Feedback never breaks the action that caused it.
      }
    },
    dispose() {
      disposed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      synth.dispose();
    },
  };
}
