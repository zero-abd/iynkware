import { describe, expect, it } from 'vitest';
import { createLessonSlot } from '../../src/learn/launcher';
import { createText, pick, tableProblems, type Strings } from '../../src/learn/text';

describe('lesson slot', () => {
  it('waits for the learn module before opening, then forwards', async () => {
    const slot = createLessonSlot();
    const opened: string[] = [];
    const pending = slot.open('prj_uno-r3-blink', { build: true });
    expect(opened).toEqual([]);
    slot.attach({
      open: async (id, opts) => void opened.push(`${id}:${opts?.build === true}`),
      close: () => opened.push('close'),
    });
    await pending;
    slot.close();
    expect(opened).toEqual(['prj_uno-r3-blink:true', 'close']);
  });

  it('keeps the catalogue visibility as a value', () => {
    const slot = createLessonSlot();
    const seen: unknown[] = [];
    slot.catalogue.subscribe((v) => seen.push(v));
    slot.showCatalogue('robotics');
    slot.showCatalogue();
    slot.hideCatalogue();
    expect(seen).toEqual(['robotics', 'all', null]);
  });
});

describe('learn text', () => {
  const strings = {
    en: { step: 'Step {n} of {total}', next: 'Next' },
    de: { step: 'Schritt {n} von {total}', next: 'Weiter' },
    es: { step: 'Paso {n} de {total}', next: 'Siguiente' },
    fr: { step: 'Étape {n} sur {total}', next: 'Suivant' },
    hi: { step: 'चरण {n} / {total}', next: 'आगे' },
    zh: { step: '第 {n} 步，共 {total} 步', next: '下一步' },
  } satisfies Strings<{ step: string; next: string }>;

  it('fills placeholders in the person language', () => {
    const t = createText(strings);
    expect(t('de', 'step', { n: 3, total: 7 })).toBe('Schritt 3 von 7');
    expect(t('zh', 'next')).toBe('下一步');
    expect(tableProblems(strings)).toEqual([]);
  });

  it('reports a missing string and a placeholder mismatch', () => {
    const bad = { ...strings, fr: { step: 'Étape {n}', next: '' } };
    expect(tableProblems(bad)).toEqual(['fr.step has placeholders {n}, English has {n,total}', 'fr.next is missing']);
  });

  it('falls back to English with a flag', () => {
    expect(pick({ en: 'Blink an LED', de: 'Eine LED blinken lassen' }, 'de')).toEqual({ text: 'Eine LED blinken lassen', fallback: false });
    expect(pick({ en: 'Blink an LED' }, 'hi')).toEqual({ text: 'Blink an LED', fallback: true });
    expect(pick('D13', 'zh')).toEqual({ text: 'D13', fallback: false });
  });
});
