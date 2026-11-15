/**
 * The Import a part panel on the 2D page (shown with Enter and Open on this screen, hidden in headset mode), and
 * `window.iynkware.parts` for scripts and the emulator checks. A part file or a demo pack goes into the parts library,
 * which adds it to the app's shared registry, and the part is laid loose on the bench below the board, one undo step.
 * Parts imported before are back after a reload: the library loads them when this mounts.
 */
import { getPartLibrary } from '@/parts/browser/library';
import type { PartLibrary } from '@/parts/browser/library';
import { getAppRegistry } from '@/parts/builtin';
import type { Lang } from '../../contracts/common';
import type { FeatureModule, XrApp } from '../../contracts/app';
import { say } from '../../shell/copy';
import { importedParts, importPackBytes, placeImported } from '../core';
import type { ImportedPart, ImportFailure, ImportResult } from '../core';
import { IMPORT } from './copy';

type Key = keyof (typeof IMPORT)['en'];

/** A demo pack as `demo-packs/index.json` lists it (tools/demo-packs/build.ts writes it). */
export type DemoPack = { file: string; id: string; version: string; manufacturer: string; model: string };

export type PlaceOutcome = { ok: true; id: string; refdes: string } | { ok: false; reason: string };
export type ImportAndPlace = { imported: ImportResult; placed: PlaceOutcome | null };

/** What `window.iynkware.parts` holds. */
export interface PartsImportApi {
  /** Reads a pack into the library. `sender` is kept with each part (a file name, `demo`). */
  importPack(bytes: Uint8Array | ArrayBuffer, sender?: string): Promise<ImportResult>;
  /** Imports a pack, then places its first part on the bench. */
  importAndPlace(bytes: Uint8Array | ArrayBuffer, sender?: string): Promise<ImportAndPlace>;
  /** Fetches a demo pack by file name (`blue-led-10mm.iynkpack`) and imports and places it. */
  importDemo(file: string): Promise<ImportAndPlace>;
  /** Places the newest version of an imported (or core) part loose below the board. */
  place(ref: string): PlaceOutcome;
  /** The demo packs this build serves. */
  demos(): Promise<DemoPack[]>;
  /** The parts that did not ship with the app. */
  list(): ImportedPart[];
}

const DEMO_FILE = /^[a-z0-9][a-z0-9.-]*\.iynkpack$/;
const demoUrl = (path: string): string => new URL(`demo-packs/${path}`, document.baseURI).href;

/** Sets `window.iynkware[key]` once main.ts has made `window.iynkware`; the returned function takes it away again. */
function attachToWindow(key: string, value: unknown): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attach = () => {
    const w = (globalThis as { iynkware?: Record<string, unknown> }).iynkware;
    if (w) w[key] = value;
    else timer = setTimeout(attach, 100);
  };
  attach();
  return () => {
    if (timer) clearTimeout(timer);
    const w = (globalThis as { iynkware?: Record<string, unknown> }).iynkware;
    if (w && w[key] === value) delete w[key];
  };
}

function createApi(app: XrApp, library: () => Promise<PartLibrary>): PartsImportApi {
  const registry = getAppRegistry();
  let demoList: Promise<DemoPack[]> | null = null;

  const place = (ref: string): PlaceOutcome => {
    const r = placeImported(app.project.doc, ref, { registry });
    if (!r.ok) return { ok: false, reason: r.reason };
    const applied = app.project.apply(r.ops, { label: r.label });
    return applied.ok ? { ok: true, id: r.id, refdes: r.refdes } : { ok: false, reason: 'apply' };
  };

  const importPack = async (bytes: Uint8Array | ArrayBuffer, sender = 'file'): Promise<ImportResult> =>
    importPackBytes(await library(), bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), sender);

  const importAndPlace = async (bytes: Uint8Array | ArrayBuffer, sender?: string): Promise<ImportAndPlace> => {
    const imported = await importPack(bytes, sender);
    return { imported, placed: imported.ok ? place(imported.parts[0]!.ref) : null };
  };

  return {
    importPack,
    importAndPlace,
    place,
    list: () => importedParts(registry),
    async importDemo(file) {
      if (!DEMO_FILE.test(file)) throw new Error(`not a demo pack name: ${file}`);
      const res = await fetch(demoUrl(file));
      if (!res.ok) throw new Error(`demo pack ${file}: HTTP ${res.status}`);
      return importAndPlace(await res.arrayBuffer(), 'demo');
    },
    demos() {
      demoList ??= fetch(demoUrl('index.json'))
        .then((res) => (res.ok ? (res.json() as Promise<{ packs?: DemoPack[] }>) : { packs: [] }))
        .then((j) => (j.packs ?? []).filter((p) => DEMO_FILE.test(p.file)))
        .catch(() => []);
      return demoList;
    },
  };
}

/** The message for an import and place, as a copy key and the part's name. */
function outcomeKey(r: ImportAndPlace): { key: Key; name: string } {
  if (!r.imported.ok) {
    const byReason: Record<ImportFailure, Key> = { 'not-a-pack': 'notPack', 'no-parts': 'noParts', conflict: 'conflict', 'not-added': 'notAdded' };
    return { key: byReason[r.imported.reason], name: '' };
  }
  const name = r.imported.parts[0]!.model;
  return { key: r.placed?.ok ? 'placed' : 'refused', name };
}

const BUTTON_STYLE = 'min-height:40px;font-size:15px;padding:6px 14px;border-radius:10px;box-shadow:2px 2px 0 #41538f;background:#f2efe7;';

function mountPanel(shell: HTMLElement, app: XrApp, api: PartsImportApi): () => void {
  const lang = (): Lang => app.settings.lang.value;
  const t = (key: Key, params?: Record<string, string>) => say(IMPORT, lang(), key, params);

  const panel = document.createElement('details');
  panel.id = 'parts-import';
  panel.style.cssText = 'background:#f2efe7;border:3px solid #231e16;border-radius:14px;padding:8px 14px;max-width:560px;font-size:15px;color:#231e16;';
  const summary = document.createElement('summary');
  summary.style.cssText = 'cursor:pointer;font-size:17px;font-weight:600;min-height:32px;line-height:32px;';
  const intro = document.createElement('p');
  intro.style.margin = '6px 0';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.iynkpack,application/zip';
  file.hidden = true;
  const choose = document.createElement('button');
  choose.type = 'button';
  choose.style.cssText = BUTTON_STYLE;
  const demosLabel = document.createElement('p');
  demosLabel.style.margin = '10px 0 4px';
  const demoRow = document.createElement('div');
  demoRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.style.cssText = 'margin:8px 0 2px;min-height:1.2em;';
  panel.append(summary, intro, choose, file, demosLabel, demoRow, status);
  shell.insertBefore(panel, shell.firstChild);

  let busy = false;
  let last: { key: Key; name: string } | null = null;
  const render = () => {
    summary.textContent = t('title');
    intro.textContent = t('intro');
    choose.textContent = t('choose');
    demosLabel.textContent = t('demos');
    status.textContent = busy ? t('working') : last ? t(last.key, { name: last.name }) : '';
  };
  const run = async (work: () => Promise<ImportAndPlace>) => {
    if (busy) return;
    busy = true;
    last = null;
    render();
    try {
      last = outcomeKey(await work());
    } catch (err) {
      console.error('[iynkware] parts import', err);
      last = { key: 'failed', name: '' };
    }
    busy = false;
    render();
  };

  choose.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const picked = file.files?.[0];
    file.value = '';
    if (picked) void run(async () => api.importAndPlace(await picked.arrayBuffer(), picked.name));
  });
  void api.demos().then((packs) => {
    demosLabel.hidden = packs.length === 0;
    for (const pack of packs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.cssText = BUTTON_STYLE;
      // the part's own name, as its pack gives it: data, like a part name in the parts library
      b.textContent = pack.model;
      b.addEventListener('click', () => void run(() => api.importDemo(pack.file)));
      demoRow.append(b);
    }
  });

  render();
  const offLang = app.settings.lang.subscribe(render);
  return () => {
    offLang();
    panel.remove();
  };
}

export const panelModule: FeatureModule = {
  id: 'parts-import/panel',
  mount(app) {
    let shared: Promise<PartLibrary> | null = null;
    const library = () => (shared ??= getPartLibrary());
    // loads the parts imported on an earlier visit into the app registry before the person touches anything
    void library().catch((err) => console.error('[iynkware] parts library', err));
    const api = createApi(app, library);
    const detach = attachToWindow('parts', api);
    const shell = typeof document === 'undefined' ? null : document.getElementById('shell');
    const unmount = shell ? mountPanel(shell, app, api) : () => undefined;
    return () => {
      unmount();
      detach();
    };
  },
};
