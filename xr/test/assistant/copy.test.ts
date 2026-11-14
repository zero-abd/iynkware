import { describe, expect, it } from 'vitest';
import { LANGS } from '../../src/contracts/common';
import { COPY, COPY_KEYS, say } from '../../src/assistant/copy';

const names = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

describe("the assistant's strings", () => {
  it('exist in all six languages with the English placeholders', () => {
    const problems: string[] = [];
    for (const key of COPY_KEYS) {
      for (const lang of LANGS) {
        const s = COPY[lang][key];
        if (!s || s.trim() === '') problems.push(`${lang}.${key} is empty`);
        else if (names(s) !== names(COPY.en[key])) problems.push(`${lang}.${key} placeholders differ`);
      }
    }
    expect(problems).toEqual([]);
    expect(Object.keys(COPY.en).sort()).toEqual([...COPY_KEYS].sort());
  });

  it('fills placeholders and leaves an unknown one as written', () => {
    expect(say('en', 'labelPlace', { refdes: 'LED1' })).toBe('Place LED1');
    expect(say('fr', 'stepOf', { n: 2 })).toBe('Étape 2 sur {total}');
  });
});
