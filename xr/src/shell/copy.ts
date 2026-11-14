/**
 * The shell's strings, in six languages, until the shared headset text path (`app.text`, issue #19) lands and they move
 * into `src/i18n/messages/<lang>/xrShell.json`. Each feature keeps its own table in a file named `copy.ts` next to it,
 * so two features never edit the same file. TypeScript makes every language carry exactly the English keys, and
 * `test/shell-copy.test.ts` checks that every language keeps the English `{placeholders}` and leaves nothing empty.
 *
 *   export const HOME = defineCopy({ en: { title: 'Home', projects: '{n} projects' }, de: { ... }, ... });
 *   say(HOME, lang, 'projects', { n: 3 })
 */
import type { Lang } from '../contracts/common';

export type Copy<K extends string> = { readonly [L in Lang]: { readonly [P in K]: string } };

export const defineCopy = <K extends string>(copy: Copy<K>): Copy<K> => copy;

/** The string for `key` in `lang`, with `{name}` placeholders filled from `params`. A missing param stays as written. */
export function say<K extends string>(copy: Copy<K>, lang: Lang, key: K, params?: Readonly<Record<string, string | number>>): string {
  const text = copy[lang]?.[key] ?? copy.en[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** The `{placeholders}` a string uses, sorted, for the parity test. */
export const placeholdersOf = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
