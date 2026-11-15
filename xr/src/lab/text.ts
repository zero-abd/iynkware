/**
 * The lab pillar's text path. Every string the lab draws or the tutor says exists in the six languages as one `L6`
 * (a full `LocalizedText`), written with `l6(en, de, es, fr, hi, zh)` next to the thing it names, so a tutor event can
 * carry the whole text and a listener picks its language. `{name}` placeholders are filled by `fill`. `l6Problems`
 * walks any table of them for the test (a missing language, an empty string, placeholders that differ from English's).
 * Drawn as canvas text (xr/src/ui/text.ts and the look kit), so every script renders.
 */
import { LANGS, type Lang } from '../contracts/common';

/** Text in all six languages. Assignable to the contracts' `LocalizedText`. */
export type L6 = Readonly<Record<Lang, string>>;
export type Vars = Readonly<Record<string, string | number>>;
/** Placeholder values for `fill`: a number or word the same everywhere, or an `L6` taken in each language. */
export type Vars6 = Readonly<Record<string, string | number | L6>>;

export const l6 = (en: string, de: string, es: string, fr: string, hi: string, zh: string): L6 => ({ en, de, es, fr, hi, zh });

/** The same text in every language: a number with its unit, a formula, a symbol. */
export const same = (s: string): L6 => ({ en: s, de: s, es: s, fr: s, hi: s, zh: s });

const fillOne = (s: string, vars: Vars) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

const varsIn = (vars: Vars6, lang: Lang): Vars => {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars)) out[k] = typeof v === 'object' ? v[lang] || v.en : v;
  return out;
};

/** `text` with `{name}` replaced in every language; an `L6` value is taken in the same language. */
export function fill(text: L6, vars: Vars6): L6 {
  const out = {} as Record<Lang, string>;
  for (const lang of LANGS) out[lang] = fillOne(text[lang], varsIn(vars, lang));
  return out;
}

/** The string for `lang`, English when it is missing. */
export const say = (text: L6, lang: Lang, vars?: Vars): string => {
  const s = text[lang] || text.en;
  return vars ? fillOne(s, vars) : s;
};

export const isL6 = (v: unknown): v is L6 =>
  typeof v === 'object' && v !== null && typeof (v as { en?: unknown }).en === 'string' && LANGS.some((l) => l !== 'en' && l in (v as object));

/** Problems in every `L6` found anywhere inside `table` (objects and arrays are walked). Empty when all are right. */
export function l6Problems(table: unknown, path = ''): string[] {
  const out: string[] = [];
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const walk = (v: unknown, at: string) => {
    if (isL6(v)) {
      for (const lang of LANGS) {
        const s = (v as Record<string, unknown>)[lang];
        if (typeof s !== 'string' || s.trim() === '') out.push(`${at}.${lang} is missing`);
        else if (names(s) !== names(v.en)) out.push(`${at}.${lang} has placeholders {${names(s)}}, English has {${names(v.en)}}`);
      }
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
    else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) walk(x, at ? `${at}.${k}` : k);
  };
  walk(table, path);
  return out;
}

/** How many `L6` a table holds (the test checks the walk found them). */
export function l6Count(table: unknown): number {
  if (isL6(table)) return 1;
  if (Array.isArray(table)) return table.reduce((n: number, x) => n + l6Count(x), 0);
  if (typeof table === 'object' && table !== null) return Object.values(table).reduce((n: number, x) => n + l6Count(x), 0);
  return 0;
}
