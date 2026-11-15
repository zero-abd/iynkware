/**
 * Parts import (xr/src/parts-import): every demo pack goes into a parts library, lands loose in a lane below the
 * board as one undo step, is pinned as a library part, and simulates as the core part it re-badges.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPartLibrary } from '@/parts/browser/library';
import type { PartLibrary } from '@/parts/browser/library';
import { builtinRegistry } from '@/parts/builtin';
import type { PartRegistry } from '@/parts/registry';
import { createMemoryPartsRepository } from '@/local/parts-store';
import { stateHash } from '@/project/hash';
import { buildSimNetlist } from '@/sim/netlist';
import { resolvePart } from '@/studio/parts-view';
import type { IdSource } from '@/studio/views/breadboard';
import { LANGS } from '../src/contracts/common';
import type { Project, ProjectStore } from '../src/contracts/project';
import { GAP_MM, importedParts, importPackBytes, placeImported } from '../src/parts-import/core';
import { IMPORT } from '../src/parts-import/panel/copy';
import { createProjectStore, createTemplateSource } from '../src/project/store';
import { placeholdersOf } from '../src/shell/copy';

type DemoPack = { file: string; id: string; version: string; manufacturer: string; model: string };

const packsDir = new URL('../public/demo-packs/', import.meta.url);
const INDEX = (JSON.parse(readFileSync(new URL('index.json', packsDir), 'utf8')) as { packs: DemoPack[] }).packs;
const bytesOf = (file: string) => new Uint8Array(readFileSync(new URL(file, packsDir)));

function counterIds(): IdSource {
  let n = 0;
  return ((prefix: string) => `${prefix}_t${++n}`) as IdSource;
}

let template: Project;
let registry: PartRegistry;
let library: PartLibrary;
let store: ProjectStore;
let ids: IdSource;

beforeEach(async () => {
  template ??= await createTemplateSource().load('prj_uno-r3-blink');
  registry = builtinRegistry();
  library = createPartLibrary(createMemoryPartsRepository(), { persistent: false, registry });
  await library.init();
  store = createProjectStore(template, registry);
  ids = counterIds();
});

type Rect = { x: number; y: number; w: number; h: number };
function rectOf(doc: Project, c: string): Rect {
  const placement = doc.views.find((v) => v.kind === 'breadboard')!.placements.find((p) => p.c === c)!;
  const item = [...doc.boards, ...doc.components].find((x) => x.id === c)!;
  const shape = resolvePart(doc, item.definition.ref, registry);
  return { x: placement.x_mm, y: placement.y_mm, w: shape.widthMm, h: shape.heightMm };
}
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('importPackBytes', () => {
  it('lists six demo packs, one part each', () => {
    expect(INDEX.map((p) => p.id)).toHaveLength(6);
    expect(INDEX.every((p) => p.id.startsWith('demo.'))).toBe(true);
  });

  it.each(INDEX)('imports $file into the library and the registry', async (pack) => {
    const r = await importPackBytes(library, bytesOf(pack.file), 'demo');
    expect(r).toEqual({ ok: true, parts: [{ ref: pack.id, version: pack.version, manufacturer: pack.manufacturer, model: pack.model }] });
    expect(registry.originOf(pack.id, pack.version)).toBe('imported-pack');
    expect(library.senders().get(`${pack.id}@${pack.version}`)).toBe('demo');
  });

  it('takes the same pack twice', async () => {
    const pack = INDEX[0]!;
    expect((await importPackBytes(library, bytesOf(pack.file), 'demo')).ok).toBe(true);
    expect((await importPackBytes(library, bytesOf(pack.file), 'demo')).ok).toBe(true);
    expect(importedParts(registry)).toHaveLength(1);
  });

  it('refuses a file that is not a pack and stores nothing', async () => {
    const before = registry.list().length;
    const r = await importPackBytes(library, new TextEncoder().encode('not a pack'), 'notes.txt');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not-a-pack');
    expect(registry.list()).toHaveLength(before);
  });
});

describe('placeImported', () => {
  it('lays every demo part loose in a lane below the boards, one undo each, pinned as a library part', async () => {
    const placed: string[] = [];
    for (const pack of INDEX) {
      expect((await importPackBytes(library, bytesOf(pack.file), 'demo')).ok).toBe(true);
      const before = stateHash(store.doc);
      const r = placeImported(store.doc, pack.id, { registry, ids });
      if (!r.ok) throw new Error(`refused: ${r.reason}`);
      expect(r.loose).toBe(true);
      const deps = r.ops.flatMap((op) => (op.k === 'dep.set' ? [op.dependency] : []));
      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({ ref: pack.id, version: pack.version, origin: 'library' });
      expect(deps[0]!.digest).toMatch(/^sha256:/);
      expect(store.apply(r.ops, { label: r.label }).ok).toBe(true);
      const after = stateHash(store.doc);
      expect(store.undo()?.ok).toBe(true);
      expect(stateHash(store.doc)).toBe(before);
      expect(store.redo()?.ok).toBe(true);
      expect(stateHash(store.doc)).toBe(after);
      placed.push(r.id);
    }

    const doc = store.doc;
    const anchors = doc.views
      .find((v) => v.kind === 'breadboard')!
      .placements.filter((p) => doc.boards.some((b) => b.id === p.c) || /breadboard/.test([...doc.components].find((c) => c.id === p.c)?.definition.ref ?? ''))
      .map((p) => rectOf(doc, p.c));
    const bottom = Math.max(...anchors.map((r) => r.y + r.h));
    const rects = placed.map((id) => rectOf(doc, id));
    for (const r of rects) expect(r.y).toBeGreaterThanOrEqual(bottom + GAP_MM - 0.01);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
  });

  it('simulates each imported part as its core twin', async () => {
    const placed: string[] = [];
    for (const pack of INDEX) {
      await importPackBytes(library, bytesOf(pack.file), 'demo');
      const r = placeImported(store.doc, pack.id, { registry, ids });
      if (!r.ok) throw new Error(`refused: ${r.reason}`);
      store.apply(r.ops, { label: r.label });
      placed.push(r.id);
    }
    const { net, diagnostics } = buildSimNetlist(store.doc, registry);
    const parts = net.parts.filter((p) => placed.includes(p.id));
    expect(parts).toHaveLength(6);
    for (const p of parts) expect(p.descriptor.startsWith('core.')).toBe(true);
    expect(diagnostics.filter((d) => d.id === 'unknown-part')).toEqual([]);
  });

  it('leaves a core part pinned as builtin', () => {
    const r = placeImported(store.doc, 'core.led-5mm', { registry, ids });
    if (!r.ok) throw new Error(`refused: ${r.reason}`);
    for (const op of r.ops) if (op.k === 'dep.set') expect(op.dependency.origin).toBe('builtin');
  });
});

describe('parts import copy', () => {
  it('has every English key and placeholder in six languages, nothing empty', () => {
    const keys = Object.keys(IMPORT.en).sort();
    for (const lang of LANGS) {
      expect(Object.keys(IMPORT[lang]).sort()).toEqual(keys);
      for (const key of keys as (keyof typeof IMPORT.en)[]) {
        expect(IMPORT[lang][key].trim()).not.toBe('');
        expect(placeholdersOf(IMPORT[lang][key])).toEqual(placeholdersOf(IMPORT.en[key]));
      }
    }
  });
});
