/**
 * Settings: the 2D site's shared settings are read (never written) from `localStorage["iynk:v1"]`; the headset's own
 * live in `localStorage["iynk:xr:v1"]`. Contract: contracts/settings.ts. Every storage access is guarded: a private
 * window or blocked storage falls back to defaults.
 */
import { LANGS, type Lang } from '../contracts/common';
import { DEFAULT_XR_SETTINGS, type SettingsStore, type XrSettings } from '../contracts/settings';
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

export function createSettingsStore(): SettingsStore {
  const saved = read(XR_KEY) as Partial<XrSettings> | null;
  const xr = value<XrSettings>({ ...DEFAULT_XR_SETTINGS, ...(saved ?? {}) });
  const shared = value<Readonly<Record<string, unknown>>>(
    ((read(SHARED_KEY) as { settings?: Record<string, unknown> } | null)?.settings ?? {}) as Record<string, unknown>,
  );
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
