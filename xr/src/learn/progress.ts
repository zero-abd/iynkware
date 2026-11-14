/**
 * Progress shared with the 2D site: the `done` map of `localStorage["iynk:v1"]`, keys from iynk's
 * `src/lib/progress/keys.ts`. Ported, not imported: iynk's storage module also mirrors into IndexedDB through its
 * learn facade, which the headset does not load. A write keeps every other field of the document as it is.
 */
import type { Saved } from '@/lib/progress/storage';
import type { ProgressStore } from '../contracts/lesson';

const KEY = 'iynk:v1';

/** The 2D site's defaults (src/lib/progress/storage.ts `DEFAULT_SETTINGS`), used only when nothing is saved yet. */
const EMPTY: Saved = {
  v: 1,
  done: {},
  quiz: {},
  best: {},
  settings: { theme: 'light', sound: false, lofi: false, labels: true, reduceMotion: false, englishTerms: true, telemetry: false },
};

function load(): Saved {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const doc = raw ? (JSON.parse(raw) as Saved) : null;
    return doc && doc.v === 1 && typeof doc.done === 'object' ? doc : structuredClone(EMPTY);
  } catch {
    return structuredClone(EMPTY);
  }
}

export function createProgressStore(): ProgressStore {
  const fns = new Set<() => void>();
  const notify = () => fns.forEach((fn) => fn());
  globalThis.addEventListener?.('storage', (e: StorageEvent) => {
    if (e.key === KEY) notify();
  });
  return {
    isDone: (key) => load().done[key] === true,
    markDone(key) {
      const doc = load();
      if (doc.done[key]) return;
      doc.done[key] = true;
      try {
        globalThis.localStorage?.setItem(KEY, JSON.stringify(doc));
      } catch {
        /* storage blocked */
      }
      notify();
    },
    reset() {
      const doc = load();
      doc.done = {};
      doc.quiz = {};
      doc.best = {};
      try {
        globalThis.localStorage?.setItem(KEY, JSON.stringify(doc));
      } catch {
        /* storage blocked */
      }
      notify();
    },
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
}
