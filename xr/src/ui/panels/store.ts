/**
 * Where the person has put each panel, per panel id, in the bench's own frame (`BenchSpace.table`: metres, origin at
 * the bench top centre, +z towards the person), so a moved panel comes back where it was left after a reload and
 * moves with the bench when it is recentred or brought here. One small JSON record in `localStorage`, written when a
 * drag ends (never per frame). Storage that throws or is missing (a private window, the tests) keeps the places in
 * memory for the session.
 */
import type { Vec3 } from '../../contracts/common';
import type { MVec3 } from './drag';

/** The record's key, next to the headset settings (`iynk:xr:v1`). */
export const PLACES_KEY = 'iynk:xr:panels:v1';

/** The part of `Storage` the store uses. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface PlaceStore {
  /** The place the person left panel `id` at, or undefined (the panel's own default). Do not keep the array. */
  get(id: string): Readonly<MVec3> | undefined;
  set(id: string, p: Vec3): void;
  /** Forgets the place of `id` alone. */
  forget(id: string): void;
  /** Forgets every place (Tidy up). */
  clear(): void;
  ids(): string[];
}

/** A place a record may hold: three finite numbers within 20 m of the bench. */
const isPlace = (v: unknown): v is MVec3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 20);

/** Reads a record (`{ "v": 1, "places": { id: [x, y, z] } }`); anything unreadable is skipped. */
export function parsePlaces(raw: string | null | undefined): Map<string, MVec3> {
  const out = new Map<string, MVec3>();
  if (!raw) return out;
  try {
    const rec = JSON.parse(raw) as { v?: unknown; places?: unknown };
    if (rec?.v !== 1 || typeof rec.places !== 'object' || rec.places === null) return out;
    for (const [id, p] of Object.entries(rec.places as Record<string, unknown>)) if (isPlace(p)) out.set(id, [p[0], p[1], p[2]]);
  } catch {
    // A broken record is as good as none.
  }
  return out;
}

/** Writes `places` as a record, rounded to a tenth of a millimetre. */
export function formatPlaces(places: ReadonlyMap<string, Readonly<MVec3>>): string {
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  const rec: Record<string, MVec3> = {};
  for (const [id, p] of places) rec[id] = [r(p[0]), r(p[1]), r(p[2])];
  return JSON.stringify({ v: 1, places: rec });
}

/** `localStorage` when the page has one and it can be read, else null. */
export function browserStorage(): StorageLike | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    if (!s) return null;
    s.getItem(PLACES_KEY);
    return s;
  } catch {
    return null;
  }
}

export function createPlaceStore(storage: StorageLike | null = browserStorage(), key = PLACES_KEY): PlaceStore {
  let places: Map<string, MVec3>;
  try {
    places = parsePlaces(storage?.getItem(key));
  } catch {
    places = new Map();
  }
  const save = () => {
    if (!storage) return;
    try {
      if (places.size === 0) storage.removeItem(key);
      else storage.setItem(key, formatPlaces(places));
    } catch {
      // Full or blocked: the places live on for this session.
    }
  };
  return {
    get: (id) => places.get(id),
    set(id, p) {
      places.set(id, [p[0], p[1], p[2]]);
      save();
    },
    forget(id) {
      if (places.delete(id)) save();
    },
    clear() {
      places.clear();
      save();
    },
    ids: () => [...places.keys()],
  };
}
