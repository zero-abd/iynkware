/**
 * Controller flight, one frame (XR_DESIGN 8.3): the two thumbsticks to the flight model's sticks, A to arm and disarm,
 * B back to the pad.
 *
 * The input service rewrites one `{x, y}` view per hand on every `stick(hand)` call and touches it at no other time, so
 * the sticks are read here, every frame. A view kept from an earlier call goes stale: that is why the drone sat on the
 * pad on a Quest (the left stick, throttle and yaw, was never read again; the right one only moved because the zoom
 * flick happened to read it). The buttons are the service's live objects and could be kept, but are read here too.
 */
import type { Sticks } from '@/lib/flight';
import type { ButtonState, FaceButton, Hand } from '../../../contracts/input';
import { controllerSticks, type StickLayout, type ThumbStick } from './sticks';

/** The two parts of the input service controller flight reads. */
export interface PadSource {
  stick(hand: Hand): Readonly<ThumbStick>;
  button(hand: Hand, which: FaceButton): Readonly<Pick<ButtonState, 'down'>>;
}

/** What the controllers ask for this frame. One reused object (`newControllerFrame`). */
export interface ControllerFrame {
  readonly sticks: Sticks;
  /** A went down: arm, or disarm when armed. */
  arm: boolean;
  /** B went down: back to the pad. */
  reset: boolean;
}

export const newControllerFrame = (): ControllerFrame => ({ sticks: { throttle: 0.5, yaw: 0, pitch: 0, roll: 0 }, arm: false, reset: false });

/** The controller buttons of the room: A (right lower) arms and disarms, B (right upper) resets. */
export const ARM_BUTTON = { hand: 'right', which: 'lower' } as const satisfies { hand: Hand; which: FaceButton };
export const RESET_BUTTON = { hand: 'right', which: 'upper' } as const satisfies { hand: Hand; which: FaceButton };

/** Reads this frame's thumbsticks and buttons into `out` (mode `layout`, `expo` from `controllerExpo`). */
export function readController(src: PadSource, layout: StickLayout, expo: number, out: ControllerFrame): ControllerFrame {
  controllerSticks(src.stick('left'), src.stick('right'), layout, out.sticks, expo);
  out.arm = src.button(ARM_BUTTON.hand, ARM_BUTTON.which).down;
  out.reset = src.button(RESET_BUTTON.hand, RESET_BUTTON.which).down;
  return out;
}
