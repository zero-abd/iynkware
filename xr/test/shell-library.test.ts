/** The project library: iynk's memory repository, a real project store and shell service, a fake page. */
import { createMemoryRepository } from '@/local/memory-repository';
import type { Repository } from '@/local/repository';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LessonGuide } from '../src/contracts/lesson';
import type { Project } from '../src/contracts/project';
import { createProjectStore, createTemplateSource } from '../src/project/store';
import { createShellService } from '../src/shell/service';
import { createShellLibrary, SHELL_KEY, type LibraryApp, type LibraryEnv } from '../src/shell/library/library';
import { value } from '../src/ui/value';

const TEMPLATE = 'prj_uno-r3-blink';
const templates = createTemplateSource();
let template: Project;
let tick: number;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
  tick = Date.parse('2026-11-14T10:00:00Z');
  template ??= await templates.load(TEMPLATE);
});
afterEach(() => vi.useRealTimers());

const retitle = (title: string) => ({ k: 'meta.set', set: { title } }) as never;

function makeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

interface Rig {
  app: LibraryApp & { guide: ReturnType<typeof value<LessonGuide | null>> };
  lib: ReturnType<typeof createShellLibrary>;
  repo: Repository;
  downloads: Array<{ name: string; bytes: Uint8Array }>;
  loc: { origin: string; pathname: string; search: string; hash: string };
  replaceState: ReturnType<typeof vi.fn>;
  storage: ReturnType<typeof makeStorage>;
}

async function rig(over: Partial<LibraryEnv> & { hash?: string; start?: boolean } = {}): Promise<Rig> {
  const guide = value<LessonGuide | null>(null);
  const app = {
    project: createProjectStore(template),
    shell: createShellService(),
    settings: { lang: value('en') },
    guide,
    templates,
  } as unknown as Rig['app'];
  const repo = over.repo ?? createMemoryRepository();
  const downloads: Rig['downloads'] = [];
  const loc = { origin: 'https://iynk.test', pathname: '/xr/', search: '?a=1', hash: over.hash ?? '' };
  const replaceState = vi.fn(() => void (loc.hash = ''));
  const storage = over.storage === undefined ? makeStorage() : (over.storage as ReturnType<typeof makeStorage>);
  const lib = createShellLibrary(app, {
    repo,
    clock: () => (tick += 1000),
    storage,
    location: loc,
    history: { state: null, replaceState },
    doc: null,
    win: null,
    download: (name, bytes) => void downloads.push({ name, bytes }),
    ...over,
  });
  if (over.start !== false) await lib.start();
  return { app, lib, repo, downloads, loc, replaceState, storage };
}

const stored = async (repo: Repository, id: string) => {
  const r = await repo.load(id);
  return r.status === 'ok' || r.status === 'recovered' ? r.rec.doc : null;
};

describe('projects', () => {
  it('creates, renames, duplicates and removes, newest first', async () => {
    const { lib, app } = await rig();
    const a = await lib.create({ title: 'A' });
    const b = await lib.create({ title: 'B' });
    expect(lib.rows.value.map((r) => r.title)).toEqual(['B', 'A']);
    expect(lib.rows.value[0]!.board).toBe('Arduino UNO Rev3');
    expect(lib.current.value).toBe(b);
    expect(app.project.doc.id).toBe(b);

    await lib.rename(a, 'A renamed');
    expect(lib.rows.value.find((r) => r.id === a)?.title).toBe('A renamed');

    await lib.rename(b, 'B renamed');
    expect(app.project.doc.meta.title).toBe('B renamed');
    expect(lib.rows.value.find((r) => r.id === b)?.title).toBe('B renamed');

    const copy = await lib.duplicate(a);
    expect(lib.rows.value.find((r) => r.id === copy)?.title).toBe('A renamed copy');
    expect(lib.current.value).toBe(b);

    await lib.remove(a);
    expect(lib.rows.value.some((r) => r.id === a)).toBe(false);
    await lib.remove(b);
    expect(lib.current.value).toBeNull();
    expect(lib.rows.value.map((r) => r.id)).toEqual([copy]);
  });

  it('names an untitled project in the app language and creates from a template', async () => {
    const { lib } = await rig();
    const id = await lib.create();
    expect(lib.rows.value[0]?.title).toBe('Untitled project');
    const fromTemplate = await lib.create({ template: TEMPLATE });
    expect(lib.rows.value.find((r) => r.id === fromTemplate)?.title).toBe(template.meta.title);
    expect(id).not.toBe(fromTemplate);
  });

  it('remembers the last project and opens it on the next start', async () => {
    const first = await rig();
    const id = await first.lib.create({ title: 'Keep me' });
    expect(JSON.parse(first.storage.getItem(SHELL_KEY)!)).toEqual({ last: id });
    expect(first.lib.last.value?.id).toBe(id);
    first.lib.stop();
    const second = await rig({ repo: first.repo, storage: first.storage as never });
    expect(second.lib.current.value).toBe(id);
    expect(second.app.project.doc.id).toBe(id);
    expect(second.lib.last.value?.title).toBe('Keep me');
  });
});

describe('autosave', () => {
  it('saves once, about a second after the last change', async () => {
    const { lib, app, repo } = await rig();
    const id = await lib.create({ title: 'Auto' });
    const save = vi.spyOn(repo, 'save');
    app.project.apply(retitle('One'));
    await vi.advanceTimersByTimeAsync(600);
    app.project.apply(retitle('Two'));
    await vi.advanceTimersByTimeAsync(600);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect((await stored(repo, id))?.meta.title).toBe('Two');
    expect(lib.rows.value[0]?.title).toBe('Two');
  });

  it('flushes when the page hides or goes away', async () => {
    const listeners = new Map<string, () => void>();
    const doc = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (n: string, f: () => void) => void listeners.set(n, f),
      removeEventListener: () => undefined,
    };
    const win = { addEventListener: (n: string, f: () => void) => void listeners.set(n, f), removeEventListener: () => undefined };
    const { lib, app, repo } = await rig({ doc: doc as never, win: win as never });
    const id = await lib.create({ title: 'Hide' });
    app.project.apply(retitle('Hidden'));
    doc.visibilityState = 'hidden';
    listeners.get('visibilitychange')!();
    await vi.advanceTimersByTimeAsync(0);
    expect((await stored(repo, id))?.meta.title).toBe('Hidden');
    app.project.apply(retitle('Gone'));
    listeners.get('pagehide')!();
    await vi.advanceTimersByTimeAsync(0);
    expect((await stored(repo, id))?.meta.title).toBe('Gone');
  });

  it('flushes on teardown', async () => {
    const { lib, app, repo } = await rig();
    const id = await lib.create({ title: 'Stop' });
    app.project.apply(retitle('Stopped'));
    lib.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect((await stored(repo, id))?.meta.title).toBe('Stopped');
  });

  it('keeps a change when a save fails and retries on the next change', async () => {
    const real = createMemoryRepository();
    let fail = true;
    const repo: Repository = {
      ...real,
      save: async (...args) => (fail ? { ok: false, kind: 'blocked', detail: 'busy' } : real.save(...args)),
    };
    const { lib, app } = await rig({ repo });
    const id = await lib.create({ title: 'Retry' }).catch(() => null);
    expect(id).toBeNull(); // the first write failed too: nothing was made
    fail = false;
    const made = await lib.create({ title: 'Retry' });
    fail = true;
    app.project.apply(retitle('Edit 1'));
    await vi.advanceTimersByTimeAsync(1000);
    expect((await stored(real, made))?.meta.title).toBe('Retry');
    fail = false;
    app.project.apply(retitle('Edit 2'));
    await vi.advanceTimersByTimeAsync(1000);
    expect((await stored(real, made))?.meta.title).toBe('Edit 2');
    expect(lib.current.value).toBe(made);
  });
});

describe('storage trouble', () => {
  it('goes to full on a quota error, says so with an export action, and recovers', async () => {
    const real = createMemoryRepository();
    let quota = false;
    const repo: Repository = {
      ...real,
      save: async (...args) => (quota ? { ok: false, kind: 'quota', detail: 'quota' } : real.save(...args)),
    };
    const { lib, app, downloads } = await rig({ repo });
    await lib.create({ title: 'Big' });
    quota = true;
    app.project.apply(retitle('Bigger'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(lib.state.value).toBe('full');
    const notice = app.shell.notices.value.find((n) => n.id === 'storage-full');
    expect(notice?.tone).toBe('fail');
    expect(notice?.text.de).toBeTruthy();
    expect(notice?.action?.label.en).toBe('Export project');
    notice!.action!.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(downloads.map((d) => d.name)).toEqual(['Bigger.iynk']);

    quota = false;
    app.project.apply(retitle('Smaller'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(lib.state.value).toBe('ok');
    expect(app.shell.notices.value.some((n) => n.id === 'storage-full')).toBe(false);
  });

  it('keeps projects in memory with a notice when IndexedDB is missing', async () => {
    const { lib, app } = await rig({ repo: undefined });
    expect(lib.state.value).toBe('unavailable');
    expect(app.shell.notices.value.find((n) => n.id === 'storage-unavailable')?.text.en).toContain('only for this session');
    const id = await lib.create({ title: 'Session' });
    expect(lib.rows.value.map((r) => r.id)).toEqual([id]);
  });
});

describe('what counts as a library project', () => {
  it('does not save a lesson, and a foreign load ends the current project', async () => {
    const { lib, app, repo } = await rig();
    const id = await lib.create({ title: 'Mine' });
    const save = vi.spyOn(repo, 'save');

    app.project.apply(retitle('Mine edited'));
    app.project.open(template); // another pillar opens a document right after an edit
    expect(lib.current.value).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect((await stored(repo, id))?.meta.title).toBe('Mine edited'); // the last edit was kept
    save.mockClear();

    app.guide.set({} as LessonGuide);
    app.project.apply(retitle('Lesson edit'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
    expect(lib.rows.value).toHaveLength(1);
  });

  it('ends an open lesson when a library project is opened, and saves from then on', async () => {
    const { lib, app, repo } = await rig();
    const close = vi.fn(() => app.guide.set(null));
    (app as { lessons?: unknown }).lessons = { close };
    app.guide.set({} as LessonGuide);
    const id = await lib.create({ title: 'After lesson' });
    expect(close).toHaveBeenCalled();
    app.project.apply(retitle('Edited after'));
    await vi.advanceTimersByTimeAsync(1000);
    expect((await stored(repo, id))?.meta.title).toBe('Edited after');
  });

  it('forks the start template into a new project on its first edit', async () => {
    const { lib, app, repo } = await rig();
    expect(lib.current.value).toBeNull();
    app.project.apply(retitle('My blink'));
    await vi.advanceTimersByTimeAsync(0);
    const id = lib.current.value!;
    expect(id).not.toBe(template.id);
    expect(app.project.doc.id).toBe(id);
    expect(app.project.doc.meta.title).toBe('My blink');
    const notice = app.shell.notices.value.find((n) => n.id === 'library/saved-new');
    expect(notice).toMatchObject({ tone: 'info', ms: 4000 });
    expect(notice?.text.en).toBe('Saved as a new project');
    expect((await stored(repo, id))?.meta.title).toBe('My blink');
    expect(lib.last.value?.id).toBe(id);

    app.project.apply(retitle('Again'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(lib.rows.value).toHaveLength(1);
    expect((await stored(repo, id))?.meta.title).toBe('Again');
  });

  it('does not fork the template while a lesson is open', async () => {
    const { lib, app } = await rig();
    app.guide.set({} as LessonGuide);
    app.project.apply(retitle('Lesson'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(lib.current.value).toBeNull();
    expect(lib.rows.value).toHaveLength(0);
  });
});

describe('files and links', () => {
  it('round trips a project through a link', async () => {
    const { lib, app } = await rig();
    const id = await lib.create({ template: TEMPLATE, title: 'Linked' });
    const made = await lib.shareLink(id);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.link.startsWith('https://iynk.test/xr/#project=')).toBe(true);
    const was = app.project.doc;
    const opened = await lib.openLink(made.link);
    expect(opened).not.toBe(id);
    expect(lib.current.value).toBe(opened);
    expect(app.project.doc.meta.title).toBe('Linked (shared)');
    expect(app.project.doc.components.map((c) => c.id)).toEqual(was.components.map((c) => c.id));
    expect(app.project.doc.nets.map((n) => n.id)).toEqual(was.nets.map((n) => n.id));
    expect(app.project.doc.components.length).toBeGreaterThan(0);
    expect(app.project.doc.boards.map((b) => b.definition)).toEqual(was.boards.map((b) => b.definition));
  });

  it('accepts the 2D Studio form of a link and refuses nonsense', async () => {
    const { lib } = await rig();
    const id = await lib.create({ title: 'Studio' });
    const made = await lib.shareLink(id);
    if (!made.ok) throw new Error('no link');
    const code = made.link.split('#project=')[1]!;
    const opened = await lib.openLink(`https://iynk.test/en/studio#project=${code}`);
    expect(lib.current.value).toBe(opened);
    await expect(lib.openLink('#project=not-a-project')).rejects.toThrow();
    await expect(lib.openLink('!!')).rejects.toThrow();
  });

  it('writes a file and imports it as a new, unopened project', async () => {
    const { lib, downloads } = await rig();
    const id = await lib.create({ template: TEMPLATE, title: 'On disk' });
    await lib.exportFile(id);
    expect(downloads[0]?.name).toBe('On disk.iynk');
    const copy = await lib.importFile(new Blob([downloads[0]!.bytes as BlobPart]));
    expect(copy).not.toBe(id);
    expect(lib.current.value).toBe(id);
    expect(lib.rows.value.find((r) => r.id === copy)?.title).toBe('On disk');
    await expect(lib.importFile(new Blob(['not a project']))).rejects.toThrow();
  });

  it('opens the link in the address, then removes the fragment', async () => {
    const maker = await rig();
    const id = await maker.lib.create({ title: 'From a link' });
    const made = await maker.lib.shareLink(id);
    if (!made.ok) throw new Error('no link');
    const hash = `#project=${made.link.split('#project=')[1]}`;

    const { lib, app, replaceState } = await rig({ hash });
    expect(lib.current.value).not.toBeNull();
    expect(app.project.doc.meta.title).toBe('From a link (shared)');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/xr/?a=1');
  });

  it('removes the fragment and tells the person when the link is bad', async () => {
    const { lib, app, replaceState } = await rig({ hash: '#project=AAAA' });
    expect(replaceState).toHaveBeenCalled();
    expect(lib.current.value).toBeNull();
    expect(app.shell.notices.value.some((n) => n.id === 'library/bad-link')).toBe(true);
  });
});
