/**
 * Settings and language. The 2D site's settings are read from `localStorage["iynk:v1"]` (the `Saved` document of
 * `src/lib/progress/storage.ts`) and never rewritten from the headset; the headset's own settings live in
 * `localStorage["iynk:xr:v1"]`, so the 2D site's parser never sees an unknown key. The language comes from `?lang=`,
 * then the 2D site's `iynk-lang` cookie, then the browser. Contract file: changes only in its own PR (label
 * `contract-change`).
 *
 * Implementation: `xr/src/shell/settings.ts` (`createSettingsStore`).
 */
import type { Lang, ReadonlyValue } from './common';

export interface XrSettings {
  /** Mixed reality passthrough (the default) or the plain VR studio. */
  space: 'mr' | 'vr';
  posture: 'seated' | 'standing';
  /** Bench height above the floor, metres. */
  benchHeight: number;
  /** Initial board scale on the bench. */
  benchScale: number;
  dominantHand: 'left' | 'right';
  /** Request 90 Hz when the scene holds it; 72 Hz otherwise. */
  refresh: 72 | 90;
}

export const DEFAULT_XR_SETTINGS: Readonly<XrSettings> = Object.freeze({
  space: 'mr',
  posture: 'seated',
  benchHeight: 0.74,
  benchScale: 4,
  dominantHand: 'right',
  refresh: 90,
});

export interface SettingsStore {
  readonly lang: ReadonlyValue<Lang>;
  readonly xr: ReadonlyValue<XrSettings>;
  /** The 2D site's shared settings (`sound`, `reduceMotion`, `englishTerms`, ...), read only from the headset. */
  readonly shared: ReadonlyValue<Readonly<Record<string, unknown>>>;
  setLang(lang: Lang): void;
  setXr(patch: Partial<XrSettings>): void;
}
