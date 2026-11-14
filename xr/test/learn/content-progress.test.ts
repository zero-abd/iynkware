/** Learn progress: iynk's learner records and the iynk:v1 done map kept in step. */
import { memoryLearnKv } from '@/local/progress';
import { emptyRecord, withCompletion, withStep } from '@/project/guided/record';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProgressStore } from '../../src/learn/progress';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, String(v));
  removeItem = (k: string) => void this.m.delete(k);
}

const g = globalThis as unknown as { localStorage?: MemoryStorage };
const saved = () => JSON.parse(g.localStorage!.getItem('iynk:v1') ?? '{}') as { done?: Record<string, true> };
const NOW = '2026-11-14T10:00:00.000Z';
const BLINK = 'prj_uno-r3-blink';
const BLINK_KEY = 'board:uno-r3:lesson:blink';
const complete = { gates: { checks: true, edit: null, quiz: null, goal: null }, tier: 'T0' as const, sourceSha256: 'x', hintsMax: 0 as const, engineVersions: {}, legacy: false };

beforeEach(() => {
  g.localStorage = new MemoryStorage();
});
afterEach(() => {
  delete g.localStorage;
});

describe('learn progress', () => {
  it('keeps records in the progress rows and reads them back in a new store', async () => {
    const kv = memoryLearnKv();
    const a = createProgressStore({ kv });
    await a.ready;
    a.update('prj_fork1', (r) => withStep(r ?? emptyRecord('prj_fork1', NOW, BLINK), 0, 'manual', NOW));
    expect(a.record('prj_fork1')?.steps['0']?.by).toBe('manual');
    await new Promise((r) => setTimeout(r, 300));
    expect((await kv.entries()).map(([k]) => k)).toEqual(['learn:prj_fork1']);
    const b = createProgressStore({ kv });
    await b.ready;
    expect(b.record('prj_fork1')).toEqual(a.record('prj_fork1'));
    expect(b.statusOf(BLINK)).toBe('started');
  });

  it('sets the iynk:v1 done key when a record gains its completion', async () => {
    const p = createProgressStore({ kv: memoryLearnKv() });
    await p.ready;
    let told = 0;
    p.subscribe(() => told++);
    expect(p.statusOf(BLINK)).toBe('none');
    p.update('prj_fork1', (r) => withStep(r ?? emptyRecord('prj_fork1', NOW, BLINK), 0, 'gate', NOW));
    expect(saved().done?.[BLINK_KEY]).toBeUndefined();
    p.update('prj_fork1', (r) => withCompletion(r!, complete, NOW));
    expect(saved().done?.[BLINK_KEY]).toBe(true);
    expect(p.isDone(BLINK_KEY)).toBe(true);
    expect(p.statusOf(BLINK)).toBe('done');
    expect(p.count([BLINK, 'prj_uno-r3-button', 'prj_uno-r3-knob'])).toEqual({ done: 1, total: 3 });
    expect(told).toBe(2);
  });

  it('counts a lesson the 2D site marked done, and reset clears the map and the records', async () => {
    g.localStorage!.setItem('iynk:v1', JSON.stringify({ v: 1, done: { 'board:uno-r3:lesson:button': true }, quiz: {}, best: {}, settings: { sound: true } }));
    const p = createProgressStore({ kv: memoryLearnKv() });
    await p.ready;
    expect(p.statusOf('prj_uno-r3-button')).toBe('done');
    p.update('prj_fork1', (r) => withCompletion(withStep(r ?? emptyRecord('prj_fork1', NOW, BLINK), 0, 'gate', NOW), complete, NOW));
    expect(p.count([BLINK, 'prj_uno-r3-button'])).toEqual({ done: 2, total: 2 });
    p.reset();
    expect(saved()).toEqual({ v: 1, done: {}, quiz: {}, best: {}, settings: { sound: true } });
    expect(p.statusOf(BLINK)).toBe('none');
    expect(p.record('prj_fork1')).toEqual(emptyRecord('prj_fork1', NOW, BLINK));
    expect(p.isDone(BLINK_KEY)).toBe(false);
  });

  it('keeps markDone and isDone working on the done map', () => {
    const p = createProgressStore({ kv: memoryLearnKv() });
    p.markDone('robotics:l298n:task:square');
    expect(p.isDone('robotics:l298n:task:square')).toBe(true);
    expect(p.statusOf('prj_robotics-l298n-square')).toBe('done');
  });
});
