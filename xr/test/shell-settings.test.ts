/** Settings keep the chosen language in the 2D site's cookie; Reset progress clears lesson progress and keeps settings. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProgressStore } from '../src/learn/progress';
import { createSettingsStore } from '../src/shell/settings';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, String(v));
  removeItem = (k: string) => void this.m.delete(k);
}

const g = globalThis as unknown as { localStorage?: MemoryStorage; document?: { cookie: string } };

beforeEach(() => {
  g.localStorage = new MemoryStorage();
  g.document = { cookie: '' };
});
afterEach(() => {
  delete g.localStorage;
  delete g.document;
});

describe('language', () => {
  it('writes the iynk-lang cookie on a change and ignores an unknown language', () => {
    const s = createSettingsStore();
    s.setLang('hi');
    expect(s.lang.value).toBe('hi');
    expect(g.document!.cookie).toMatch(/^iynk-lang=hi; path=\/; max-age=31536000; SameSite=Lax$/);
    s.setLang('xx' as never);
    expect(s.lang.value).toBe('hi');
  });
});

describe('reset progress', () => {
  it('clears done, quiz and best, keeps the 2D settings, and tells subscribers', () => {
    const saved = { v: 1, done: { 'board:uno-r3/blink': true }, quiz: { q: { score: 1, total: 2 } }, best: { b: 3 }, settings: { sound: true, theme: 'dark' } };
    g.localStorage!.setItem('iynk:v1', JSON.stringify(saved));
    const progress = createProgressStore();
    let told = 0;
    progress.subscribe(() => told++);
    expect(progress.isDone('board:uno-r3/blink')).toBe(true);
    progress.reset();
    expect(progress.isDone('board:uno-r3/blink')).toBe(false);
    expect(JSON.parse(g.localStorage!.getItem('iynk:v1')!)).toEqual({ v: 1, done: {}, quiz: {}, best: {}, settings: { sound: true, theme: 'dark' } });
    expect(told).toBe(1);
  });
});
