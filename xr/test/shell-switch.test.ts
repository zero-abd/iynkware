import { describe, expect, test } from 'vitest';
import { LAB_TEMPLATES, TEMPLATES } from '@content/projects';
import { BLINK, FEATURED, templateTitle } from '../src/shell/switch';

const ids = new Set([...TEMPLATES, ...LAB_TEMPLATES].map((t) => t.id));

describe('shell switch', () => {
  test('Blink and every featured template exist', () => {
    expect(ids.has(BLINK)).toBe(true);
    for (const id of FEATURED) expect(ids.has(id), id).toBe(true);
  });

  test('template titles come from the gallery, in the language when present', () => {
    expect(templateTitle(BLINK, 'en')).not.toBe(BLINK);
    expect(templateTitle(BLINK, 'de').length).toBeGreaterThan(0);
    expect(templateTitle('prj_nope', 'en')).toBe('prj_nope');
  });
});
