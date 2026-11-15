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
 *   buttons  controller A/X, B/Y and thumbstick click through `button`; hands report none
 *   free     a pinch or grip that began on no bound target, through `freeHold` (the virtual stick still runs)
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

/** What a bound object is, for target priority (XR_DESIGN 3.1): the higher kind wins under one pointer. */
export type TargetKind = 'cell' | 'control' | 'wire-end' | 'body' | 'edge' | 'panel';

/** `pointerEventsOrder` per kind: cell 5, control 4, wire-end 3, body 2, edge 1, panel 0. */
export const TARGET_ORDER: Readonly<Record<TargetKind, number>> = {
  cell: 5,
  control: 4,
  'wire-end': 3,
  body: 2,
  edge: 1,
  panel: 0,
};

export interface BindOptions {
  /** Reported as `InteractionEvent.target`. Usually an entity id (`cmp_led1`) or a control id (`run`). */
  id: string;
  /** Rays (controller and hand) may select it. Default true. */
  ray?: boolean;
  /** Fingertips may poke it. Default false; turn on for buttons within reach. */
  poke?: boolean;
  /** It can be picked up: `near` (grip or pinch within reach), `distance` (ray grab), or both. Default none. */
  grab?: 'none' | 'near' | 'distance' | 'both';
  /**
   * Sets the object's `pointerEventsOrder` from `TARGET_ORDER`, so under one pointer (ray, poke or the grab sphere)
   * the higher kind wins over a nearer lower one. Unset: the object's own order is left alone.
   */
  kind?: TargetKind;
  /**
   * A near press (hand pinch or controller grip or trigger at the object, within reach) selects instead of grabbing:
   * `select-start`, `drag-move` while held (pointer pose at the pinch point or grip), `select-end`, then `select` when
   * it ends on the same target. The object never moves, and the grab sphere can hit it without `grab: 'near'` (which
   * `nearSelect` overrides). Rays keep their behaviour: `ray` selects, `grab: 'distance'` still grabs. Default false.
   */
  nearSelect?: boolean;
}

/**
 * Where a hand or controller is this frame, whether or not it touches anything bound (sensor gestures, probe tips,
 * the hover ring under a pinch or ray, the palm menu). World frame, metres.
 */
export interface HandPose {
  /** `hand` or `controller`. */
  readonly source: PointerSource;
  /** Pinch point (hands: the index tip) or grip centre (controllers). */
  readonly position: Vec3;
  /** Palm normal, out of the palm (hands), or grip forward (controllers). Unit. */
  readonly normal: Vec3;
  /** Pinching (hands) or the trigger held (controllers). */
  readonly pinching: boolean;
  /** Hands: index, middle, ring and little fingers stretched out (a flat or open hand). Always false for controllers. */
  readonly open: boolean;
  /** The target ray: the controller's, or the hand's aim ray. `direction` is unit. */
  readonly ray: { readonly origin: Vec3; readonly direction: Vec3 };
}

/** A controller's face buttons: `lower` is A (right) or X (left), `upper` is B or Y, `stick` the thumbstick click. */
export type FaceButton = 'lower' | 'upper' | 'stick';

/** One button this frame. `down` and `up` are true only on the frame the press began or ended. */
export interface ButtonState {
  readonly pressed: boolean;
  readonly down: boolean;
  readonly up: boolean;
}

/**
 * A pinch (hand) or grip (controller) that began on no bound target: the two handed scale gesture, the flight gimbal
 * ring and the guide flight read it. World frame, metres.
 */
export interface FreeHold {
  /** `pinch` for a hand, `grip` for a controller's squeeze. */
  readonly by: 'pinch' | 'grip';
  /** Where the hold began: the pinch point or the grip centre on its first frame. */
  readonly start: Vec3;
  /** Where it is now. */
  readonly position: Vec3;
  /** Milliseconds since it began. */
  readonly sinceMs: number;
}

export interface InputService {
  /**
   * The current pose of each hand or controller, or null when it is untracked (and on the flat page). Updated once a
   * frame before feature systems run; the same object is returned on every call for a hand, so read it, do not keep it.
   */
  pose(hand: Hand): HandPose | null;
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
  /** A controller button this frame; all false for a hand, an untracked controller and the flat page. Same object per hand and button. */
  button(hand: Hand, which: FaceButton): ButtonState;
  /**
   * The hold of this hand that began on no bound target, or null (none, or it began on a bound object). Reported while
   * held, alongside the virtual stick, which keeps working. The same object is returned per hand: read it, do not keep it.
   */
  freeHold(hand: Hand): FreeHold | null;
}
