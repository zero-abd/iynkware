/**
 * Six-language string tables for the scale pillar's sub-modules, one table per sub-module (`<sub>/strings.ts`), so two
 * slices never edit the same file. The text is drawn as canvas textures (`xr/src/ui`). When the headset namespace of
 * issue #19 lands (`xrScale` and `app.text`), these tables move there unchanged: same keys, same `{name}` placeholders.
 *
 * Usage:
 *   const STRINGS = { en: { scale: 'Scale {x}x' }, de: { scale: 'Maßstab {x}x' }, ... } satisfies Strings<'scale'>;
 *   tr(STRINGS, app.settings.lang.value, 'scale', { x: 3 });
 */
import { LANGS, type Lang } from '../../contracts/common';

export type Strings<K extends string> = Readonly<Record<Lang, Readonly<Record<K, string>>>>;

const PLACEHOLDER = /\{(\w+)\}/g;

/** The string for `key` in `lang` (English when missing), with `{name}` placeholders filled from `params`. */
export function tr<K extends string>(table: Strings<K>, lang: Lang, key: K, params?: Readonly<Record<string, string | number>>): string {
  const raw = table[lang]?.[key] ?? table.en[key] ?? key;
  if (!params) return raw;
  return raw.replace(PLACEHOLDER, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** What is wrong with a table: a language missing a key or having an extra one, an empty string, other placeholders. */
export function tableProblems(table: Strings<string>): string[] {
  const problems: string[] = [];
  const keys = Object.keys(table.en);
  const holes = (s: string) => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]).sort().join(',');
  for (const lang of LANGS) {
    const row = table[lang] as Readonly<Record<string, string>> | undefined;
    if (!row) {
      problems.push(`${lang}: missing`);
      continue;
    }
    for (const k of keys) {
      const s = row[k];
      if (typeof s !== 'string' || s.trim() === '') problems.push(`${lang}.${k}: missing or empty`);
      else if (holes(s) !== holes(table.en[k]!)) problems.push(`${lang}.${k}: placeholders differ from en`);
    }
    for (const k of Object.keys(row)) if (!keys.includes(k)) problems.push(`${lang}.${k}: not in en`);
  }
  return problems;
}

const LOCALE: Readonly<Record<Lang, string>> = { en: 'en', de: 'de', es: 'es', fr: 'fr', hi: 'hi', zh: 'zh-Hans' };
const formats = new Map<string, Intl.NumberFormat>();

/** A number as the language writes it, with exactly `digits` decimals (2.03, 2,03). Formatters are cached. */
export function num(lang: Lang, value: number, digits = 2): string {
  const key = `${lang}:${digits}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formats.set(key, f);
  }
  return f.format(value);
}
