/**
 * The quick input switch. By default (`auto`) tracked hands and controllers both work, and a side's tracked hand wins
 * over a controller lying still (`preferHand`). B on the right controller is the override: one press turns hands off
 * (`controllers`: hands are ignored even when tracked), the next goes back to the default. `hands` (controllers
 * ignored) is kept for `setInputMode`. Pure: the service reads the button and applies these every frame.
 */
import type { Lang } from '../contracts/common';
import type { PointerSource } from '../contracts/input';

export type InputMode = 'auto' | 'hands' | 'controllers';

/** True when `mode` ignores a side whose primary source is `primary`: hands under `controllers`, and the reverse. */
export function blocks(mode: InputMode, primary: PointerSource | null): boolean {
  if (mode === 'controllers') return primary === 'hand';
  if (mode === 'hands') return primary === 'controller';
  return false;
}

/** The mode a press of B moves to: hands off (`controllers`), then back to the default (`auto`, hands on). */
export function toggled(mode: InputMode): Exclude<InputMode, 'hands'> {
  return mode === 'controllers' ? 'auto' : 'controllers';
}

/** A controller still for this long, with no button held, counts as put down. */
export const CONTROLLER_IDLE_MS = 800;
/** Moving its grip this far (metres) from where it settled wakes a put-down controller. */
export const CONTROLLER_WAKE_M = 0.02;

export interface IdleState {
  x: number;
  y: number;
  z: number;
  sinceMs: number;
  seen: boolean;
}
export const newIdleState = (): IdleState => ({ x: 0, y: 0, z: 0, sinceMs: 0, seen: false });

/** Steps a controller's stillness; true once it has been still (and no button held) for `CONTROLLER_IDLE_MS`. */
export function stepIdle(s: IdleState, x: number, y: number, z: number, buttonHeld: boolean, nowMs: number): boolean {
  const moved = !s.seen || Math.hypot(x - s.x, y - s.y, z - s.z) > CONTROLLER_WAKE_M;
  if (moved || buttonHeld) {
    s.x = x;
    s.y = y;
    s.z = z;
    s.sinceMs = nowMs;
    s.seen = true;
    return false;
  }
  return nowMs - s.sinceMs >= CONTROLLER_IDLE_MS;
}

/**
 * Whether a side's tracked hand should drive it instead of the controller the runtime still lists (a Quest can keep a
 * put-down controller in the session's input sources). Hands win while the controller lies still, except under
 * `controllers`, where the controller always does.
 */
export function preferHand(mode: InputMode, handTracked: boolean, controllerIdle: boolean): boolean {
  return mode !== 'controllers' && handTracked && controllerIdle;
}

export const MODE_LINES: Readonly<Record<Exclude<InputMode, 'hands'>, Readonly<Record<Lang, string>>>> = {
  auto: {
    en: 'Hands on',
    de: 'Hände an',
    es: 'Manos activadas',
    fr: 'Mains activées',
    hi: 'हाथ चालू',
    zh: '手势已开启',
  },
  controllers: {
    en: 'Controllers only: hands are ignored',
    de: 'Nur Controller: Hände werden ignoriert',
    es: 'Solo mandos: se ignoran las manos',
    fr: 'Manettes seules : les mains sont ignorées',
    hi: 'केवल कंट्रोलर: हाथ अनदेखे',
    zh: '仅手柄：忽略手势',
  },
};

/** The ticker line for a switch to `mode`, in `lang` (English when the language is missing). */
export function modeLine(mode: Exclude<InputMode, 'hands'>, lang: Lang): string {
  return MODE_LINES[mode][lang] ?? MODE_LINES[mode].en;
}
