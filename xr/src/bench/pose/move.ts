/**
 * Moving the whole bench by its grip bar, pure so it is tested (no three.js runtime imports). The hold is the panels'
 * one (`ui/panels/drag.ts`): a ray holds the point it hit at the depth it hit it, so the bench swings with the ray; a
 * near pinch or grip holds the hand, so the bench follows the hand. The bench follows in x, y and z, stays level,
 * turns to keep facing the eyes (`orbitedTop`), and its top never goes under `FLOOR_CLEAR` above the floor (y = 0 in
 * `local-floor`).
 *
 * Where the person left it is one small record in `localStorage` (`iynk:xr:bench:v1`), world metres, written when a
 * drag ends. Storage that throws or is missing keeps it in memory for the session.
 *
 *   const hold = beginBenchDrag(benchTop, pointer, hitPoint);
 *   app.bench.setBenchTop(orbitedTop(hold, pointer, benchTop.yawRad, eye));   // every drag-move, facing the eyes
 */
import type { Vec3 } from '../../contracts/common';
import { beginDrag, heldPoint, type DragHold, type DragPointer, type MVec3 } from '../../ui/panels/drag';
import type { StorageLike } from '../../ui/panels/store';

export interface TopPose {
  readonly position: Vec3;
  readonly yawRad: number;
}

/** The lowest the bench top may go, metres above the floor. */
export const FLOOR_CLEAR = 0.1;
/** The stored place's key, next to the panels' places (`iynk:xr:panels:v1`). */
export const BENCH_PLACE_KEY = 'iynk:xr:bench:v1';

/** Starts a drag of the bench whose top is at `top` by `pointer`, which pressed the grip bar at `hit` (world). */
export function beginBenchDrag(top: TopPose, pointer: DragPointer, hit?: Vec3): DragHold {
  return beginDrag(top.position, pointer, hit);
}

/** The bench top for the pointer's pose now: held point plus offset, level, turned by `yawRad`, above the floor. */
export function draggedTop(hold: DragHold, pointer: DragPointer, yawRad: number, floorY = 0): TopPose {
  const p: MVec3 = [0, 0, 0];
  heldPoint(hold, pointer, p);
  if (p[1] < floorY + FLOOR_CLEAR) p[1] = floorY + FLOOR_CLEAR;
  return { position: p, yawRad };
}

/** Nearer than this (metres, on the floor plan) to the eyes, the bench keeps its turn rather than spin about them. */
export const ORBIT_MIN_M = 0.2;

/** The yaw (bench convention: 0 faces down -z, positive turns left) of a bench at `p` facing eyes at `eye`, or null. */
export function facingYaw(p: Vec3, eye: Vec3): number | null {
  const dx = p[0] - eye[0];
  const dz = p[2] - eye[2];
  return Math.hypot(dx, dz) < ORBIT_MIN_M ? null : Math.atan2(-dx, -dz);
}

/**
 * The bench top for the pointer's pose now, swung round the person (owner, 2026-11-15): it stays turned to face the
 * eyes at `eye` wherever it is carried, so carried to the left or right it goes round them on a circle rather than
 * sliding sideways and ending edge-on. The held point stays under the pointer: the hold's offset (held point to top
 * centre, taken at `startYaw`) turns with the bench. Level and above the floor as `draggedTop`.
 */
export function orbitedTop(hold: DragHold, pointer: DragPointer, startYaw: number, eye: Vec3, floorY = 0): TopPose {
  const grab: MVec3 = [0, 0, 0];
  heldPoint({ offset: [0, 0, 0], depth: hold.depth }, pointer, grab);
  const [ox, oy, oz] = hold.offset;
  const at = (yaw: number): MVec3 => {
    const t = yaw - startYaw;
    const c = Math.cos(t);
    const s = Math.sin(t);
    // Turned about +y by t (positive turns -z towards -x, the bench's left).
    return [grab[0] + ox * c + oz * s, grab[1] + oy, grab[2] - ox * s + oz * c];
  };
  let yaw = startYaw;
  let p = at(yaw);
  // The yaw depends on where the centre lands and the centre on the yaw; each round shrinks the error by about the
  // bar's distance from the centre over the centre's from the eyes (about half), so this settles in a few dozen.
  for (let i = 0; i < 48; i++) {
    const next = facingYaw(p, eye);
    if (next === null) break;
    const step = Math.abs(next - yaw);
    yaw = next;
    p = at(yaw);
    if (step < 1e-9) break;
  }
  if (p[1] < floorY + FLOOR_CLEAR) p[1] = floorY + FLOOR_CLEAR;
  return { position: p, yawRad: yaw };
}

/** Reads a record (`{ "v": 1, "position": [x, y, z], "yawRad": r }`); anything unreadable or far away is none. */
export function parseBenchPlace(raw: string | null | undefined): TopPose | null {
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as { v?: unknown; position?: unknown; yawRad?: unknown };
    const p = rec?.position;
    if (rec?.v !== 1 || !Array.isArray(p) || p.length !== 3) return null;
    if (!p.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 20)) return null;
    if (typeof rec.yawRad !== 'number' || !Number.isFinite(rec.yawRad)) return null;
    return { position: [p[0], Math.max(FLOOR_CLEAR, p[1]), p[2]], yawRad: rec.yawRad };
  } catch {
    return null;
  }
}

/** Writes a record, rounded to a tenth of a millimetre. */
export function formatBenchPlace(pose: TopPose): string {
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return JSON.stringify({ v: 1, position: pose.position.map(r), yawRad: r(pose.yawRad) });
}

export interface BenchPlaceStore {
  /** Where the person left the bench, or null (it stands where Recentre or the app put it). */
  get(): TopPose | null;
  set(pose: TopPose): void;
  clear(): void;
}

export function createBenchPlaceStore(storage: StorageLike | null, key = BENCH_PLACE_KEY): BenchPlaceStore {
  let place: TopPose | null = null;
  try {
    place = parseBenchPlace(storage?.getItem(key));
  } catch {
    place = null;
  }
  const save = () => {
    if (!storage) return;
    try {
      if (place) storage.setItem(key, formatBenchPlace(place));
      else storage.removeItem(key);
    } catch {
      // Full or blocked: the place lives on for this session.
    }
  };
  return {
    get: () => place,
    set(pose) {
      place = { position: [pose.position[0], pose.position[1], pose.position[2]], yawRad: pose.yawRad };
      save();
    },
    clear() {
      if (!place) return;
      place = null;
      save();
    },
  };
}
