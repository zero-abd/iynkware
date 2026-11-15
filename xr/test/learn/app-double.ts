/**
 * A headless app double for the lesson session tests: the real project store and progress store (memory rows), a fake
 * simulation that only records calls and states. The check runner is iynk's real one, inline (Node has no Worker).
 */
import { memoryLearnKv } from '@/local/progress';
import type { XrApp } from '../../src/contracts/app';
import type { Lang } from '../../src/contracts/common';
import type { Project } from '../../src/contracts/project';
import type { RunState } from '../../src/contracts/sim';
import { createLessonSlot } from '../../src/learn/launcher';
import { createProgressStore } from '../../src/learn/progress';
import { createProjectStore } from '../../src/project/store';
import { value } from '../../src/ui/value';

export class MemoryStorage {
  private m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, String(v));
  removeItem = (k: string) => void this.m.delete(k);
}

export function fakeSim() {
  let state: RunState = 'unloaded';
  const fns = new Set<(s: RunState) => void>();
  const set = (s: RunState) => {
    state = s;
    for (const fn of [...fns]) fn(s);
  };
  const calls: string[] = [];
  return {
    calls,
    get state() {
      return state;
    },
    async load(doc: Project) {
      calls.push(`load:${doc.id}`);
      set('idle');
      return { ok: true, diagnostics: [] };
    },
    async stop() {
      calls.push('stop');
      if (state !== 'unloaded') set('idle');
    },
    async run() {
      calls.push('run');
      set('running');
    },
    onState(fn: (s: RunState) => void) {
      fns.add(fn);
      return () => void fns.delete(fn);
    },
  };
}

export function rig(doc: Project) {
  const lessons = createLessonSlot();
  const sim = fakeSim();
  const lang = value<Lang>('en');
  const progress = createProgressStore({ kv: memoryLearnKv() });
  const app = { project: createProjectStore(doc), sim, settings: { lang }, progress, lessons, guide: lessons.guide } as unknown as XrApp;
  return { app, sim, lang, progress };
}
