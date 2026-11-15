/**
 * Settings: the 2D site's shared settings are read (never written) from `localStorage["iynk:v1"]`; the headset's own
 * live in `localStorage["iynk:xr:v1"]`. Contract: contracts/settings.ts. Every storage access is guarded: a private
 * window or blocked storage falls back to defaults.
 */
import { LANGS, type Lang } from '../contracts/common';
import { DEFAULT_XR_SETTINGS, SOUND_BUSES, type SettingsStore, type SoundBus, type XrSettings } from '../contracts/settings';
import { value } from '../ui/value';

export const SHARED_KEY = 'iynk:v1';
export const XR_KEY = 'iynk:xr:v1';

const read = (key: string): unknown => {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

/** `?lang=`, then the 2D site's `iynk-lang` cookie, then the browser's languages, then English. */
export function initialLang(): Lang {
  const q = new URLSearchParams(globalThis.location?.search ?? '').get('lang');
  if (isLang(q)) return q;
  const cookie = /(?:^|;\s*)iynk-lang=([a-z]{2})/.exec(globalThis.document?.cookie ?? '')?.[1];
  if (isLang(cookie)) return cookie;
  for (const l of globalThis.navigator?.languages ?? []) {
    const short = l.slice(0, 2).toLowerCase();
    if (isLang(short)) return short;
  }
  return 'en';
}

/**
 * Keeps a chosen language across reloads in the 2D site's own cookie (same name, same meaning), so once the two apps
 * share an origin a choice in one is the choice in the other. A year, the whole origin, never sent cross-site.
 */
export function writeLangCookie(l: Lang): void {
  try {
    if (globalThis.document) globalThis.document.cookie = `iynk-lang=${l}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    /* cookies blocked: the language lasts for this page only */
  }
}

const oneOf =
  <T>(...allowed: readonly T[]) =>
  (v: unknown): v is T =>
    allowed.includes(v as T);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isNum = (lo: number, hi: number) => (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** A check per field, so a saved value of the wrong shape (an older or hand-edited record) falls back to its default. */
const VALID: { [K in keyof XrSettings]: (v: unknown) => boolean } = {
  space: oneOf('mr', 'vr'),
  posture: oneOf('seated', 'standing'),
  benchHeight: isNum(0.3, 1.6),
  benchScale: isNum(0.5, 12),
  dominantHand: oneOf('left', 'right'),
  refresh: oneOf(72, 90),
  sound: isBool,
  haptics: isBool,
  volumes: (v) => typeof v === 'object' && v !== null,
  monoSound: isBool,
  reducedMotion: isBool,
  roomLight: oneOf('bright', 'dim'),
  textScale: oneOf(1, 1.25, 1.5),
  highContrast: isBool,
  toggleGrab: isBool,
  flightMode: oneOf(1, 2),
  teleport: isBool,
};

/**
 * The headset settings from what was saved in `iynk:xr:v1` and the 2D site's settings. Saved fields win when valid.
 * Reduced motion and room light start from the 2D site (its `reduceMotion`, and a dark theme, or `system` with a dark
 * browser, starts the room dim) until the person sets them in the headset. Sound never does: it is on by default here.
 */
export function initialXrSettings(saved: unknown, shared: Readonly<Record<string, unknown>>, prefersDark = false): XrSettings {
  const out = { ...DEFAULT_XR_SETTINGS } as Record<keyof XrSettings, unknown>;
  out.reducedMotion = shared.reduceMotion === true;
  out.roomLight = shared.theme === 'dark' || (shared.theme === 'system' && prefersDark) ? 'dim' : 'bright';
  const s = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {};
  for (const key of Object.keys(VALID) as Array<keyof XrSettings>) {
    if (key in s && VALID[key](s[key])) out[key] = s[key];
  }
  const vols = { ...DEFAULT_XR_SETTINGS.volumes } as Record<SoundBus, number>;
  const savedVols = (typeof s.volumes === 'object' && s.volumes !== null ? s.volumes : {}) as Record<string, unknown>;
  for (const bus of SOUND_BUSES) if (isNum(0, 1)(savedVols[bus])) vols[bus] = savedVols[bus] as number;
  out.volumes = vols;
  return out as unknown as XrSettings;
}

const browserPrefersDark = (): boolean => {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  } catch {
    return false;
  }
};

export function createSettingsStore(): SettingsStore {
  const shared = value<Readonly<Record<string, unknown>>>(
    ((read(SHARED_KEY) as { settings?: Record<string, unknown> } | null)?.settings ?? {}) as Record<string, unknown>,
  );
  const xr = value<XrSettings>(initialXrSettings(read(XR_KEY), shared.value, browserPrefersDark()));
  const lang = value<Lang>(initialLang());
  return {
    lang,
    xr,
    shared,
    setLang(l) {
      if (!isLang(l)) return;
      lang.set(l);
      writeLangCookie(l);
    },
    setXr(patch) {
      xr.set({ ...xr.value, ...patch });
      try {
        globalThis.localStorage?.setItem(XR_KEY, JSON.stringify(xr.value));
      } catch {
        /* storage blocked: the setting lasts for this session only */
      }
    },
  };
}
