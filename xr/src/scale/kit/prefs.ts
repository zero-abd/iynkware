/**
 * The person's preferences the pillar honours (`XrSettings`, #145): reduced motion (the look kit's reading, which
 * starts from the 2D site's and the browser's preference), teleport at Room size and the seated posture.
 */
import type { XrApp } from '../../contracts/app';
import { reducedMotionOf } from '../../look';

type Prefs = Pick<XrApp, 'settings'>;

/** Reduced motion: fades of at most 150 ms replace moves; flowing and pulsing marks become static (design 11.2). */
export function reducedMotion(app: Prefs): boolean {
  return reducedMotionOf(app);
}

/** Teleport at Room size: off by default (design 8.1). */
export function teleportOn(app: Prefs): boolean {
  return app.settings.xr.value.teleport === true;
}

export function setTeleport(app: Prefs, on: boolean): void {
  app.settings.setXr({ teleport: on });
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
