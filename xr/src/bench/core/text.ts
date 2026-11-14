/**
 * Six-language strings for the bench, until the shared headset text path lands (#19: `src/i18n/messages/<lang>/
 * xrBench.json` and `app.text.t`). Each bench sub-module keeps its own table in `<module>/strings.ts`, keys prefixed by
 * the module (`shelf.search`), so moving them into `xrBench.json` later is a copy. Placeholders are `{name}`, as in
 * iynk's message files. The type makes a missing key in any language a compile error; `parity` checks placeholders.
 */
import { LANGS, type Lang } from '../../contracts/common';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';

export type Table<K extends string> = Readonly<Record<Lang, Readonly<Record<K, string>>>>;
export type Params = Readonly<Record<string, string | number>>;

/** Declares a table; the English keys are the keys every language must have. */
export function table<K extends string>(t: Table<K>): Table<K> {
  return t;
}

/** Fills `{name}` placeholders. An unknown placeholder stays as written, so a missing param is visible, not blank. */
export function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** The string for `key` in `lang`, falling back to English. */
export function tr<K extends string>(t: Table<K>, lang: Lang, key: K, params?: Params): string {
  return format(t[lang]?.[key] ?? t.en[key] ?? key, params);
}

/** The string in the person's language now. Redraw text on `onLang`. */
export function say<K extends string>(app: Pick<XrApp, 'settings'>, t: Table<K>, key: K, params?: Params): string {
  return tr(t, app.settings.lang.value, key, params);
}

/** Calls `fn` with the new language whenever it changes, so canvas text is redrawn in place (design 9.5). */
export function onLang(app: Pick<XrApp, 'settings'>, fn: (lang: Lang) => void): Unsubscribe {
  return app.settings.lang.subscribe(fn);
}

const placeholders = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

/** Problems in a table: a language missing a key, an empty string, or placeholders that differ from English. */
export function parity(t: Table<string>): string[] {
  const problems: string[] = [];
  const keys = Object.keys(t.en);
  for (const lang of LANGS) {
    const row = t[lang] as Record<string, string> | undefined;
    if (!row) {
      problems.push(`${lang}: missing`);
      continue;
    }
    for (const k of keys) {
      const s = row[k];
      if (typeof s !== 'string' || s.trim() === '') problems.push(`${lang}.${k}: empty`);
      else if (placeholders(s) !== placeholders(t.en[k]!)) problems.push(`${lang}.${k}: placeholders differ from en`);
    }
    for (const k of Object.keys(row)) if (!(k in t.en)) problems.push(`${lang}.${k}: not in en`);
  }
  return problems;
}
