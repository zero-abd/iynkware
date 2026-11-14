/** Settings keep the chosen language in the 2D site's cookie; Reset progress clears lesson progress and keeps settings. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProgressStore } from '../src/learn/progress';
import { DEFAULT_XR_SETTINGS } from '../src/contracts/settings';
import { createSettingsStore, initialXrSettings } from '../src/shell/settings';

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

describe('headset settings', () => {
  it('defaults to 3x, sound on, and every new field present', () => {
    const s = createSettingsStore().xr.value;
    expect(s.benchScale).toBe(3);
    expect(s.sound).toBe(true);
    expect(s.volumes).toEqual(DEFAULT_XR_SETTINGS.volumes);
    expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_XR_SETTINGS).sort());
  });

  it('starts reduced motion and room light from the 2D settings, never sound', () => {
    const s = initialXrSettings(null, { reduceMotion: true, theme: 'dark', sound: false });
    expect([s.reducedMotion, s.roomLight, s.sound]).toEqual([true, 'dim', true]);
    expect(initialXrSettings(null, { theme: 'system' }, true).roomLight).toBe('dim');
    expect(initialXrSettings(null, { theme: 'system' }, false).roomLight).toBe('bright');
  });

  it('keeps valid saved fields over the 2D ones and drops invalid ones', () => {
    const saved = { reducedMotion: false, roomLight: 'bright', benchScale: 4, textScale: 2, flightMode: 3, volumes: { alerts: 0.2, bench: 7 } };
    const s = initialXrSettings(saved, { reduceMotion: true, theme: 'dark' });
    expect([s.reducedMotion, s.roomLight, s.benchScale]).toEqual([false, 'bright', 4]);
    expect([s.textScale, s.flightMode]).toEqual([1, 2]);
    expect(s.volumes).toEqual({ ...DEFAULT_XR_SETTINGS.volumes, alerts: 0.2 });
  });

  it('reads iynk:xr:v1 and iynk:v1 from storage and saves a change', () => {
    g.localStorage!.setItem('iynk:v1', JSON.stringify({ v: 1, settings: { reduceMotion: true } }));
    g.localStorage!.setItem('iynk:xr:v1', JSON.stringify({ textScale: 1.25 }));
    const store = createSettingsStore();
    expect([store.xr.value.reducedMotion, store.xr.value.textScale]).toEqual([true, 1.25]);
    store.setXr({ highContrast: true });
    expect(JSON.parse(g.localStorage!.getItem('iynk:xr:v1')!).highContrast).toBe(true);
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
