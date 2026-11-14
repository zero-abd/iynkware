/**
 * The person's preferences the pillar honours, read forward-compatibly: the headset settings fields of issue #17
 * (`reducedMotion`, `teleport`) are not in `XrSettings` yet, so they are read by name when present, and reduced motion
 * falls back to the 2D site's `reduceMotion`. Once #17 lands these become plain field reads.
 */
import type { XrApp } from '../../contracts/app';
import type { XrSettings } from '../../contracts/settings';

type Prefs = Pick<XrApp, 'settings'>;

const field = (app: Prefs, name: string): unknown => (app.settings.xr.value as unknown as Record<string, unknown>)[name];

/** Reduced motion: fades of at most 150 ms replace moves; flowing and pulsing marks become static (design 11.2). */
export function reducedMotion(app: Prefs): boolean {
  const own = field(app, 'reducedMotion');
  if (typeof own === 'boolean') return own;
  return app.settings.shared.value.reduceMotion === true;
}

/** Teleport at Room size: off by default (design 8.1). */
export function teleportOn(app: Prefs): boolean {
  return field(app, 'teleport') === true;
}

export function setTeleport(app: Prefs, on: boolean): void {
  app.settings.setXr({ teleport: on } as unknown as Partial<XrSettings>);
}

/** Seated posture (`XrSettings.posture`): Room size stays optional and nothing asks the person to stand or walk. */
export function seated(app: Prefs): boolean {
  return app.settings.xr.value.posture === 'seated';
}

/** The longest a fade may take under reduced motion (design 11.2). */
export const REDUCED_FADE_MS = 150;

/** `ms`, or at most `REDUCED_FADE_MS` under reduced motion. */
export function fadeMs(app: Prefs, ms: number): number {
  return reducedMotion(app) ? Math.min(ms, REDUCED_FADE_MS) : ms;
}
