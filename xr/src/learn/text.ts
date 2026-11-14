/**
 * Learn's text path. Every string the learn pillar draws exists in the six languages: each sub-module keeps its own
 * table (`<sub-module>/strings.ts`, one object per language with English's keys, typed by `Strings`), so parallel work
 * never edits one shared file, and `createText` turns it into `t(lang, key, vars)` with `{name}` placeholders. Prose
 * that comes with the content (a template's `LocalizedText`) goes through `pick`, which says when it fell back to
 * English so the panel can show the notice. Drawn as canvas text (xr/src/ui/text.ts), so every script renders.
 *
 * Until the platform defines a headset-wide text path, this is it for learn; the tables move there unchanged.
 */
import { LANGS, type Lang, type LocalizedText } from '../contracts/common';

export type Table = Readonly<Record<string, string>>;

/** English defines the keys; every other language must have exactly those keys (checked by the compiler). */
export type Strings<T extends Table> = { readonly en: T } & { readonly [L in Exclude<Lang, 'en'>]: { readonly [K in keyof T]: string } };

export type Vars = Readonly<Record<string, string | number>>;
export type Translate<T extends Table> = (lang: Lang, key: keyof T & string, vars?: Vars) => string;

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

/** `t(lang, key, vars)`: the language's string, else English's, with `{name}` replaced. */
export function createText<T extends Table>(strings: Strings<T>): Translate<T> {
  return (lang, key, vars) => {
    const table = strings[lang] as Table | undefined;
    const s = table?.[key] || strings.en[key] || key;
    return fill(s, vars);
  };
}

/** Text in the person's language, and whether it fell back to English (or to any language present). */
export interface Picked {
  readonly text: string;
  readonly fallback: boolean;
}

export function pick(text: LocalizedText | string | undefined, lang: Lang): Picked {
  if (text === undefined) return { text: '', fallback: false };
  if (typeof text === 'string') return { text, fallback: false };
  const own = text[lang];
  if (typeof own === 'string' && own.trim() !== '') return { text: own, fallback: false };
  const en = text.en ?? Object.values(text).find((v) => typeof v === 'string' && v.trim() !== '') ?? '';
  return { text: en, fallback: en !== '' };
}

/** Problems in a table: a missing or empty string, or placeholders that differ from English's. Empty when it is right. */
export function tableProblems<T extends Table>(strings: Strings<T>): string[] {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const out: string[] = [];
  for (const [key, en] of Object.entries(strings.en)) {
    for (const lang of LANGS) {
      const s = (strings[lang] as Table)[key];
      if (typeof s !== 'string' || s.trim() === '') out.push(`${lang}.${key} is missing`);
      else if (names(s) !== names(en)) out.push(`${lang}.${key} has placeholders {${names(s)}}, English has {${names(en)}}`);
    }
  }
  return out;
}
