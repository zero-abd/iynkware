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

/** The four sound volumes of docs/XR_DESIGN.md 11.2. */
export type SoundBus = 'interface' | 'bench' | 'simulation' | 'alerts';
export const SOUND_BUSES: readonly SoundBus[] = ['interface', 'bench', 'simulation', 'alerts'];

/** Text size for every role (docs/XR_DESIGN.md 9.2): 100, 125 or 150 %. */
export type TextScale = 1 | 1.25 | 1.5;

export interface XrSettings {
  /** Mixed reality passthrough (the default) or the plain VR studio. */
  space: 'mr' | 'vr';
  posture: 'seated' | 'standing';
  /** Bench height above the floor, metres. */
  benchHeight: number;
  /** Initial work scale on the bench (docs/XR_DESIGN.md 3.4): 3, so a 2.54 mm pitch is 7.62 mm under the fingers. */
  benchScale: number;
  dominantHand: 'left' | 'right';
  /** Request 90 Hz when the scene holds it; 72 Hz otherwise. */
  refresh: 72 | 90;
  /**
   * The headset's own sound switch, on by default: sound is the hands' confirmation channel (11.2). The 2D site's
   * `sound` (off by default there) is not read for it.
   */
  sound: boolean;
  /** Volume per bus, 0..1. */
  volumes: Readonly<Record<SoundBus, number>>;
  /** Both ears hear the same mix. */
  monoSound: boolean;
  /**
   * Fades of at most 150 ms replace moves; crawling, flowing, rising and pulsing animations become static marks (11.2).
   * Until the person sets it in the headset it starts from the 2D site's `reduceMotion`.
   */
  reducedMotion: boolean;
  /** Room light (9.3): `dim` lowers `paper` and `rule`. Until set in the headset, the 2D dark theme starts it `dim`. */
  roomLight: 'bright' | 'dim';
  textScale: TextScale;
  /** Outlines 1.5x and `muted` drawn as `ink` (11.2). */
  highContrast: boolean;
  /** Pinch or grip once to take, once more to let go, instead of holding (11.2). */
  toggleGrab: boolean;
  /** Flight stick mode (8.3): 2 by default, 1 swaps throttle and pitch. */
  flightMode: 1 | 2;
  /** Teleport at Room size (8.1), off by default. */
  teleport: boolean;
}

export const DEFAULT_XR_SETTINGS: Readonly<XrSettings> = Object.freeze({
  space: 'mr',
  posture: 'seated',
  benchHeight: 0.74,
  benchScale: 3,
  dominantHand: 'right',
  refresh: 90,
  sound: true,
  volumes: Object.freeze({ interface: 0.6, bench: 0.8, simulation: 0.7, alerts: 1 }),
  monoSound: false,
  reducedMotion: false,
  roomLight: 'bright',
  textScale: 1,
  highContrast: false,
  toggleGrab: false,
  flightMode: 2,
  teleport: false,
} satisfies XrSettings);

export interface SettingsStore {
  readonly lang: ReadonlyValue<Lang>;
  readonly xr: ReadonlyValue<XrSettings>;
  /** The 2D site's shared settings (`sound`, `reduceMotion`, `englishTerms`, ...), read only from the headset. */
  readonly shared: ReadonlyValue<Readonly<Record<string, unknown>>>;
  setLang(lang: Lang): void;
  setXr(patch: Partial<XrSettings>): void;
}
