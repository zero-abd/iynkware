/**
 * The loose parts a person can hold apart from their item, pure so it is tested without a scene:
 *
 *   bob      the pendulum's bob is held on its own grab box (the stand stays put). Where the hand holds it, seen from
 *            the pivot, is the angle the string makes; let go, the stand's `release` swings it from that angle.
 *   spatula  a whole item, carried like any other; while it is held, its blade dipped into a dish of a solid or an
 *            element jar takes a scoop, and held over a beaker or flask with a scoop on it tips it in.
 *
 * Frames: item frame metres (x right, y up, z out of the front) for the bob; table frame metres for the spatula, with
 * item poses in millimetres and degrees about up (the lab store's `Pose`).
 */
import { ELEMENT_KIND } from '../model/items/element';
import { MAX_RELEASE } from '../model/items/physics';
import { SUBSTANCE_KIND } from '../model/items/substance';
import type { Prim } from '../model/types';
import { SUBSTANCES } from '../substances/data';

export type V3 = { x: number; y: number; z: number };

/** The pendulum's pivot in the stand's frame (the primitive and the figure hang the string here). */
export const PIVOT = { x: 0.062, y: 0.553, z: 0 } as const;
const DEG = Math.PI / 180;

/** Where the bob is, item frame, for a string `lengthMm` long at `deg` (the swing turns about x). Writes `out`. */
export function bobPoint(lengthMm: number, deg: number, out: V3): V3 {
  const L = lengthMm / 1000;
  out.x = PIVOT.x;
  out.y = PIVOT.y - L * Math.cos(deg * DEG);
  out.z = PIVOT.z - L * Math.sin(deg * DEG);
  return out;
}

/** The string's angle, degrees, for the bob held at `p` (item frame), within the stand's release range. */
export function pullAngle(p: V3): number {
  const deg = Math.atan2(-(p.z - PIVOT.z), -(p.y - PIVOT.y)) / DEG;
  return Math.max(-MAX_RELEASE, Math.min(MAX_RELEASE, deg));
}

/** A ray press that moved the bob less than this, degrees, was a press: it starts or stops the swing as before. */
export const PRESS_DEG = 2;

/** The spatula blade's tip, in the spatula's item frame. */
export const SPATULA_TIP = { x: 0.07, y: 0.008, z: 0 } as const;

export interface BenchThing {
  readonly id: string;
  readonly kind: string;
  readonly pose: { readonly x: number; readonly z: number; readonly yaw: number; readonly y?: number };
  readonly state: { readonly p: Readonly<Record<string, Prim>> };
}

/** A model's foot, millimetres: width (x), depth (z), height. */
export type FootOf = (kind: string) => readonly [number, number, number];

export type SpatulaMove = { readonly type: 'scoop'; readonly id: string; readonly what: string } | { readonly type: 'tip'; readonly id: string };

/** How far above a source's top the blade still takes a scoop, and above a vessel's mouth it still tips in, metres. */
const DIP = 0.01;
const OVER = 0.06;
const VESSELS = ['beaker-250', 'erlenmeyer-250'];

/** What a source gives a spatula: a solid substance's id or an element's symbol; null for anything else. */
export function scoopOf(t: BenchThing): string | null {
  if (t.kind === ELEMENT_KIND) return typeof t.state.p.symbol === 'string' ? t.state.p.symbol : null;
  if (t.kind !== SUBSTANCE_KIND) return null;
  const s = SUBSTANCES.find((x) => x.id === t.state.p.substance);
  return s && s.state === 'solid' ? s.id : null;
}

/** Whether `tip` (table frame) is over `t`'s foot and no higher than `above` over its top. */
function over(t: BenchThing, foot: readonly [number, number, number], tip: V3, above: number): boolean {
  const c = Math.cos(t.pose.yaw * DEG);
  const s = Math.sin(t.pose.yaw * DEG);
  const dx = tip.x - t.pose.x / 1000;
  const dz = tip.z - t.pose.z / 1000;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const [w, d, h] = foot;
  const base = (t.pose.y ?? 0) / 1000;
  return Math.abs(lx) <= w / 2000 && Math.abs(lz) <= d / 2000 && tip.y >= base - 0.02 && tip.y <= base + h / 1000 + above;
}

/** What the held spatula's blade at `tip` does now: an empty one scoops from a source, a loaded one tips into a vessel. */
export function spatulaMove(tip: V3, load: string, things: readonly BenchThing[], footOf: FootOf): SpatulaMove | null {
  for (const t of things) {
    if (!load) {
      const what = scoopOf(t);
      if (what && over(t, footOf(t.kind), tip, DIP)) return { type: 'scoop', id: t.id, what };
    } else if (VESSELS.includes(t.kind) && over(t, footOf(t.kind), tip, OVER)) return { type: 'tip', id: t.id };
  }
  return null;
}
