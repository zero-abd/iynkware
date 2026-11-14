/**
 * Progress shared with the 2D site, in iynk's own shapes:
 *  - learner records: iynk's `createLearnStore` over `createProgressRepo` and IndexedDB (`src/local/`), the same
 *    `progress` store and `learn:<projectId>` rows the 2D app reads and writes;
 *  - the `done` map of `localStorage["iynk:v1"]`, keys from iynk's `keyForProject` (`src/lib/learn/facade.ts`). A
 *    record that gains its completion sets its template's key, so a lesson done here is done on the 2D site too.
 * The `iynk:v1` write is read-modify-write and keeps every other field of the document as it is. iynk's storage module
 * is not imported: it mirrors through the 2D app's facade singleton, which the headset does not run.
 */
import { keyForProject } from '@/lib/learn/facade';
import type { Saved } from '@/lib/progress/storage';
import { createLearnStore } from '@/local/learn-store';
import { createProgressRepo, idbLearnKv, memoryLearnKv, type LearnKv } from '@/local/progress';
import { emptyRecord, type LearnerRecord } from '@/project/guided/record';
import type { XrApp } from '../contracts/app';
import type { ItemProgress, LearnProgress } from './types';

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

function save(doc: Saved): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(doc));
  } catch {
    /* storage blocked */
  }
}

/**
 * IndexedDB's `progress` store when the browser has one. Node (the unit tests) has no IndexedDB, and a browser can
 * refuse it (private mode, blocked by another tab): then the records live in memory for this page only.
 */
function defaultKv(): LearnKv {
  let opened: Promise<LearnKv> | undefined;
  const open = () =>
    (opened ??= typeof indexedDB === 'undefined' ? Promise.resolve(memoryLearnKv()) : idbLearnKv().catch(() => memoryLearnKv()));
  return {
    get: async (key) => (await open()).get(key),
    put: async (key, value) => (await open()).put(key, value),
    delete: async (key) => (await open()).delete(key),
    entries: async () => (await open()).entries(),
  };
}

const templateOfRecord = (r: LearnerRecord) => r.templateId ?? r.projectId;
const keyOfRecord = (r: LearnerRecord) => keyForProject(templateOfRecord(r));

/** Anything the person did in it: a step, an item, an answer, a run, an edit or a hint. */
const touched = (r: LearnerRecord) =>
  Object.keys(r.steps).length > 0 ||
  Object.keys(r.items ?? {}).length > 0 ||
  Object.keys(r.quiz).length > 0 ||
  r.lastRun !== undefined ||
  r.editedAt !== undefined ||
  r.hintsMax > 0;

export interface ProgressOptions {
  /** Where the records are kept; IndexedDB (or memory, see `defaultKv`) when omitted. Tests pass `memoryLearnKv()`. */
  readonly kv?: LearnKv;
}

export function createProgressStore(opts: ProgressOptions = {}): LearnProgress {
  const fns = new Set<() => void>();
  let muted = false;
  const notify = () => {
    if (!muted) for (const fn of [...fns]) fn();
  };
  globalThis.addEventListener?.('storage', (e: StorageEvent) => {
    if (e.key === KEY) notify();
  });

  const store = createLearnStore(createProgressRepo(opts.kv ?? defaultKv()));
  let hydrated = false;
  const ready = store.ready.then(() => {
    hydrated = true;
  });

  /** Records whose update gave them their completion; their keys are set once the store has published them. */
  const gained: LearnerRecord[] = [];
  const setKeys = (records: readonly LearnerRecord[]) => {
    const keys = records.map(keyOfRecord).filter((k): k is string => k !== null);
    const doc = load();
    const fresh = keys.filter((k) => doc.done[k] !== true);
    if (fresh.length === 0) return;
    for (const k of fresh) doc.done[k] = true;
    save(doc);
  };
  store.subscribe(() => {
    setKeys(gained.splice(0));
    notify();
  });

  const statusIn = (done: Saved['done'], templateId: string): ItemProgress => {
    const key = keyForProject(templateId);
    if (key && done[key] === true) return 'done';
    let started = false;
    for (const r of store.snapshot().values()) {
      if (templateOfRecord(r) !== templateId) continue;
      if (r.completion) return 'done';
      if (touched(r)) started = true;
    }
    return started ? 'started' : 'none';
  };

  /** Every record back to empty (same project, template and start time). Waits for the stored records to load. */
  const clearRecords = () => {
    const now = new Date().toISOString();
    muted = true;
    try {
      for (const r of store.snapshot().values()) {
        if (!r.completion && !touched(r)) continue;
        store.update(r.projectId, (cur) => emptyRecord(r.projectId, cur?.startedAt ?? now, cur?.templateId ?? r.templateId), now);
      }
    } finally {
      muted = false;
    }
  };

  return {
    ready,
    isDone(key) {
      if (load().done[key] === true) return true;
      for (const r of store.snapshot().values()) if (r.completion && keyOfRecord(r) === key) return true;
      return false;
    },
    markDone(key) {
      const doc = load();
      if (doc.done[key]) return;
      doc.done[key] = true;
      save(doc);
      notify();
    },
    reset() {
      const doc = load();
      doc.done = {};
      doc.quiz = {};
      doc.best = {};
      save(doc);
      if (hydrated) clearRecords();
      else
        void ready.then(() => {
          clearRecords();
          notify();
        });
      notify();
    },
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    record: (projectId) => store.get(projectId),
    update(projectId, fn) {
      store.update(
        projectId,
        (r) => {
          const next = fn(r);
          if (next.completion && !r?.completion) gained.push(next);
          return next;
        },
        new Date().toISOString(),
      );
    },
    statusOf: (templateId) => statusIn(load().done, templateId),
    count(templateIds) {
      const done = load().done;
      return { done: templateIds.filter((id) => statusIn(done, id) === 'done').length, total: templateIds.length };
    },
  };
}

/** `app.progress` as learn's full store (it is always one: `app.ts` builds it with `createProgressStore`). */
export function learnProgress(app: XrApp): LearnProgress {
  return app.progress as LearnProgress;
}
