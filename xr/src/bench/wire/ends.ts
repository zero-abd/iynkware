/**
 * Which wire end a cell is (design 5, "Start"): a hole of the breadboard surface or a pin of a board, or nothing when
 * that end can never take a wire (then a pinch there is not a wire start and falls to the part body). Pure.
 */
import type { Project } from '@/project/generated/types';
import { canConnect, type WireEndRef } from '@/studio/rules/connect';
import { breadboardViewOf } from '../core/actions';

/** The legs of every placement of the breadboard view: the holes a seated part's leg occupies. */
function occupiedHoles(doc: Project): Set<string> {
  const held = new Set<string>();
  const view = breadboardViewOf(doc);
  for (const p of view?.placements ?? []) for (const hole of Object.values(p.legs ?? {})) if (hole !== undefined) held.add(hole);
  return held;
}

/** The wire end a cell stands for: a hole of the surface, else a pin of a board (no rule applied). */
export const refOfCell = (surface: string | undefined, part: string, anchor: string): WireEndRef =>
  part === surface ? { kind: 'hole', surface: part, hole: anchor } : { kind: 'pin', c: part, p: anchor };

/**
 * The wire end of the cell `anchor` on `part` (the breadboard surface gives a hole, any other board a pin), or null
 * when it can never take a wire: a hole a seated leg occupies, a hole off the surface, a mechanical pin, no such pin.
 * `canConnect` with no second end answers `empty-target` for an end that is fine.
 */
export function endOfCell(doc: Project, surface: string | undefined, part: string, anchor: string): WireEndRef | null {
  const view = breadboardViewOf(doc);
  if (!view) return null;
  const end = refOfCell(surface, part, anchor);
  if (end.kind === 'hole' && occupiedHoles(doc).has(anchor)) return null;
  const verdict = canConnect(doc, view.id, end, null);
  return !verdict.ok && verdict.code === 'empty-target' ? end : null;
}

/** Whether two cells are the same one (a wire is never offered its own start as its end). */
export const sameCell = (a: { part: string; anchor: string } | null, b: { part: string; anchor: string } | null): boolean =>
  a !== null && b !== null && a.part === b.part && a.anchor === b.anchor;

/**
 * How far outside its legs a part's body still covers a hole, metres (board frame is real size): half a pitch along the
 * legs, a whole pitch across them (a body is wider than its row, and a grab is not exact).
 */
export const BODY_SLACK_M = 0.00127;
export const BODY_SLACK_ACROSS_M = 0.00254;

/**
 * Whether a free hole lies under the body of a seated part, between its legs (a resistor's body covers the holes
 * between its two legs): a pinch there means the part, not a wire. `at(hole)` is a hole's board frame [x, z].
 */
export function underSeatedBody(doc: Project, hole: string, at: (hole: string) => readonly [number, number] | null): boolean {
  const target = at(hole);
  if (!target) return false;
  for (const p of breadboardViewOf(doc)?.placements ?? []) {
    const legs = Object.values(p.legs ?? {}).filter((h): h is string => h !== undefined);
    if (legs.length < 2) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const l of legs) {
      const q = at(l);
      if (!q) continue;
      x0 = Math.min(x0, q[0]);
      x1 = Math.max(x1, q[0]);
      z0 = Math.min(z0, q[1]);
      z1 = Math.max(z1, q[1]);
    }
    if (target[0] >= x0 - BODY_SLACK_M && target[0] <= x1 + BODY_SLACK_M && target[1] >= z0 - BODY_SLACK_ACROSS_M && target[1] <= z1 + BODY_SLACK_ACROSS_M) return true;
  }
  return false;
}
