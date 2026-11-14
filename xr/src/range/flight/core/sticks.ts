/**
 * Quest thumbsticks to the flight model's RC channels (XR_DESIGN 3.3, 8.3).
 *
 * The thumbsticks are `{x, y}` in -1..1 with y = -1 pushed forward, as `app.input.stick(hand)` returns them. The
 * channels mean what they mean in iynk's 2D range (`readSticks` in `src/lib/flight/input.ts`): throttle 0..1 with 0.5
 * holding altitude in a climb mode, yaw positive turns right, pitch positive is nose down (forward), roll positive banks
 * left. A sprung thumbstick cannot hold a manual throttle, so the room flies climb modes: `climbModeFor` gives the climb
 * alternative of a manual-throttle mode such as quad5's `race`.
 */
import { DEFAULT_PAD, type FlightCraft, type FlightMode, type Sticks } from '@/lib/flight';

export interface ThumbStick {
  readonly x: number;
  readonly y: number;
}

/** Mode 2: left stick climb and yaw, right stick pitch and roll. Mode 1: left pitch and yaw, right climb and roll. */
export type StickLayout = 1 | 2;

/** The 2D range's gamepad deadband, rescaled so the channel leaves zero smoothly. */
export const STICK_DEADBAND = DEFAULT_PAD.deadband;

const dead = (v: number, d: number) => {
  const c = v < -1 ? -1 : v > 1 ? 1 : v;
  return Math.abs(c) < d ? 0 : (c - Math.sign(c) * d) / (1 - d);
};

/** The two thumbsticks to `Sticks` for a climb-rate throttle, written into `out`. */
export function controllerSticks(left: ThumbStick, right: ThumbStick, layout: StickLayout, out: Sticks): Sticks {
  const climbStick = layout === 2 ? left : right;
  const pitchStick = layout === 2 ? right : left;
  out.throttle = 0.5 + dead(-climbStick.y, STICK_DEADBAND) / 2;
  out.yaw = dead(left.x, STICK_DEADBAND);
  out.pitch = dead(-pitchStick.y, STICK_DEADBAND);
  out.roll = 0 - dead(right.x, STICK_DEADBAND);
  return out;
}

/** Centred sticks: a hover in a climb mode. */
export function centreSticks(out: Sticks): Sticks {
  out.throttle = 0.5;
  out.yaw = 0;
  out.pitch = 0;
  out.roll = 0;
  return out;
}

/** True when every channel is within `tol` of centre (the arming check: XR_DESIGN 8.3 "A arms with sticks centred"). */
export function sticksCentred(s: Readonly<Sticks>, tol = 0.1): boolean {
  return Math.abs(s.throttle - 0.5) <= tol && Math.abs(s.yaw) <= tol && Math.abs(s.pitch) <= tol && Math.abs(s.roll) <= tol;
}

/**
 * The mode the room flies for `modeId`: the mode itself when its throttle is a climb rate, else the craft's climb mode
 * with the same attitude and task, else its angle climb mode with a free task, else the first climb mode. A craft with
 * no climb mode at all (a wing) keeps the mode it asked for.
 */
export function climbModeFor(craft: FlightCraft, modeId: string): string {
  const modes = craft.modes;
  const want = modes.find((m) => m.id === modeId) ?? modes[0];
  if (!want || want.throttle === 'climb') return want?.id ?? modeId;
  const climb = (m: FlightMode) => m.throttle === 'climb' && !m.missionId && m.task !== 'demo';
  const pick =
    modes.find((m) => climb(m) && m.attitude === want.attitude && m.task === want.task) ??
    modes.find((m) => climb(m) && m.attitude === 'angle' && m.task === 'free' && !m.position) ??
    modes.find(climb);
  return pick?.id ?? want.id;
}
