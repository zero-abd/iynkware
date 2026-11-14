/**
 * Ghost fit (design 3.4.3 to 3.4.7): where a held part would seat on the breadboard, through iynk's own rule. The fit
 * is `seatOnSurface` at the steadied anchor point (the first non-mechanical leg, as in the 2D Studio): the nearest hole
 * within 1.5 pitches that takes every leg on a free hole without a chip's two pins in one strip, or within 4 pitches for
 * a chip that has to straddle the centre channel. On top of it, hysteresis: the ghost keeps its current fit until a new
 * best is nearer by 0.35 pitch. And, for the fit under the anchor leg (no snapping), each leg's status in pin order and
 * the first failing leg with a reason, so the ghost can ring every target hole and say why.
 *
 * Board frame to document: `x_mm = x * 1000`, `y_mm = z * 1000` (contracts/space.ts). Heights stay in the board frame.
 * Per frame `update` allocates nothing while the anchor stays over one hole; iynk's rule runs again only when the hole
 * under the anchor, the rotation or the document changes. Pure: no IWSDK, no three.js.
 */
import { builtinRegistry } from '@/parts/builtin';
import { interfaceOf } from '@/parts/pins';
import type { InterfaceSnapshot } from '@/parts/pins';
import type { PartRegistry } from '@/parts/registry';
import type { Project, View } from '@/project/generated/types';
import type { ResolvedPartShape, Rotation } from '@/studio/engine/types';
import { resolvePart } from '@/studio/parts-view';
import { legsShort } from '@/studio/rules/connect';
import { seatOnSurface } from '@/studio/tools/place';
import type { SeatCtx } from '@/studio/tools/place';
import { holeAt, holeGridOf, turn } from '@/studio/views/breadboard';
import type { HoleGrid } from '@/studio/views/breadboard';
import { createCellIndex, PITCH_M } from './cells';
import type { CellIndex } from './cells';
import { createOneEuro3 } from './steady';
import type { OneEuroOptions } from './steady';

/** The ghost shows once the held part's lowest leg tip is this close to the board's top face, metres of work. */
export const GHOST_HEIGHT_WORK_M = 0.025;
/** As `seatOnSurface`: how far from the anchor a fit is looked for, and for a chip across the centre channel. */
export const SNAP_REACH_PITCH = 1.5;
export const STRADDLE_REACH_PITCH = 4;
/** A new fit replaces the current one only when nearer by this much (design 3.4.4). */
export const FIT_HYSTERESIS_PITCH = 0.35;
/** As place.ts: a part with this many legs is a chip, which straddles the channel and never puts two pins in one strip. */
const CHIP_LEGS = 6;
const PITCH_MM = PITCH_M * 1000;

/** Where a part seats: its first leg in `anchorHole`, turned by `rotation`. `x_mm`, `y_mm` and `legs` are the placement's. */
export interface Fit {
  readonly anchorHole: string;
  readonly rotation: Rotation;
  readonly x_mm: number;
  readonly y_mm: number;
  readonly legs: Readonly<Record<string, string>>;
}

export type LegState = 'free' | 'taken' | 'same-strip' | 'off-grid';

/** One leg of the fit under the anchor leg, in pin order. */
export interface LegStatus {
  readonly pin: string;
  /** The hole under the leg, null off the grid. */
  readonly hole: string | null;
  readonly state: LegState;
  /** `taken`: the part holding the hole (id and refdes). */
  readonly holder?: string;
  readonly holderRefdes?: string;
  /** `same-strip`: the earlier leg in the same strip, and its hole. */
  readonly with?: string;
  readonly withHole?: string;
}

/** The first leg that fails, with the reason (`taken`, `same-strip`, `off-grid`). */
export type LegProblem = LegStatus & { readonly state: Exclude<LegState, 'free'> };

export interface GhostState {
  /** Whether the ghost shows at all (the part is close enough to the board and over it). */
  shown: boolean;
  /** What a release seats now (after hysteresis); null when no valid fit is in reach. */
  fit: Fit | null;
  /** The fit changed on this update (appeared, moved or went): the snap tick. */
  changed: boolean;
  /** The hole under the anchor leg (nearest within the snap reach), or null. */
  anchorHole: string | null;
  /** Each leg's status for the fit under the anchor leg, in pin order. */
  legs: readonly LegStatus[];
  /** The first failing leg of `legs`, or null when every leg is free. */
  problem: LegProblem | null;
  /** The steadied anchor point, board frame (filtered while shown). */
  x: number;
  y: number;
  z: number;
}

export interface HeldPart {
  /** The part's definition ref; read from the document when `part` is given and this is not. */
  readonly ref?: string;
  /** An existing part being moved: it may use the holes it holds now. */
  readonly part?: string;
  readonly rotation?: Rotation;
}

export interface GhostFitOptions {
  /** The board frame height of the breadboard's top face (its hole mouths), metres. Default 0. */
  readonly topY?: number;
  readonly registry?: PartRegistry;
  /** The one-euro filter on the anchor point while the ghost shows (design 3.4.6); false turns it off. */
  readonly steady?: OneEuroOptions | false;
}

export interface GhostFit {
  /** The first non-mechanical pin: the leg whose tip the caller tracks as the anchor. */
  readonly anchorPin: string;
  readonly rotation: Rotation;
  readonly state: GhostState;
  /**
   * One frame: the anchor leg's tip and the lowest leg tip's height (board frame, metres, real size) at work scale `s`,
   * at time `tSec`. Returns `state`, updated in place.
   */
  update(tSec: number, ax: number, ay: number, az: number, lowestY: number, s: number): GhostState;
  /** Turns the held part; the current fit goes and the next update finds one for the new rotation. */
  setRotation(rotation: Rotation): void;
  /** The document changed (a seat, a remote edit): taken holes are read again. */
  setDoc(doc: Project): void;
  /** Hides the ghost and forgets the fit and the filter. */
  reset(): void;
}

let defaultRegistry: PartRegistry | undefined;
const registryOr = (r?: PartRegistry): PartRegistry => r ?? (defaultRegistry ??= builtinRegistry());

/** The breadboard of the document's breadboard view, read once per document. */
interface Surface {
  doc: Project;
  view: View;
  id: string;
  /** The surface's placement corner, document mm. */
  atX: number;
  atY: number;
  grid: HoleGrid;
  holes: ReadonlyMap<string, { xMm: number; yMm: number }>;
  /** Hole to the part whose leg is in it. */
  holders: ReadonlyMap<string, string>;
  refdes: ReadonlyMap<string, string>;
  ctx: SeatCtx;
}

function surfaceOf(doc: Project, registry: PartRegistry): Surface | null {
  const view = doc.views.find((v) => v.kind === 'breadboard');
  const id = view?.surface;
  const at = view?.placements.find((p) => p.c === id);
  const item = doc.components.find((c) => c.id === id);
  if (!view || id === undefined || !at || !item) return null;
  const resolve = (ref: string) => resolvePart(doc, ref, registry);
  const grid = holeGridOf(resolve(item.definition.ref));
  const holders = new Map<string, string>();
  for (const p of view.placements) for (const hole of Object.values(p.legs ?? {})) if (hole !== undefined) holders.set(hole, p.c);
  return {
    doc,
    view,
    id,
    atX: at.x_mm,
    atY: at.y_mm,
    grid,
    holes: new Map(grid.holes.map((h) => [h.hole, h])),
    holders,
    refdes: new Map([...doc.boards, ...doc.components].map((x) => [x.id, x.refdes])),
    ctx: { view, resolve, doc: { state: doc } },
  };
}

/** The part's interface for iynk's same-strip rule: what the project pinned, else the library's (as `placeBatch` does). */
function interfaceFor(doc: Project, ref: string, registry: PartRegistry): InterfaceSnapshot | undefined {
  const pinned = doc.dependencies.components.find((d) => d.ref === ref);
  if (pinned) return pinned.interface;
  const d = registry.latest(ref);
  return d ? interfaceOf(d) : undefined;
}

interface Held {
  ref: string;
  keep: string | undefined;
  shape: ResolvedPartShape;
  legs: ResolvedPartShape['pins'];
  iface: InterfaceSnapshot | undefined;
  chip: boolean;
}

function heldOf(doc: Project, held: HeldPart, registry: PartRegistry): Held | null {
  const ref = held.ref ?? [...doc.boards, ...doc.components].find((x) => x.id === held.part)?.definition.ref;
  if (ref === undefined) return null;
  const d = registry.latest(ref);
  if (d?.identity.kind === 'board') return null;
  const shape = resolvePart(doc, ref, registry);
  const legs = shape.pins.filter((p) => !p.mechanical);
  if (legs.length === 0) return null;
  return { ref, keep: held.part, shape, legs, iface: interfaceFor(doc, ref, registry), chip: legs.length >= CHIP_LEGS };
}

/**
 * Each leg's status when the anchor leg is in `anchorHole` turned by `rotation`, in pin order: off the grid, taken (by
 * a part other than the one held), in one strip with an earlier leg (iynk's `legsShort`, so pins the part joins inside
 * may share a strip), or free. Holes under the legs are found as iynk's `legsFit` finds them (within half a pitch).
 */
function legsAt(s: Surface, h: Held, anchorHole: string, rotation: Rotation): LegStatus[] {
  const anchor = s.holes.get(anchorHole);
  const first = h.legs[0]!;
  const out: LegStatus[] = [];
  const placed: Array<{ pin: string; hole: string }> = [];
  for (const leg of h.legs) {
    const off = turn({ x: leg.xMm - first.xMm, y: leg.yMm - first.yMm }, rotation);
    const hole = anchor ? holeAt(s.grid, { x: anchor.xMm + off.x, y: anchor.yMm + off.y }, PITCH_MM / 2) : null;
    if (hole === null) {
      out.push({ pin: leg.id, hole: null, state: 'off-grid' });
      continue;
    }
    const holder = s.holders.get(hole);
    if (holder !== undefined && holder !== h.keep) {
      out.push({ pin: leg.id, hole, state: 'taken', holder, holderRefdes: s.refdes.get(holder) ?? holder });
      placed.push({ pin: leg.id, hole });
      continue;
    }
    const mate = placed.find((p) => legsShort(s.doc, s.view.id, { [p.pin]: p.hole, [leg.id]: hole }, h.iface));
    placed.push({ pin: leg.id, hole });
    out.push(mate ? { pin: leg.id, hole, state: 'same-strip', with: mate.pin, withHole: mate.hole } : { pin: leg.id, hole, state: 'free' });
  }
  return out;
}

const firstProblem = (legs: readonly LegStatus[]): LegProblem | null => (legs.find((l) => l.state !== 'free') as LegProblem | undefined) ?? null;

/** iynk's `seatOnSurface` at a document point, as a `Fit`. */
function bestFit(s: Surface, h: Held, xMm: number, yMm: number, rotation: Rotation): Fit | null {
  const seat = seatOnSurface(s.ctx, h.shape, { x: xMm, y: yMm }, { rotation, keep: h.keep, iface: h.iface });
  const anchorHole = seat?.legs?.[h.legs[0]!.id];
  if (!seat?.legs || anchorHole === undefined) return null;
  return { anchorHole, rotation, x_mm: seat.x, y_mm: seat.y, legs: seat.legs };
}

/** The hole anchors of the surface in the board frame, for finding the hole under the anchor leg. */
function surfaceCells(s: Surface, topY: number): CellIndex {
  return createCellIndex(s.grid.holes.map((h) => ({ id: h.hole, x: (s.atX + h.xMm) / 1000, y: topY, z: (s.atY + h.yMm) / 1000 })));
}

export type FitCheck = { ok: true; fit: Fit } | { ok: false; problem: LegProblem };

/**
 * Whether a part seats with its first leg in `anchorHole` turned by `rotation`, by iynk's rule (`seatOnSurface` must
 * put the anchor leg exactly there), and if not, the first failing leg. For `seatPart` and for checking a ghost's fit.
 */
export function checkFit(doc: Project, held: HeldPart & { anchorHole: string; rotation: Rotation }, registry?: PartRegistry): FitCheck | null {
  const reg = registryOr(registry);
  const s = surfaceOf(doc, reg);
  const h = heldOf(doc, held, reg);
  if (!s || !h || held.part === s.id) return null;
  const hole = s.holes.get(held.anchorHole);
  if (!hole) return { ok: false, problem: { pin: h.legs[0]!.id, hole: null, state: 'off-grid' } };
  const fit = bestFit(s, h, s.atX + hole.xMm, s.atY + hole.yMm, held.rotation);
  if (fit && fit.anchorHole === held.anchorHole) return { ok: true, fit };
  const problem = firstProblem(legsAt(s, h, held.anchorHole, held.rotation));
  // seatOnSurface refused though every leg is free: nothing else is refused, so it is a chip short iynk found
  return { ok: false, problem: problem ?? { pin: h.legs[0]!.id, hole: held.anchorHole, state: 'same-strip' } };
}

const sameFit = (a: Fit | null, b: Fit | null): boolean =>
  a === b || (a !== null && b !== null && a.anchorHole === b.anchorHole && a.rotation === b.rotation && a.x_mm === b.x_mm && a.y_mm === b.y_mm);

/**
 * A held part's ghost over the document's breadboard. Null when there is nothing to seat on (no breadboard surface) or
 * the held thing does not seat (a board, a part with no legs).
 */
export function createGhostFit(doc: Project, held: HeldPart, opts: GhostFitOptions = {}): GhostFit | null {
  const registry = registryOr(opts.registry);
  const topY = opts.topY ?? 0;
  let surface = surfaceOf(doc, registry);
  const part = heldOf(doc, held, registry);
  // the breadboard itself never seats in its own holes
  if (!surface || !part || held.part === surface.id) return null;
  let cells = surfaceCells(surface, topY);
  const filter = opts.steady === false ? null : createOneEuro3(opts.steady ?? {});
  const snapReach = SNAP_REACH_PITCH * PITCH_M;
  const keepReach = (part.chip ? STRADDLE_REACH_PITCH : SNAP_REACH_PITCH) * PITCH_M;
  const margin = FIT_HYSTERESIS_PITCH * PITCH_M;
  let rotation: Rotation = held.rotation ?? 0;

  // the cache: iynk's answers for the hole under the anchor, read again when it, the rotation or the document changes
  let cachedHole = -1;
  let cachedBest: Fit | null = null;
  let stale = true;

  const state: GhostState = { shown: false, fit: null, changed: false, anchorHole: null, legs: [], problem: null, x: 0, y: 0, z: 0 };

  const hide = () => {
    state.changed = state.fit !== null;
    state.shown = false;
    state.fit = null;
    state.anchorHole = null;
    state.legs = [];
    state.problem = null;
    filter?.reset();
    stale = true;
  };

  const fitCentre = (fit: Fit) => cells.indexOf(fit.anchorHole);

  return {
    anchorPin: part.legs[0]!.id,
    get rotation() {
      return rotation;
    },
    state,
    update(tSec, ax, ay, az, lowestY, s) {
      const over = ax >= cells.minX - snapReach && ax <= cells.maxX + snapReach && az >= cells.minZ - snapReach && az <= cells.maxZ + snapReach;
      if (!over || lowestY - topY > GHOST_HEIGHT_WORK_M / s) {
        if (state.shown || state.fit !== null) hide();
        else state.changed = false;
        return state;
      }
      let x = ax;
      let y = ay;
      let z = az;
      if (filter) {
        filter.filter(tSec, ax, ay, az);
        x = filter.x;
        y = filter.y;
        z = filter.z;
      }
      state.shown = true;
      state.x = x;
      state.y = y;
      state.z = z;

      const under = cells.nearest(x, z, snapReach);
      if (stale || under !== cachedHole) {
        stale = false;
        cachedHole = under;
        if (under === -1) {
          cachedBest = bestFit(surface!, part, x * 1000, z * 1000, rotation);
          state.anchorHole = null;
          state.legs = [];
          state.problem = { pin: part.legs[0]!.id, hole: null, state: 'off-grid' };
        } else {
          const name = cells.ids[under]!;
          cachedBest = bestFit(surface!, part, x * 1000, z * 1000, rotation);
          state.anchorHole = name;
          state.legs = legsAt(surface!, part, name, rotation);
          state.problem = firstProblem(state.legs);
        }
      }

      // hysteresis: the current fit stays while it is in reach and no new best is nearer by 0.35 pitch
      const prev = state.fit;
      let next = cachedBest;
      if (prev !== null && next !== null && next.anchorHole !== prev.anchorHole) {
        const ic = fitCentre(prev);
        const dCurrent = ic === -1 ? Infinity : cells.distance(ic, x, z);
        const ib = fitCentre(next);
        const dBest = ib === -1 ? Infinity : cells.distance(ib, x, z);
        if (dCurrent <= keepReach && !(dBest + margin < dCurrent)) next = prev;
      }
      state.changed = !sameFit(prev, next);
      state.fit = next;
      return state;
    },
    setRotation(r) {
      if (r === rotation) return;
      rotation = r;
      stale = true;
      state.fit = null;
    },
    setDoc(next) {
      const s = surfaceOf(next, registry);
      if (!s) {
        hide();
        return;
      }
      surface = s;
      cells = surfaceCells(s, topY);
      stale = true;
      state.fit = null;
    },
    reset: hide,
  };
}
