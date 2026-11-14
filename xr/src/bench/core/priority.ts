/**
 * Target priority under one pointer (design 3.1): (1) a pin or hole cell, only within its height band; (2) a component
 * control (button cap, knob); (3) a wire end bead; (4) a part body; (5) a board or breadboard edge band, 0.02 m (work)
 * wide and outside the hole grid; (6) panels. Allocation-free: candidates are a bit mask, and the edge band test is
 * plain arithmetic on the bench's own data. Pure: no IWSDK, no three.js.
 */
import type { PartRegistry } from '@/parts/registry';
import type { Project } from '@/project/generated/types';
import { resolvePart } from '@/studio/parts-view';
import type { CellIndex } from './cells';
import { CELL_REACH_PITCH, PITCH_M } from './cells';

export type TargetKind = 'cell' | 'control' | 'wire-end' | 'body' | 'edge' | 'panel';

/** Highest first. */
export const TARGET_PRIORITY: readonly TargetKind[] = ['cell', 'control', 'wire-end', 'body', 'edge', 'panel'];

export const TARGET_BIT: Readonly<Record<TargetKind, number>> = { cell: 1, control: 2, 'wire-end': 4, body: 8, edge: 16, panel: 32 };

/**
 * `pointerEventsOrder` for invisible proxies, so the pointer system agrees with this priority while the input service
 * has no `kind` priority of its own (higher wins; other pillars' controls default to 0 or set their own).
 */
export const POINTER_EVENTS_ORDER: Readonly<Record<TargetKind, number>> = { cell: 5, control: 4, 'wire-end': 3, body: 2, edge: 1, panel: 0 };

/** The kind that wins among the candidates in `mask` (bits of `TARGET_BIT`), or null when there are none. */
export function pickTarget(mask: number): TargetKind | null {
  for (let i = 0; i < TARGET_PRIORITY.length; i++) {
    const kind = TARGET_PRIORITY[i]!;
    if ((mask & TARGET_BIT[kind]) !== 0) return kind;
  }
  return null;
}

/** How wide the edge band of a board or breadboard is, metres of work. */
export const EDGE_BAND_WORK_M = 0.02;

/** A board's or breadboard's layout rectangle as the document places it: top left corner, size, turned about the corner. */
export interface BoardRect {
  readonly x_mm: number;
  readonly y_mm: number;
  readonly w_mm: number;
  readonly h_mm: number;
  readonly rotation_deg?: number;
}

/** The layout rectangle of a board or breadboard in the breadboard view (its placement and `resolvePart` size), or undefined. */
export function boardRectOf(doc: Project, part: string, registry?: PartRegistry): BoardRect | undefined {
  const placement = doc.views.find((v) => v.kind === 'breadboard')?.placements.find((p) => p.c === part);
  const item = [...doc.boards, ...doc.components].find((x) => x.id === part);
  if (!placement || !item) return undefined;
  const shape = registry ? resolvePart(doc, item.definition.ref, registry) : resolvePart(doc, item.definition.ref);
  return { x_mm: placement.x_mm, y_mm: placement.y_mm, w_mm: shape.widthMm, h_mm: shape.heightMm, rotation_deg: placement.rotation_deg ?? 0 };
}

/**
 * Whether a board-frame point is in a board's edge band at work scale `s`: inside its outline, within 0.02 m (work) of
 * an edge, and, when its cells are given, not within any cell's reach (the band lies outside the hole grid).
 */
export function inEdgeBand(rect: BoardRect, x: number, z: number, s: number, cells?: CellIndex): boolean {
  // into the rectangle's own frame: back from the board frame to document mm, then undo the turn about the corner
  // (iynk's `turn` by -deg, written out so the per-frame path makes no object)
  const px = x * 1000 - rect.x_mm;
  const py = z * 1000 - rect.y_mm;
  const r = (-(rect.rotation_deg ?? 0) * Math.PI) / 180;
  const c = Math.cos(r);
  const sn = Math.sin(r);
  const lx = px * c + py * sn;
  const ly = -px * sn + py * c;
  if (lx < 0 || ly < 0 || lx > rect.w_mm || ly > rect.h_mm) return false;
  const edge = Math.min(lx, ly, rect.w_mm - lx, rect.h_mm - ly);
  if (edge > (EDGE_BAND_WORK_M * 1000) / s) return false;
  return cells === undefined || cells.nearest(x, z, CELL_REACH_PITCH * PITCH_M) === -1;
}
