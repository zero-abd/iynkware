/**
 * The project library behind `ShellLibrary` (./types.ts): iynk's repository and library (`src/local`, imported
 * unchanged) over database `iynk`, autosave of the project on the bench, `.iynk` files and `#project=` links.
 * Everything the browser provides comes in through `LibraryEnv`, so the Node tests run it on iynk's memory repository.
 */
import { cryptoRandom, newProjectId, type RandomSource } from '@/core/ids';
import { openDb } from '@/local/db';
import { createIdbRepository } from '@/local/idb-repository';
import { createLibrary, type Library } from '@/local/library';
import { createMemoryRepository } from '@/local/memory-repository';
import type { IndexRow, Repository } from '@/local/repository';
import { forkProject } from '@/project/fork';
import { stateHash } from '@/project/hash';
import type { Op } from '@/project/generated/types';
import type { XrApp } from '../../contracts/app';
import type { Project } from '../../contracts/project';
import { value } from '../../ui/value';
import { say } from '../copy';
import { LIBRARY, textOf, type LibraryKey } from './copy';
import { codeOf, docFromLink, downloadBytes, fileNameOf, iynkBytes, linkFor, readProjectFile } from './files';
import type { LibraryRow, LibraryState, LinkResult, ShellLibrary } from './types';

/** What the library needs of the app. */
export type LibraryApp = Pick<XrApp, 'project' | 'shell' | 'settings' | 'guide' | 'templates'> & { readonly lessons?: Pick<XrApp['lessons'], 'close'> };

export interface LibraryEnv {
  /** Skips opening IndexedDB (tests). */
  repo?: Repository;
  clock?: () => number;
  rnd?: RandomSource;
  /** Holds `iynk:xr:shell:v1`. Null: nothing is remembered. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  location?: { origin: string; pathname: string; search: string; hash: string } | null;
  history?: { state: unknown; replaceState(state: unknown, unused: string, url?: string): void } | null;
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | null;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  download?: (name: string, bytes: Uint8Array) => void;
  debounceMs?: number;
}

export interface LibraryHandle extends ShellLibrary {
  /** Opens storage, lists, then opens what the address or the last session names. Never rejects. */
  start(): Promise<void>;
  /** Flushes what is pending and lets go of the page. */
  stop(): void;
}

export const SHELL_KEY = 'iynk:xr:shell:v1';
const ACTOR = 'usr_local';
const MAX_TITLE = 120;
const DEBOUNCE_MS = 1000;
const MAX_WAIT_MS = 5000;

const isQuota = (e: unknown): boolean =>
  (typeof e === 'object' && e !== null && ((e as { kind?: unknown }).kind === 'quota' || (e as { name?: unknown }).name === 'QuotaExceededError')) ||
  (e instanceof Error && /quota/i.test(e.message));

const clamp = (title: string): string => title.trim().slice(0, MAX_TITLE);

function browserEnv(): LibraryEnv {
  const g = globalThis as Partial<typeof globalThis>;
  let storage: LibraryEnv['storage'] = null;
  try {
    storage = g.localStorage ?? null;
  } catch {
    storage = null;
  }
  return {
    storage,
    location: g.location ?? null,
    history: g.history ?? null,
    doc: g.document ?? null,
    win: g.window ?? null,
    download: downloadBytes,
  };
}

export function createShellLibrary(app: LibraryApp, given: LibraryEnv = {}): LibraryHandle {
  const env: LibraryEnv = { ...browserEnv(), ...given };
  const clock = env.clock ?? (() => Date.now());
  const rnd = env.rnd ?? cryptoRandom;
  const debounceMs = env.debounceMs ?? DEBOUNCE_MS;

  const rows = value<readonly LibraryRow[]>([]);
  const state = value<LibraryState>('loading');
  const current = value<string | null>(null);
  const last = value<LibraryRow | null>(null);

  let repo!: Repository;
  let lib!: Library;
  let lastId: string | null = null;
  const lang = () => app.settings.lang.value;
  const t = (key: LibraryKey, params?: Record<string, string | number>) => say(LIBRARY, lang(), key, params);

  // ---- notices ----
  let fullNotice: (() => void) | null = null;
  const noteFull = () => {
    state.set('full');
    fullNotice?.();
    fullNotice = app.shell.notify({
      id: 'storage-full',
      tone: 'fail',
      text: textOf('full'),
      action: { label: textOf('exportProject'), run: () => void exportCurrent() },
    });
  };
  const clearFull = () => {
    if (state.value === 'full') state.set('ok');
    fullNotice?.();
    fullNotice = null;
  };
  const noteUnavailable = () => {
    state.set('unavailable');
    app.shell.notify({ id: 'storage-unavailable', tone: 'warn', text: textOf('unavailable') });
  };

  const exportCurrent = async () => {
    const id = current.value;
    if (id !== null) await exportFile(id);
  };

  // ---- storage ----
  let readyResolve!: () => void;
  const ready = new Promise<void>((r) => (readyResolve = r));

  async function init(): Promise<void> {
    if (env.repo) repo = env.repo;
    else {
      try {
        repo = createIdbRepository(await openDb(() => state.set('unavailable')));
      } catch {
        repo = createMemoryRepository();
        noteUnavailable();
      }
    }
    lib = createLibrary({ repo, clock, rnd, actor: ACTOR });
    lastId = readLast();
    if (state.value === 'loading') state.set('ok');
    readyResolve();
    await refresh();
  }

  function readLast(): string | null {
    try {
      const v = JSON.parse(env.storage?.getItem(SHELL_KEY) ?? 'null') as { last?: unknown } | null;
      return typeof v?.last === 'string' ? v.last : null;
    } catch {
      return null;
    }
  }

  function writeLast(id: string): void {
    try {
      const old = JSON.parse(env.storage?.getItem(SHELL_KEY) ?? 'null') as Record<string, unknown> | null;
      env.storage?.setItem(SHELL_KEY, JSON.stringify({ ...(old && typeof old === 'object' ? old : {}), last: id }));
    } catch {
      /* storage blocked: the last project is not remembered */
    }
  }

  function setLast(id: string): void {
    lastId = id;
    writeLast(id);
    last.set(rows.value.find((r) => r.id === id) ?? null);
  }

  function boardName(ref: string): string {
    if (!ref) return '';
    const d = app.project.describe(ref) as { identity?: { model?: unknown } } | undefined;
    return typeof d?.identity?.model === 'string' ? d.identity.model : '';
  }

  async function refresh(): Promise<void> {
    try {
      const list = await lib.list();
      rows.set(list.map((r) => ({ id: r.id, title: r.name, updatedAt: r.updatedAt, board: boardName(r.board) })));
      last.set(lastId === null ? null : (rows.value.find((r) => r.id === lastId) ?? null));
    } catch (e) {
      if (isQuota(e)) noteFull();
    }
  }

  async function guarded<T>(fn: () => Promise<T>): Promise<T> {
    await ready;
    try {
      return await fn();
    } catch (e) {
      if (isQuota(e)) noteFull();
      throw e;
    }
  }

  // ---- autosave ----
  const bases = new Map<string, { revision: number; hash: string }>();
  let pending: Project | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<void> = Promise.resolve();
  let opening = false;

  const rowOf = (doc: Project, hash: string): IndexRow => ({
    name: doc.meta.title,
    updatedAt: doc.meta.updatedAt,
    hash,
    board: doc.boards[0]?.definition.ref ?? '',
    size: iynkBytes(doc).length,
    hasFileCopy: false,
    archived: false,
  });

  function clearTimers(): void {
    if (timer !== null) clearTimeout(timer);
    if (maxTimer !== null) clearTimeout(maxTimer);
    timer = maxTimer = null;
  }

  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void flush(), debounceMs);
    maxTimer ??= setTimeout(() => void flush(), MAX_WAIT_MS);
  }

  /** Writes the pending document. Saves run one at a time, in order; a failed one keeps its document for the next try. */
  function flush(): Promise<void> {
    clearTimers();
    queue = queue.then(saveNow, saveNow);
    return queue;
  }

  async function saveNow(): Promise<void> {
    await ready;
    const doc = pending;
    if (doc === null) return;
    pending = null;
    try {
      const hash = stateHash(doc);
      const rec = { doc, hash, writtenAt: clock() };
      const row = rowOf(doc, hash);
      let res = await repo.save(doc.id, rec, row, bases.get(doc.id) ?? null);
      if (!res.ok && res.kind === 'conflict') {
        // Another tab wrote this project: take its revision as the base and write over it, as the Studio's last writer wins.
        const found = await repo.load(doc.id);
        if (found.status === 'ok' || found.status === 'recovered') bases.set(doc.id, { revision: found.rec.doc.revision, hash: found.rec.hash });
        else bases.delete(doc.id);
        res = await repo.save(doc.id, rec, row, bases.get(doc.id) ?? null);
      }
      if (res.ok) {
        bases.set(doc.id, { revision: doc.revision, hash });
        if (state.value === 'full') clearFull();
        await refresh();
        return;
      }
      pending ??= doc;
      if (res.kind === 'quota') noteFull();
      else if (res.kind === 'unavailable' && state.value !== 'unavailable') noteUnavailable();
    } catch (e) {
      pending ??= doc;
      if (isQuota(e)) noteFull();
    }
  }

  // ---- what is on the bench ----
  /** The bench's starting document (the boot template) until the person edits it or something else opens. */
  let templateId: string | null = null;
  let forkQueued = false;

  /** Puts a library project on the bench; an open lesson ends first, since the bench is no longer its document. */
  function putOnBench(doc: Project): void {
    opening = true;
    try {
      if (app.guide.value !== null) app.lessons?.close();
      app.project.open(doc);
    } finally {
      opening = false;
    }
  }

  function onChange(change: { origin: string }): void {
    if (opening) return;
    if (change.origin === 'load') {
      // Another pillar opened a document: keep the old project's last edits, and stop saving into it.
      if (pending !== null) void flush();
      current.set(null);
      templateId = null;
      return;
    }
    if (app.guide.value !== null) return;
    if (current.value !== null) {
      pending = app.project.doc;
      schedule();
      return;
    }
    if (templateId !== null && app.project.doc.id === templateId && !forkQueued) {
      forkQueued = true;
      queueMicrotask(forkTemplate);
    }
  }

  /** The first edit of a template with nothing current: the edited document becomes a new library project. */
  function forkTemplate(): void {
    forkQueued = false;
    const src = app.project.doc;
    if (current.value !== null || app.guide.value !== null || templateId === null || src.id !== templateId) return;
    const now = new Date(clock()).toISOString();
    const fork = forkProject(src, { id: newProjectId(clock(), rnd), now, actor: ACTOR, title: clamp(src.meta.title) || t('untitled') });
    const selected = app.project.selection.ids;
    templateId = null;
    putOnBench(fork);
    app.project.selection.set(selected);
    current.set(fork.id);
    setLast(fork.id);
    pending = fork;
    void flush();
    app.shell.notify({ id: 'library/saved-new', tone: 'info', text: textOf('savedNew'), ms: 4000 });
  }

  // ---- ShellLibrary ----
  async function open(id: string): Promise<void> {
    await guarded(async () => {
      await flush();
      const found = await repo.load(id);
      if (found.status === 'missing' || found.status === 'lost') throw new Error(`project ${id} cannot be opened`);
      bases.set(id, { revision: found.rec.doc.revision, hash: found.rec.hash });
      putOnBench(found.rec.doc);
      templateId = null;
      current.set(id);
      setLast(id);
    });
  }

  async function create(opts: { title?: string; template?: string } = {}): Promise<string> {
    const id = await guarded(async () => {
      if (opts.template !== undefined) {
        const doc = await app.templates.load(opts.template);
        return lib.forkDocument(doc, { title: clamp(opts.title ?? doc.meta.title) || t('untitled') });
      }
      return lib.create({ board: 'uno', title: clamp(opts.title ?? '') || t('untitled') });
    });
    await open(id);
    await refresh();
    return id;
  }

  async function rename(id: string, title: string): Promise<void> {
    const next = clamp(title);
    if (next.length === 0) throw new Error('a title is 1 to 120 characters');
    if (id === current.value) {
      const res = app.project.apply({ k: 'meta.set', set: { title: next } } as Op);
      if (!res.ok) throw new Error(res.message);
      pending = app.project.doc;
      await flush();
      return;
    }
    await guarded(() => lib.rename(id, next));
    await refresh();
  }

  async function duplicate(id: string): Promise<string> {
    const copy = await guarded(async () => {
      if (id === current.value) await flush();
      const found = await repo.load(id);
      if (found.status === 'missing' || found.status === 'lost') throw new Error(`project ${id} cannot be read`);
      return lib.fork(id, { title: clamp(t('copyOf', { title: found.rec.doc.meta.title })) });
    });
    await refresh();
    return copy;
  }

  async function remove(id: string): Promise<void> {
    if (id === current.value) {
      // The bench keeps the document; its next edit saves it as a new project, so nothing is lost.
      clearTimers();
      pending = null;
      current.set(null);
      templateId = app.project.doc.id;
    }
    await guarded(async () => {
      await queue;
      await lib.trash(id);
      bases.delete(id);
    });
    await refresh();
  }

  async function docOf(id: string): Promise<Project> {
    if (id === current.value) return app.project.doc;
    await ready;
    const found = await repo.load(id);
    if (found.status === 'missing' || found.status === 'lost') throw new Error(`project ${id} cannot be read`);
    return found.rec.doc;
  }

  async function exportFile(id: string): Promise<void> {
    const doc = await docOf(id);
    (env.download ?? downloadBytes)(fileNameOf(doc.meta.title), iynkBytes(doc));
  }

  async function importFile(file: Blob & { readonly name?: string }): Promise<string> {
    const { project, assets } = await readProjectFile(new Uint8Array(await file.arrayBuffer()), clock);
    const id = await guarded(async () => {
      for (const a of assets) await repo.getStore('assets').put(a.sha256, new Blob([a.bytes as BlobPart]));
      return lib.forkDocument(project, { title: clamp(project.meta.title) || t('untitled') });
    });
    await refresh();
    return id;
  }

  async function shareLink(id: string): Promise<LinkResult> {
    let doc: Project;
    try {
      doc = await docOf(id);
    } catch {
      return { ok: false, reason: 'failed' };
    }
    const at = env.location ?? { origin: '', pathname: '/' };
    return linkFor(doc, at, lang());
  }

  async function openLink(text: string): Promise<string> {
    const code = codeOf(text);
    if (code === null) throw new Error('not a project link');
    const doc = await docFromLink(code);
    const id = await guarded(() => lib.forkDocument(doc, { title: clamp(t('shared', { title: doc.meta.title })) }));
    await open(id);
    await refresh();
    return id;
  }

  // ---- page ----
  const onVisibility = () => {
    if (env.doc?.visibilityState === 'hidden') void flush();
  };
  const onHide = () => void flush();
  let unsubscribe: (() => void) | null = null;

  function clearFragment(): void {
    const { location, history } = env;
    if (!location || !history) return;
    try {
      history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    } catch {
      /* the address stays as it is */
    }
  }

  async function start(): Promise<void> {
    templateId = app.project.doc.id;
    unsubscribe = app.project.subscribe(onChange);
    env.doc?.addEventListener('visibilitychange', onVisibility);
    env.win?.addEventListener('pagehide', onHide);
    try {
      await init();
    } catch {
      readyResolve();
      return;
    }
    const code = env.location ? codeOf(env.location.hash) : null;
    try {
      if (code !== null && env.location?.hash.startsWith('#project=')) {
        try {
          await openLink(code);
        } catch {
          app.shell.notify({ id: 'library/bad-link', tone: 'warn', text: textOf('badLink'), ms: 6000 });
        } finally {
          clearFragment();
        }
      } else if (lastId !== null && rows.value.some((r) => r.id === lastId)) {
        await open(lastId);
      }
    } catch {
      /* the bench stays as boot made it */
    }
  }

  function stop(): void {
    unsubscribe?.();
    unsubscribe = null;
    env.doc?.removeEventListener('visibilitychange', onVisibility);
    env.win?.removeEventListener('pagehide', onHide);
    void flush();
  }

  return { rows, state, current, last, create, open, rename, duplicate, remove, exportFile, importFile, shareLink, openLink, start, stop };
}
