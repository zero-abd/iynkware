/**
 * The person's display preferences, read forward-compatibly: room light, high contrast, text size and reduced motion
 * are new `XrSettings` fields of design 9.6 that the contract does not have yet, so they are read by name when present;
 * reduced motion falls back to the 2D site's `reduceMotion`, the room to its dark theme. Plain field reads once they land.
 *
 * Usage: const p = prefs(app); const k = tokens(p);
 */
import type { XrApp } from '../../contracts/app';
import type { Room } from './tokens';

export interface Prefs {
  readonly room: Room;
  readonly highContrast: boolean;
  /** 1, 1.25 or 1.5. */
  readonly textScale: number;
  readonly reducedMotion: boolean;
}

type App = Pick<XrApp, 'settings'>;

const field = (app: App, name: string): unknown => (app.settings.xr.value as unknown as Record<string, unknown>)[name];

export function prefs(app: App): Prefs {
  const shared = app.settings.shared.value;
  const room = field(app, 'room') ?? field(app, 'roomLight');
  const size = field(app, 'textSize') ?? field(app, 'textScale');
  const motion = field(app, 'reducedMotion');
  const scale = typeof size === 'number' ? (size > 3 ? size / 100 : size) : 1;
  return {
    room: room === 'dim' || (room === undefined && shared.theme === 'dark') ? 'dim' : 'bright',
    highContrast: field(app, 'highContrast') === true,
    textScale: Math.min(1.5, Math.max(1, scale)),
    reducedMotion: typeof motion === 'boolean' ? motion : shared.reduceMotion === true,
  };
}

/** A key for redraws: changes whenever a preference that changes the drawing does. */
export const prefsKey = (p: Prefs): string => `${p.room}|${p.highContrast ? 1 : 0}|${p.textScale}`;
