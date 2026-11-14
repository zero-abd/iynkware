/**
 * Unified input: one set of interaction events whether the person uses controllers or hands. Every feature binds to
 * these events, never to raw buttons or joints, so nothing is hand only or controller only. Contract file: changes
 * only in its own PR (label `contract-change`).
 *
 * Implementation: `xr/src/input/service.ts` (`createInputService`), over IWSDK's pointers (`RayInteractable`,
 * `PokeInteractable`, grab components) and `@pmndrs/pointer-events`.
 *
 * Mapping (docs/XR_ARCHITECTURE.md, "Input"):
 *   select   controller trigger on a ray, or hand pinch on a ray, or a fingertip poke, or a mouse click (desktop)
 *   grab     controller grip near the object, or hand pinch near it (a pinch that starts within reach)
 *   drag     a held select or grab that moves; carries the pointer pose every frame
 *   sticks   controller thumbsticks; hands get a virtual stick (pinch and move) from the same call
 */
import type { Object3D } from '@iwsdk/core';
import type { ReadonlyValue, Unsubscribe, Vec3 } from './common';

export type Hand = 'left' | 'right';
export type PointerSource = 'controller' | 'hand' | 'mouse' | 'gaze';
/** How the pointer reached the target: along a ray, by touching it (poke), or by holding it (grab). */
export type PointerMode = 'ray' | 'poke' | 'grab';

export interface XrPointer {
  /** Stable for one physical pointer while it is tracked. */
  readonly id: number;
  readonly hand: Hand | null;
  readonly source: PointerSource;
  readonly mode: PointerMode;
  /** World pose of the pointer: ray origin, or fingertip, or grip centre. */
  readonly origin: Vec3;
  /** Unit vector along the ray (forward of the grip for grabs). */
  readonly direction: Vec3;
}

export type InteractionType =
  | 'hover-start'
  | 'hover-end'
  | 'select-start'
  | 'select-end'
  /** A completed select (start and end on the same target): the "click". */
  | 'select'
  | 'grab-start'
  | 'grab-move'
  | 'grab-end'
  | 'drag-move';

export interface InteractionEvent {
  readonly type: InteractionType;
  readonly pointer: XrPointer;
  /** The id given to `bind`. */
  readonly target: string;
  /** World hit point, when the pointer has one. */
  readonly point?: Vec3;
  /** For instanced meshes (breadboard holes, header pins): which instance was hit. */
  readonly instance?: number;
}

export interface BindOptions {
  /** Reported as `InteractionEvent.target`. Usually an entity id (`cmp_led1`) or a control id (`run`). */
  id: string;
  /** Rays (controller and hand) may select it. Default true. */
  ray?: boolean;
  /** Fingertips may poke it. Default false; turn on for buttons within reach. */
  poke?: boolean;
  /** It can be picked up: `near` (grip or pinch within reach), `distance` (ray grab), or both. Default none. */
  grab?: 'none' | 'near' | 'distance' | 'both';
}

export interface InputService {
  /** Makes an object interactable and routes its events to `handler`. Returns the unbind. */
  bind(object: Object3D, opts: BindOptions, handler: (e: InteractionEvent) => void): Unsubscribe;
  /** What each hand is using now; null when untracked. Features may adapt affordances, never gate features on it. */
  readonly sources: ReadonlyValue<Readonly<Record<Hand, PointerSource | null>>>;
  /** Thumbstick (controller) or virtual stick (hand pinch and move), each axis -1..1. */
  stick(hand: Hand): { x: number; y: number };
  /** A short buzz on a controller; a no-op on hands. */
  pulse(hand: Hand, intensity: number, ms: number): void;
  /** Every event on any bound object, after its own handler (for tutorials, analytics, the AI partner seam). */
  onAny(fn: (e: InteractionEvent) => void): Unsubscribe;
}
