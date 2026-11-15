/**
 * What happens to a held part, as plain numbers (design 3.2, 3.4.8, 3.5): the release decision, the free spot beside a
 * board, the quarter turns of a wrist and the mat test. Pure: no IWSDK, no three.js, so it runs in Node tests.
 */
import type { GhostState, LegProblem } from '../core/fit';
import type { ActionRefusal } from '../core/actions';
import { PITCH_M } from '../core/cells';

export type Rotation = 0 | 90 | 180 | 270;

/** A rectangle in document millimetres. */
export interface RectMm {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

const PITCH_MM = PITCH_M * 1000;
/** Clear space kept between a loose part and what is beside it, millimetres. */
export const SPOT_MARGIN_MM = 2;

export const overlaps = (a: RectMm, b: RectMm, margin = 0): boolean =>
  a.minX < b.maxX + margin && a.maxX > b.minX - margin && a.minY < b.maxY + margin && a.maxY > b.minY - margin;

/**
 * The nearest spot to `want` (the part's origin, millimetres) where its rectangle `rel` (relative to the origin) clears
 * every rect of `others` and `allowed` accepts it, searched in rings of one pitch around `want`. Null when nothing within
 * `maxRings` pitches is free. Ties go to the spot nearer `want`; a free `want` is returned as it is.
 */
export function freeSpot(
  want: { x: number; y: number },
  rel: RectMm,
  others: readonly RectMm[],
  allowed: (rect: RectMm) => boolean,
  maxRings = 160,
): { x: number; y: number } | null {
  const free = (x: number, y: number): boolean => {
    const r: RectMm = { minX: x + rel.minX, maxX: x + rel.maxX, minY: y + rel.minY, maxY: y + rel.maxY };
    if (!allowed(r)) return false;
    for (const o of others) if (overlaps(r, o, SPOT_MARGIN_MM)) return false;
    return true;
  };
  if (free(want.x, want.y)) return { x: want.x, y: want.y };
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let k = 1; k <= maxRings; k++) {
    for (let i = -k; i <= k; i++) {
      for (const [gx, gy] of [[i, -k], [i, k], [-k, i], [k, i]] as const) {
        const x = want.x + gx * PITCH_MM;
        const y = want.y + gy * PITCH_MM;
        const d = Math.hypot(x - want.x, y - want.y);
        if (d < bestD && free(x, y)) {
          best = { x, y };
          bestD = d;
        }
      }
    }
    // a ring further out cannot be nearer than this ring's best once it is more than a diagonal away
    if (best && (k + 1) * PITCH_MM > bestD) break;
  }
  return best;
}

/** What a release does. */
export type Release =
  /** Over a shelf bin: a part of the bench leaves the project (a new part from the shelf just goes back). */
  | { kind: 'bin'; bin: number }
  /** The ghost is valid: seat at its fit. */
  | { kind: 'seat'; fit: NonNullable<GhostState['fit']> }
  /** Over the board with no valid fit: slide to a free spot on the mat beside it and say why. */
  | { kind: 'beside'; problem: LegProblem | null }
  /** On the mat: lie there. */
  | { kind: 'loose' }
  /** Off the mat (or nothing to do): back where it came from. */
  | { kind: 'back' };

export function decideRelease(input: { ghost: Pick<GhostState, 'shown' | 'fit' | 'problem'> | null; onMat: boolean; bin?: number }): Release {
  const g = input.ghost;
  if (input.bin !== undefined && input.bin >= 0) return { kind: 'bin', bin: input.bin };
  if (g?.shown && g.fit) return { kind: 'seat', fit: g.fit };
  if (!input.onMat) return { kind: 'back' };
  if (g?.shown) return { kind: 'beside', problem: g.problem };
  return { kind: 'loose' };
}

/** The refusal a failing leg stands for (the words come from `edit/strings.ts` or iynk's own). */
export function refusalOfProblem(problem: LegProblem): Pick<ActionRefusal, 'reason' | 'args'> {
  if (problem.state === 'taken') return { reason: 'hole-taken', args: { pin: problem.pin, hole: problem.hole ?? '', holder: problem.holderRefdes ?? '' } };
  if (problem.state === 'same-strip') return { reason: 'same-strip', args: { a: problem.withHole ?? problem.hole ?? '', b: problem.hole ?? '' } };
  return { reason: 'off-grid', args: { pin: problem.pin } };
}

/** The document rotation of a part drawn with `yawRad` about +y (space.ts: yaw = -rotation). */
export function rotationOfYaw(yawRad: number): Rotation {
  const q = ((Math.round((-yawRad * 180) / Math.PI / 90) * 90) % 360 + 360) % 360;
  return q as Rotation;
}

export const yawOfRotation = (rotation: number): number => (-rotation * Math.PI) / 180;

/** `rotation` after `steps` quarter turns of the wrist (counter-clockwise seen from above is positive). */
export function turned(rotation: Rotation, steps: number): Rotation {
  return ((((rotation - steps * 90) % 360) + 360) % 360) as Rotation;
}

/** The heading of a direction about +y, in degrees: the angle a turn of `psi` about +y adds to it. Null when it is nearly vertical. */
export function headingDeg(nx: number, nz: number, minLength = 0.3): number | null {
  if (Math.hypot(nx, nz) < minLength) return null;
  return (Math.atan2(nx, nz) * 180) / Math.PI;
}

/** A rectangle is on the mat when its middle is within the mat rectangle (table frame: centre, width, depth). */
export function onMatRect(mat: { x: number; z: number; w: number; d: number }, x: number, z: number): boolean {
  return Math.abs(x - mat.x) <= mat.w / 2 && Math.abs(z - mat.z) <= mat.d / 2;
}

/** The mat as one rectangle: the work zone and the back strip behind it. */
export function matOf(work: { x: number; z: number; w: number; d: number }, back: { x: number; z: number; w: number; d: number }): { x: number; z: number; w: number; d: number } {
  const near = work.z + work.d / 2;
  const far = Math.min(back.z - back.d / 2, work.z - work.d / 2);
  const w = Math.max(work.w, back.w);
  return { x: work.x, z: (near + far) / 2, w, d: near - far };
}

/** Eases a blend factor: `k` from 0 to 1 over `ms`, given elapsed milliseconds. */
export const progress = (elapsedMs: number, ms: number): number => (ms <= 0 ? 1 : Math.min(1, Math.max(0, elapsedMs / ms)));
