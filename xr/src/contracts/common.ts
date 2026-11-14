/**
 * Small shared types every contract uses. Contract file: changes only in its own PR (label `contract-change`).
 */

/** Returned by every `subscribe`/`on*`; calling it twice is harmless. */
export type Unsubscribe = () => void;

/** A point or direction in metres, world frame unless the field says otherwise. Plain data, so it crosses workers. */
export type Vec3 = readonly [x: number, y: number, z: number];

/** The six languages iynk ships. Order matches `src/i18n`. */
export const LANGS = ['en', 'de', 'es', 'fr', 'hi', 'zh'] as const;
export type Lang = (typeof LANGS)[number];

/** Text a project or a lesson carries in several languages (`guide.callouts[].text` is this shape). */
export type LocalizedText = Partial<Record<Lang, string>>;

/** Picks the text for `lang`, falling back to English, then to any language present. */
export function pickText(text: LocalizedText | string | undefined, lang: Lang): string {
  if (text === undefined) return '';
  if (typeof text === 'string') return text;
  return text[lang] ?? text.en ?? Object.values(text).find((v) => typeof v === 'string') ?? '';
}

/** A minimal observable value. IWSDK's `Signal` (from @preact/signals-core) satisfies it. */
export interface ReadonlyValue<T> {
  readonly value: T;
  subscribe(fn: (value: T) => void): Unsubscribe;
}
