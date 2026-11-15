/**
 * Parts import, the part with no DOM and no world: read a part pack's bytes into the parts library (which adds the
 * parts to the app's shared registry), and the build action that lays an imported part loose on the bench, in a lane
 * below the boards, to the right of anything already there. Tested in test/parts-import.test.ts.
 *
 * An imported part that re-badges a modelled core part (same pins, same behaviour) simulates as that part: see
 * `src/sim/import-twin.ts`. Any other imported part places and draws, but the solver gives it no model yet.
 */
import type { PartLibrary } from '@/parts/browser/library';
import type { PartRegistry } from '@/parts/registry';
import { buildDependency } from '@/parts/versions';
import type { Op, Project } from '@/project/generated/types';
import { resolvePart } from '@/studio/parts-view';
import { breadboardViewOf, placePart } from '../bench/core/actions';
import type { ActionEnv, ActionResult, DocPoint, Placed } from '../bench/core/actions';

/** A part a pack put into the library, as the panel names it. */
export type ImportedPart = { ref: string; version: string; manufacturer: string; model: string };

export type ImportFailure = 'not-a-pack' | 'no-parts' | 'conflict' | 'not-added';
export type ImportResult = { ok: true; parts: ImportedPart[] } | { ok: false; reason: ImportFailure; detail?: string };

export type ImportLibrary = Pick<PartLibrary, 'readPack' | 'commitPack' | 'registry'>;

const keyOf = (item: { id: string; version: string }): string => `${item.id}@${item.version}`;

/**
 * Reads a pack and stores every part in it that has no error diagnostic, all or nothing. A part already in the
 * library with the same bytes counts as imported; one with the same id and version but other bytes is a conflict and
 * nothing is stored. `sender` is who the pack came from (a file name, `demo`), kept with each record.
 */
export async function importPackBytes(library: ImportLibrary, bytes: Uint8Array, sender: string): Promise<ImportResult> {
  const plan = await library.readPack(bytes, sender);
  if (!plan.ok) return { ok: false, reason: 'not-a-pack', detail: plan.error.code };
  const usable = plan.items.filter((item) => item.issues.every((d) => d.severity !== 'error'));
  if (usable.length === 0) return { ok: false, reason: 'no-parts' };
  const committed = await library.commitPack(plan, { mode: 'library', ids: usable.map(keyOf) });
  if (!committed.ok) return { ok: false, reason: 'conflict', detail: committed.conflicts.map((c) => c.key).join(', ') };
  const parts = usable
    .filter((item) => library.registry.get(item.id, item.version) !== undefined)
    .map((item) => ({ ref: item.id, version: item.version, manufacturer: item.descriptor.identity.manufacturer, model: item.descriptor.identity.model }));
  return parts.length > 0 ? { ok: true, parts } : { ok: false, reason: 'not-added' };
}

type Rect = { x: number; y: number; w: number; h: number };

/** Space between a new part and its neighbours, and between the lane and the boards above it. */
export const GAP_MM = 10;

/** A board, or the breadboard: the things the lane runs below. Everything else is a part that may already sit in it. */
const isAnchor = (doc: Project, id: string, ref: string): boolean => doc.boards.some((b) => b.id === id) || /breadboard/.test(ref);

function rectsOf(doc: Project, registry: PartRegistry): { anchors: Rect[]; parts: Rect[] } {
  const view = breadboardViewOf(doc);
  const anchors: Rect[] = [];
  const parts: Rect[] = [];
  for (const p of view?.placements ?? []) {
    const item = [...doc.boards, ...doc.components].find((x) => x.id === p.c);
    if (!item) continue;
    const shape = resolvePart(doc, item.definition.ref, registry);
    const turned = Math.abs(Math.round((p.rotation_deg ?? 0) / 90)) % 2 === 1;
    const rect = { x: p.x_mm, y: p.y_mm, w: turned ? shape.heightMm : shape.widthMm, h: turned ? shape.widthMm : shape.heightMm };
    (isAnchor(doc, item.id, item.definition.ref) ? anchors : parts).push(rect);
  }
  return { anchors, parts };
}

/** The grid a loose part's corner snaps to (`SNAP_MM` in bench/core/actions.ts, the breadboard pitch). */
const SNAP_MM = 2.54;
const snapUp = (v: number): number => Math.round(Math.ceil(v / SNAP_MM - 1e-6) * SNAP_MM * 100) / 100;

/**
 * Where a new part goes: a lane `GAP_MM` below the lowest board or breadboard, starting at the leftmost one's edge and
 * moving right past every part already in the lane. Below the breadboard there are no holes, so the part lies loose.
 * The build action takes the point a part is centred on and snaps its corner to the grid, so the corner is put on the
 * grid first and the centre given from there: the part lands exactly where the lane says.
 */
export function spotForNewPart(doc: Project, ref: string, registry: PartRegistry): DocPoint {
  const { anchors, parts } = rectsOf(doc, registry);
  const { widthMm: w, heightMm: h } = resolvePart(doc, ref, registry);
  if (anchors.length === 0) return { x_mm: w / 2, y_mm: h / 2 };
  const y = snapUp(Math.max(...anchors.map((r) => r.y + r.h)) + GAP_MM);
  let x = Math.min(...anchors.map((r) => r.x));
  for (const r of [...parts].sort((a, b) => a.x - b.x)) {
    const inLane = r.y < y + h && r.y + r.h > y;
    if (inLane && r.x + r.w + GAP_MM > x) x = r.x + r.w + GAP_MM;
  }
  return { x_mm: snapUp(x) + w / 2, y_mm: y + h / 2 };
}

/**
 * Lays the newest version of `ref` loose in the lane (`spotForNewPart`) as one undo step. The build action pins a new
 * part as `builtin`; a part that is not a core part is pinned as `library` instead, with its digest, so the project
 * says where the part came from and a later check sees if the library's copy changed.
 */
export function placeImported(doc: Project, ref: string, env: ActionEnv & { registry: PartRegistry }): ActionResult<Placed> {
  const result = placePart(doc, { ref, at: spotForNewPart(doc, ref, env.registry) }, env);
  if (!result.ok) return result;
  const d = env.registry.latest(ref);
  if (!d || env.registry.originOf(d.id, d.version) === 'core') return result;
  const ops = result.ops.map(
    (op): Op =>
      op.k === 'dep.set' && op.dependency.ref === d.id && op.dependency.version === d.version
        ? { k: 'dep.set', dependency: buildDependency(d, 'library') }
        : op,
  );
  return { ...result, ops };
}

/** The parts in the registry that did not ship with the app, newest import last as the registry lists them. */
export function importedParts(registry: PartRegistry): ImportedPart[] {
  return registry
    .list()
    .filter((p) => registry.originOf(p.ref, p.version) !== 'core')
    .flatMap((p) => {
      const d = registry.get(p.ref, p.version);
      return d ? [{ ref: d.id, version: d.version, manufacturer: d.identity.manufacturer, model: d.identity.model }] : [];
    });
}
