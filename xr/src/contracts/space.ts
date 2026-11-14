/**
 * The bench: where the document's 2D layout becomes 3D, and the one place that converts between the document's
 * millimetres and the world. Every pillar that needs "where is pin D13" asks here. Contract file: changes only in its
 * own PR (label `contract-change`).
 *
 * Implementation: `xr/src/bench/space.ts` (`createBenchSpace`).
 *
 * Frames:
 *   document  the breadboard view of the project: placements `x_mm`, `y_mm`, top left origin, y toward the person
 *   board     `root`'s local frame, metres, real size: x = x_mm / 1000, z = y_mm / 1000, y up from the bench top
 *   world     the IWSDK scene, metres; `root` sits on the bench and is scaled by `scale`
 */
import type { Object3D } from '@iwsdk/core';
import type { ReadonlyValue, Unsubscribe, Vec3 } from './common';

/** A thing on the board that can be pointed at, highlighted or measured. */
export type BoardTarget =
  | { kind: 'part'; part: string }
  | { kind: 'pin'; part: string; pin: string }
  | { kind: 'hole'; surface: string; hole: string }
  | { kind: 'anchor'; part: string; anchor: string }
  | { kind: 'wire'; wire: string };

export interface BenchSpace {
  /** Holds every placed part; children are in the board frame. */
  readonly root: Object3D;
  /**
   * The bench itself, not scaled with the board: controls, panels and tools that sit on the bench go here, in metres,
   * origin at the bench top centre, +z toward the person.
   */
  readonly table: Object3D;
  /** World units per board metre. 1 is real size; the bench default is 3 so a hand can reach a 2.54 mm hole. */
  readonly scale: ReadonlyValue<number>;
  setScale(scale: number, opts?: { animateMs?: number }): void;
  /** World pose of the bench top centre, where `root` is anchored (a table in the room in MR). */
  readonly benchTop: ReadonlyValue<{ position: Vec3; yawRad: number }>;
  setBenchTop(pose: { position: Vec3; yawRad: number }): void;

  /** Board frame position of a document point. */
  docToBoard(xMm: number, yMm: number, heightMm?: number): Vec3;
  boardToDoc(p: Vec3): { xMm: number; yMm: number; heightMm: number };
  /** World position of a target, or null when it is not on the bench. */
  worldOf(target: BoardTarget): Vec3 | null;
  /**
   * The drawn path of a wire in the board frame, from its `from` end to its `to` end, bends and arches included, as
   * the bench draws it now. Null when the wire is not on the bench. Rebuilt with the layout (`onLayout`).
   */
  wirePath(wire: string): readonly Vec3[] | null;
  /** The placed object of a part, or undefined. */
  objectOf(partId: string): Object3D | undefined;
  /** The part id an object belongs to (walks up the parents), for ray hits. */
  partOf(object: Object3D): string | undefined;

  /** Rebuilt after every layout change (placements, legs, wires). */
  onLayout(fn: () => void): Unsubscribe;
}
