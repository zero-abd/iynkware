/**
 * The first-flight hint's logic, free of three.js: which line it shows for the arming state and the input in use, and
 * that it goes for good at the first take-off of a visit to the Range.
 */
import type { PointerSource } from '../../../contracts/input';

/** `arm` before arming, `takeoff` once armed and still on the pad, null after the first take-off. */
export type HintStep = 'arm' | 'takeoff';
export type HintInput = 'controller' | 'hand';

/** Hands read the hand line as soon as either side is a tracked hand; anything else reads the controller line. */
export function hintInput(sources: Readonly<Record<'left' | 'right', PointerSource | null>>): HintInput {
  return sources.left === 'hand' || sources.right === 'hand' ? 'hand' : 'controller';
}

/** The string key for a step and input. */
export function hintKey(step: HintStep, input: HintInput): 'armController' | 'takeoffController' | 'armHand' | 'takeoffHand' {
  if (step === 'arm') return input === 'hand' ? 'armHand' : 'armController';
  return input === 'hand' ? 'takeoffHand' : 'takeoffController';
}

/** Shown until the craft is first airborne, then never again in this flight. */
export class FirstFlightHint {
  private flown = false;
  get done(): boolean {
    return this.flown;
  }
  /** The step to show for this frame's runner state, or null once the craft has taken off. */
  step(armed: boolean, airborne: boolean): HintStep | null {
    if (this.flown) return null;
    if (airborne) {
      this.flown = true;
      return null;
    }
    return armed ? 'takeoff' : 'arm';
  }
}
