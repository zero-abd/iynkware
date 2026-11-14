/**
 * What Range does with the open project: a drone craft template (`domains.drone`, its `legacy.contentId`) flies, a
 * robot with mechanics (`needsPhysics`) drives on the floor, anything else is not Range's.
 */
import type { Project } from '@/project/generated/types';
import { needsPhysics } from '@/sim-host/robot-doc';
import type { ReadonlyValue, Unsubscribe } from '../../contracts/common';
import type { ProjectStore } from '../../contracts/project';

export type RangeProject = { readonly kind: 'drone'; readonly contentId: string } | { readonly kind: 'robot' };

/** The Range kind of a document, or null. */
export function rangeProjectOf(doc: Project): RangeProject | null {
  const drone = (doc.domains as { drone?: { data?: { legacy?: { contentId?: unknown } } } } | undefined)?.drone?.data;
  const id = drone?.legacy?.contentId;
  if (typeof id === 'string' && id) return { kind: 'drone', contentId: id };
  if (needsPhysics(doc)) return { kind: 'robot' };
  return null;
}

const same = (a: RangeProject | null, b: RangeProject | null) =>
  a === b || (a !== null && b !== null && a.kind === b.kind && (a.kind !== 'drone' || a.contentId === (b as { contentId: string }).contentId));

/**
 * The open project's Range kind, updated on every document change but notifying only when it changes (opening a
 * drone after Blink, a robot after a drone).
 */
export function watchRangeProject(project: Pick<ProjectStore, 'doc' | 'subscribe'>): ReadonlyValue<RangeProject | null> & { dispose: Unsubscribe } {
  let current = rangeProjectOf(project.doc);
  const fns = new Set<(v: RangeProject | null) => void>();
  const off = project.subscribe(() => {
    const next = rangeProjectOf(project.doc);
    if (same(next, current)) return;
    current = next;
    for (const fn of [...fns]) fn(current);
  });
  return {
    get value() {
      return current;
    },
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    dispose: off,
  };
}
