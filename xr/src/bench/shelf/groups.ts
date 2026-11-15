/** What the shelf holds and how it is paged: iynk's part registry in six groups (logic only, no looks). */
import type { PartRegistry } from '@/parts/registry';

export const GROUP_IDS = ['basics', 'sensors', 'output', 'motion', 'power', 'boards'] as const;
export type GroupId = (typeof GROUP_IDS)[number];

/** 12 bins: three tiers of four. */
export const BINS_PER_PAGE = 12;

const GROUP_OF_CATEGORY: Readonly<Record<string, GroupId>> = {
  passive: 'basics',
  semiconductor: 'basics',
  sensor: 'sensors',
  instrument: 'sensors',
  actuator: 'output',
  display: 'output',
  'motor-driver': 'motion',
  robotics: 'motion',
  mechanical: 'motion',
  power: 'power',
  'dev-board': 'boards',
  fpga: 'boards',
};

/** The shelf group of an iynk category; anything unknown goes to Basics. */
export function groupOf(category: string): GroupId {
  return GROUP_OF_CATEGORY[category] ?? 'basics';
}

/** A breadboard is a mechanical part in iynk, but a person looks for it with the boards: it stands first in Boards. */
export const isBreadboard = (ref: string): boolean => /(^|\.)breadboard/.test(ref);

export interface ShelfEntry {
  readonly ref: string;
  readonly version: string;
  readonly name: string;
  readonly category: string;
}

/** Every part and board of the registry, one entry per ref at its latest version, sorted by name within its group. */
export function shelfEntries(registry: Pick<PartRegistry, 'list' | 'latest'>): Record<GroupId, ShelfEntry[]> {
  const out: Record<GroupId, ShelfEntry[]> = { basics: [], sensors: [], output: [], motion: [], power: [], boards: [] };
  const seen = new Set<string>();
  for (const p of registry.list()) {
    if (seen.has(p.ref)) continue;
    seen.add(p.ref);
    const latest = registry.latest(p.ref);
    out[isBreadboard(p.ref) ? 'boards' : groupOf(p.category)].push({ ref: p.ref, version: latest?.version ?? p.version, name: p.name, category: p.category });
  }
  for (const id of GROUP_IDS) {
    out[id].sort((a, b) => Number(isBreadboard(b.ref)) - Number(isBreadboard(a.ref)) || a.name.localeCompare(b.name) || a.ref.localeCompare(b.ref));
  }
  return out;
}

export const pageCount = (n: number): number => Math.max(1, Math.ceil(n / BINS_PER_PAGE));

/** The entries of page `page` (0 based, clamped). */
export function pageOf<T>(entries: readonly T[], page: number): T[] {
  const p = Math.min(Math.max(0, Math.floor(page)), pageCount(entries.length) - 1);
  return entries.slice(p * BINS_PER_PAGE, (p + 1) * BINS_PER_PAGE);
}
