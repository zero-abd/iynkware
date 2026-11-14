/**
 * Six-language string tables for the run pillar. Each sub-module keeps its own table in its own `strings.ts`, so two
 * slices never edit one file. English sets the keys; TypeScript makes every other language carry exactly the same
 * keys, and `stringProblems` (run by each slice's test) checks that the `{placeholders}` match too.
 *
 * Adapter: when `app.text` lands (#19) these tables move into `src/i18n/messages/<lang>/xrRun.json` and `t` reads from
 * there; callers keep calling `t(lang, key, params)`.
 */
import { LANGS, type Lang } from '../../contracts/common';

export type StringTable<K extends string> = { readonly [L in Lang]: { readonly [P in K]: string } };

export interface Strings<K extends string> {
  readonly table: StringTable<K>;
  /** The text for `key` in `lang`, with `{name}` replaced from `params`. Falls back to English. */
  t(lang: Lang, key: K, params?: Readonly<Record<string, string | number>>): string;
}

/** `{name}` placeholders in a text, sorted. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

export function fill(text: string, params?: Readonly<Record<string, string | number>>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

export function defineStrings<const E extends Readonly<Record<string, string>>>(
  table: { readonly en: E } & { readonly [L in Exclude<Lang, 'en'>]: { readonly [P in keyof E]: string } },
): Strings<keyof E & string> {
  const t = table as unknown as StringTable<keyof E & string>;
  return {
    table: t,
    t: (lang, key, params) => fill(t[lang]?.[key] ?? t.en[key] ?? key, params),
  };
}

/**
 * What is wrong with a table, one line each: a missing or empty text, a placeholder that differs from English, an
 * exclamation mark (the copy rules forbid them). An empty list is a good table.
 */
export function stringProblems(table: StringTable<string>): string[] {
  const out: string[] = [];
  const keys = Object.keys(table.en);
  for (const lang of LANGS) {
    const row = table[lang] as Readonly<Record<string, string>> | undefined;
    if (!row) {
      out.push(`${lang}: missing`);
      continue;
    }
    for (const k of Object.keys(row)) if (!keys.includes(k)) out.push(`${lang}.${k}: not in English`);
    for (const k of keys) {
      const text = row[k];
      if (typeof text !== 'string' || text.trim() === '') {
        out.push(`${lang}.${k}: empty`);
        continue;
      }
      if (placeholders(text).join() !== placeholders(table.en[k]!).join()) out.push(`${lang}.${k}: placeholders differ`);
      if (/[!！]/.test(text)) out.push(`${lang}.${k}: exclamation mark`);
    }
  }
  return out;
}
