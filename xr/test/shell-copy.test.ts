/** Every shell copy table (`xr/src/shell/**\/copy.ts`): six languages, the English keys and placeholders, nothing empty. */
import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/contracts/common';
import { placeholdersOf, say, type Copy } from '../src/shell/copy';

const modules = import.meta.glob<Record<string, unknown>>('../src/shell/**/copy.ts', { eager: true });

const isCopy = (v: unknown): v is Copy<string> =>
  typeof v === 'object' && v !== null && LANGS.every((l) => typeof (v as Record<string, unknown>)[l] === 'object');

const tables = Object.entries(modules).flatMap(([file, mod]) =>
  Object.entries(mod)
    .filter(([, v]) => isCopy(v))
    .map(([name, v]) => ({ name: `${file.replace('../src/shell/', '')} ${name}`, copy: v as Copy<string> })),
);

describe('shell copy helper', () => {
  const T = { en: { hi: 'Hello {name}', n: '{n} of {m}' }, de: { hi: 'Hallo {name}', n: '{n} von {m}' }, es: { hi: 'Hola {name}', n: '{n} de {m}' }, fr: { hi: 'Bonjour {name}', n: '{n} sur {m}' }, hi: { hi: 'नमस्ते {name}', n: '{m} में से {n}' }, zh: { hi: '你好 {name}', n: '{n}/{m}' } } as const;

  it('fills placeholders and keeps unknown ones', () => {
    expect(say(T, 'de', 'hi', { name: 'Ada' })).toBe('Hallo Ada');
    expect(say(T, 'hi', 'n', { n: 4, m: 9 })).toBe('9 में से 4');
    expect(say(T, 'en', 'hi')).toBe('Hello {name}');
    expect(say(T, 'fr', 'n', { n: 1 })).toBe('1 sur {m}');
  });

  it('reads placeholders in order-independent form', () => {
    expect(placeholdersOf('{m} in {n} and {m}')).toEqual(['m', 'm', 'n']);
  });
});

const rows: Array<{ name: string; copy: Copy<string> | null }> = tables.length ? tables : [{ name: 'none yet', copy: null }];

describe.each(rows)('copy table $name', ({ copy }) => {
  it.runIf(copy !== null)('has every English key in every language, with the same placeholders, none empty', () => {
    const en = copy!.en;
    for (const lang of LANGS) {
      const table = copy![lang];
      expect(Object.keys(table).sort(), lang).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en)) {
        const text = (table as Record<string, string>)[key]!;
        expect(text.trim().length, `${lang} ${key}`).toBeGreaterThan(0);
        expect(placeholdersOf(text), `${lang} ${key}`).toEqual(placeholdersOf((en as Record<string, string>)[key]!));
      }
    }
  });
});
