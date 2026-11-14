import type { Hit, HitTarget, PointMm, RectMm } from "./types.ts";

const HIT_RANK: Record<Hit["kind"], number> = { pin: 0, hole: 1, handle: 2, junction: 3, label: 4, wire: 5, part: 6 };

/** A pin and a hole are both something a wire can end at, so one of them next to the other does not beat it by kind. */
const band = (hit: Hit): number => (hit.kind === "hole" ? HIT_RANK.pin : HIT_RANK[hit.kind]);

const area = (r: RectMm): number => (r.x1 - r.x0) * (r.y1 - r.y0);

/** How far `p` is from the box: 0 inside it. */
function gap(r: RectMm, p: PointMm): number {
  return Math.hypot(Math.max(r.x0 - p.x, 0, p.x - r.x1), Math.max(r.y0 - p.y, 0, p.y - r.y1));
}

/**
 * Whether `target` beats `best` as what a pointer at `p` meant: pins and holes before handles, junctions, labels, wires
 * and parts; among those the nearer one, so that pins and holes closer together than the slop still go to the one
 * pointed at; then a pin before a hole it sits in, the smaller box, and the later one.
 */
export function prefers(target: HitTarget, best: HitTarget, p: PointMm): boolean {
  const byBand = band(target.hit) - band(best.hit);
  if (byBand !== 0) return byBand < 0;
  const byGap = gap(target.bbox, p) - gap(best.bbox, p);
  if (byGap !== 0) return byGap < 0;
  const byRank = HIT_RANK[target.hit.kind] - HIT_RANK[best.hit.kind];
  if (byRank !== 0) return byRank < 0;
  return area(target.bbox) <= area(best.bbox);
}
