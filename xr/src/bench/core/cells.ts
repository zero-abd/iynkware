/**
 * Cells (design 3.4.2): a pin or hole is targeted through its cell, the part of the board's top plane nearer to it than
 * to any other anchor, up to 0.75 pitch away and from 0 to 0.015 m (work) above the mouth. A square grid at one pitch
 * leaves no dead space at that reach (a cell's corner is 0.71 pitch from its anchor).
 *
 * `createCellIndex` is built once per layout from the anchors of one surface or board in the board frame (metres, real
 * size, +Y up, the mouth at the anchor's `y`, normal +Y). Queries are allocation-free: a dense grid hash of one pitch per
 * bucket, the answer an anchor index (-1 for none) and its plane distance in `lastDistance`. `createStickyCell` keeps a
 * pointer's choice until another cell is nearer by a margin (design 3.1). Pure: no IWSDK, no three.js.
 */
import type { PartRegistry } from '@/parts/registry';
import type { Project } from '@/project/generated/types';
import { resolvePart } from '@/studio/parts-view';

/** One breadboard pitch, metres (life). */
export const PITCH_M = 0.00254;
/** How far a cell reaches from its anchor in the top plane, as a fraction of the pitch. */
export const CELL_REACH_PITCH = 0.75;
/** How high above the mouth a near pointer still targets the cell, metres of work. */
export const CELL_BAND_WORK_M = 0.015;
/**
 * How far below the mouth a near pointer still targets the cell, metres of work. Not in the design: a starting value
 * so a fingertip pressed onto the board does not lose its target to tracking noise [device?].
 */
export const CELL_BELOW_WORK_M = 0.003;
/** A near pinch changes cells only for one nearer by this much, in pitches. */
export const NEAR_MARGIN_PITCH = 0.15;
/** A ray changes cells only for one nearer by this angular margin (dmm: mm per metre of viewing distance)... */
export const RAY_MARGIN_DMM = 8;
/** ...on this many frames in a row. */
export const RAY_FRAMES = 2;

/** A pin or hole anchor in the board frame: metres at real size, the mouth at `y`. */
export interface CellAnchor {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CellIndex {
  readonly count: number;
  readonly ids: readonly string[];
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly zs: Float64Array;
  /** The mouth plane far rays are intersected with: the anchors' mean height. */
  readonly planeY: number;
  /** The anchors' extent in the top plane. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Plane distance from the last query's point to its answer; Infinity when it found none. */
  readonly lastDistance: number;
  /** Where the last `queryRay` met the mouth plane. */
  readonly hitX: number;
  readonly hitZ: number;
  /** The anchor nearest to (x, z) in the top plane within `maxDist` (inclusive), or -1. Ties go to the lower index. */
  nearest(x: number, z: number, maxDist: number): number;
  /** The targeted cell of a near pointer at a board-frame point, at work scale `s`, or -1. */
  query(x: number, y: number, z: number, s: number): number;
  /** The targeted cell of a far ray (board frame): its hit on the mouth plane, queried at height 0, or -1. */
  queryRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number;
  /** Plane distance from anchor `i` to (x, z). */
  distance(i: number, x: number, z: number): number;
  indexOf(id: string): number;
}

const TIE = 1e-12;

export function createCellIndex(anchors: readonly CellAnchor[]): CellIndex {
  const count = anchors.length;
  const ids = anchors.map((a) => a.id);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const zs = new Float64Array(count);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let sumY = 0;
  anchors.forEach((a, i) => {
    xs[i] = a.x;
    ys[i] = a.y;
    zs[i] = a.z;
    minX = Math.min(minX, a.x);
    maxX = Math.max(maxX, a.x);
    minZ = Math.min(minZ, a.z);
    maxZ = Math.max(maxZ, a.z);
    sumY += a.y;
  });
  const cell = PITCH_M;
  const nx = count === 0 ? 0 : Math.floor((maxX - minX) / cell) + 1;
  const nz = count === 0 ? 0 : Math.floor((maxZ - minZ) / cell) + 1;
  const bucketOf = (i: number) => Math.floor((xs[i]! - minX) / cell) * nz + Math.floor((zs[i]! - minZ) / cell);
  const start = new Int32Array(nx * nz + 1);
  for (let i = 0; i < count; i++) start[bucketOf(i) + 1]!++;
  for (let b = 0; b < nx * nz; b++) start[b + 1]! += start[b]!;
  const items = new Int32Array(count);
  const fill = start.slice(0, nx * nz);
  for (let i = 0; i < count; i++) items[fill[bucketOf(i)]!++] = i;
  const byId = new Map(ids.map((id, i) => [id, i]));
  const reach = CELL_REACH_PITCH * PITCH_M;

  const index = {
    count,
    ids,
    xs,
    ys,
    zs,
    planeY: count === 0 ? 0 : sumY / count,
    minX,
    maxX,
    minZ,
    maxZ,
    lastDistance: Infinity,
    hitX: NaN,
    hitZ: NaN,

    nearest(x: number, z: number, maxDist: number): number {
      let best = -1;
      let bestD = maxDist;
      if (count > 0 && Number.isFinite(x) && Number.isFinite(z)) {
        const r = Number.isFinite(maxDist) ? Math.ceil(maxDist / cell) : Math.max(nx, nz);
        const cx = Math.floor((x - minX) / cell);
        const cz = Math.floor((z - minZ) / cell);
        const x0 = Math.max(0, cx - r);
        const x1 = Math.min(nx - 1, cx + r);
        const z0 = Math.max(0, cz - r);
        const z1 = Math.min(nz - 1, cz + r);
        for (let gx = x0; gx <= x1; gx++) {
          for (let gz = z0; gz <= z1; gz++) {
            const b = gx * nz + gz;
            for (let k = start[b]!; k < start[b + 1]!; k++) {
              const i = items[k]!;
              const ddx = xs[i]! - x;
              const ddz = zs[i]! - z;
              const d = Math.sqrt(ddx * ddx + ddz * ddz);
              if (d < bestD - TIE || (d <= bestD + TIE && (best === -1 || i < best))) {
                best = i;
                bestD = d;
              }
            }
          }
        }
      }
      index.lastDistance = best === -1 ? Infinity : bestD;
      return best;
    },

    query(x: number, y: number, z: number, s: number): number {
      const i = index.nearest(x, z, reach);
      if (i === -1) return -1;
      const h = y - ys[i]!;
      // both ends inclusive, to a nanometre of float noise
      if (h > CELL_BAND_WORK_M / s + 1e-9 || h < -CELL_BELOW_WORK_M / s - 1e-9) {
        index.lastDistance = Infinity;
        return -1;
      }
      return i;
    },

    queryRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
      index.hitX = NaN;
      index.hitZ = NaN;
      const t = Math.abs(dy) < 1e-12 ? -1 : (index.planeY - oy) / dy;
      if (!(t >= 0)) {
        index.lastDistance = Infinity;
        return -1;
      }
      index.hitX = ox + t * dx;
      index.hitZ = oz + t * dz;
      return index.nearest(index.hitX, index.hitZ, reach);
    },

    distance(i: number, x: number, z: number): number {
      const ddx = xs[i]! - x;
      const ddz = zs[i]! - z;
      return Math.sqrt(ddx * ddx + ddz * ddz);
    },

    indexOf: (id: string): number => byId.get(id) ?? -1,
  };
  return index;
}

/** A point of a part's layout turned about its corner by `deg`, counter-clockwise in the y-down document frame (iynk's `turn`, at any angle). */
export function turnDeg(x: number, y: number, deg: number): { x: number; y: number } {
  const q = ((deg % 360) + 360) % 360;
  if (q === 0) return { x, y };
  if (q === 90) return { x: y, y: -x };
  if (q === 180) return { x: -x, y: -y };
  if (q === 270) return { x: -y, y: x };
  const r = (q * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c + y * s, y: -x * s + y * c };
}

/**
 * The pin or hole anchors of a board or surface from the document, in the board frame (`x = x_mm / 1000`, `z = y_mm /
 * 1000`, the mouth at `topY`): every positioned, non-mechanical pin of its shape (`resolvePart`), placed at its
 * breadboard-view placement and turned with it. For tests and as the fallback when no asset anchors are at hand.
 */
export function cellAnchorsFromDoc(doc: Project, part: string, opts: { topY?: number; registry?: PartRegistry } = {}): CellAnchor[] {
  const view = doc.views.find((v) => v.kind === 'breadboard');
  const placement = view?.placements.find((p) => p.c === part);
  const item = [...doc.boards, ...doc.components].find((x) => x.id === part);
  if (!placement || !item) return [];
  const shape = opts.registry ? resolvePart(doc, item.definition.ref, opts.registry) : resolvePart(doc, item.definition.ref);
  const topY = opts.topY ?? 0;
  return shape.pins
    .filter((p) => !p.mechanical)
    .map((p) => {
      const t = turnDeg(p.xMm, p.yMm, placement.rotation_deg ?? 0);
      return { id: p.id, x: (placement.x_mm + t.x) / 1000, y: topY, z: (placement.y_mm + t.y) / 1000 };
    });
}

export interface StickyCell {
  /** The cell this pointer targets, or -1. */
  readonly current: number;
  /** A near pointer (pinch point or controller tip) at a board-frame point, at work scale `s`. */
  near(x: number, y: number, z: number, s: number): number;
  /**
   * A far ray in the board frame, at work scale `s`; `viewDistance` is how far the hit is from the eyes in world metres,
   * which turns the 8 dmm margin into board metres (`0.008 * viewDistance / s`).
   */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, s: number, viewDistance: number): number;
  reset(): void;
}

/**
 * One pointer's cell choice with hysteresis (design 3.1): the current cell stays until a new one is nearer by a margin,
 * 0.15 pitch (work) for a near pinch, 8 dmm on two frames in a row for a ray. Leaving every cell (out of reach or out
 * of the height band) drops the choice at once. Allocation-free.
 */
export function createStickyCell(index: CellIndex): StickyCell {
  const reach = CELL_REACH_PITCH * PITCH_M;
  const nearMargin = NEAR_MARGIN_PITCH * PITCH_M;
  let current = -1;
  let pending = -1;
  let frames = 0;

  const choose = (found: number, dFound: number, x: number, z: number, margin: number, needed: number): number => {
    if (found === -1) {
      current = -1;
      pending = -1;
      frames = 0;
      return current;
    }
    if (current === -1 || found === current) {
      current = found;
      pending = -1;
      frames = 0;
      return current;
    }
    const dCurrent = index.distance(current, x, z);
    if (dCurrent > reach) {
      current = found;
      pending = -1;
      frames = 0;
      return current;
    }
    if (dFound + margin < dCurrent) {
      frames = pending === found ? frames + 1 : 1;
      pending = found;
      if (frames >= needed) {
        current = found;
        pending = -1;
        frames = 0;
      }
    } else {
      pending = -1;
      frames = 0;
    }
    return current;
  };

  return {
    get current() {
      return current;
    },
    near(x, y, z, s) {
      const found = index.query(x, y, z, s);
      return choose(found, index.lastDistance, x, z, nearMargin, 1);
    },
    ray(ox, oy, oz, dx, dy, dz, s, viewDistance) {
      const found = index.queryRay(ox, oy, oz, dx, dy, dz);
      return choose(found, index.lastDistance, index.hitX, index.hitZ, (RAY_MARGIN_DMM / 1000) * (viewDistance / s), RAY_FRAMES);
    },
    reset() {
      current = -1;
      pending = -1;
      frames = 0;
    },
  };
}
