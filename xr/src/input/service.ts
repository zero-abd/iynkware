/**
 * The input service (`xr/src/contracts/input.ts`) over IWSDK 1.1.0's pointers.
 *
 * IWSDK gives every hand a `MultiPointer` (`world.input.xr.multiPointers[hand]`) with three `@pmndrs/pointer-events`
 * sub-pointers: `ray` (controller trigger or hand pinch along the target ray), `grab` (a sphere at the grip, pressed
 * by the squeeze button, or by a hand pinch that `GrabSystem` routes to it) and `touch` (a sphere at the index tip,
 * pressed by contact). The canvas forwards the mouse as one more pointer (`screen-mouse`). All of them dispatch
 * pointerenter, pointerleave, pointerdown, pointermove, pointerup and pointercancel on the hit Object3D, so a binding is
 * listeners on the bound object plus the IWSDK tags that put it in each pointer's target list:
 *
 *   ray: true        RayInteractable    ray and mouse can hit it
 *   poke: true       PokeInteractable   the fingertip can touch it
 *   grab: near       OneHandGrabbable   the grab sphere can hit it, GrabSystem's handle moves it
 *   grab: distance   DistanceGrabbable  (MoveFromTarget) a ray press moves it
 *   nearSelect       OneHandGrabbable   only so the grab sphere can hit it; the gate turns its presses into selects
 *
 * A press is a grab or a select, never both: grab-sub-pointer presses grab a `near` object, ray presses (and the mouse)
 * grab a `distance` object, everything else selects. IWSDK's grab handle takes every press that reaches its object,
 * so for a grabbable binding a first listener on the object stops the presses that must stay selects before the handle
 * sees them.
 *
 * Source: the event's pointerId is matched against the six multi-pointer sub-pointers (which hand, which kind) and the
 * gaze pointer; on a hand side, `input.xr.isPrimary('hand', side)` decides hand versus controller. Anything else is the
 * canvas pointer, reported as `mouse`.
 */
import {
  DistanceGrabbable,
  GrabSystem,
  InputComponent,
  InputSystem,
  LevelRoot,
  LevelTag,
  MovementMode,
  OneHandGrabbable,
  PokeInteractable,
  Raycaster,
  RayInteractable,
  TwoHandsGrabbable,
  Vector3,
  createSystem,
  signal,
} from '@iwsdk/core';
import type { Entity, Intersection, Object3D, Quaternion, World } from '@iwsdk/core';
import type { Unsubscribe } from '../contracts/common';
import type {
  BindOptions,
  ButtonState,
  FaceButton,
  FreeHold,
  Hand,
  HandPose,
  InputService,
  InteractionEvent,
  InteractionType,
  PointerMode,
  PointerSource,
} from '../contracts/input';
import {
  type GrabFlags,
  type Heading,
  type HoldState,
  type MutableButton,
  type PointerKind,
  type Stick,
  POSE_JOINTS,
  clampUnit,
  effectiveGrab,
  fingersOpen,
  grabFlags,
  headingOf,
  isGrabPress,
  isNearSelectPress,
  modeOf,
  newHoldState,
  orderOfKind,
  palmNormal,
  sourceOf,
  stepButton,
  stepHold,
  virtualStick,
} from './helpers';

/** After InputSystem (-4, pointer events), CanvasPointerSystem (-3.5) and GrabSystem (-3, pinch to grab, handles). */
const SYSTEM_PRIORITY = -2.5;
const HANDS: readonly Hand[] = ['left', 'right'];
const SUB_POINTERS = ['ray', 'grab', 'touch'] as const;
/** A held pointer has to move this much (metres, or cosine of the turn) before the next drag-move or grab-move. */
const MOVE_EPS_M = 0.0005;
const MOVE_EPS_COS = Math.cos((0.1 * Math.PI) / 180);

// The parts of `@pmndrs/pointer-events` this file reads. `@iwsdk/core` types `entity.object3D` with these events but
// does not re-export the package, and xr/ does not depend on it directly, so the shapes are written out here.
interface PEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly point: Vector3;
  readonly instanceId: number | undefined;
  readonly pointerPosition: Vector3;
  readonly pointerQuaternion: Quaternion;
  readonly details: { readonly type: string; readonly direction?: Vector3 };
  stopPropagation(): void;
  stopImmediatePropagation(): void;
}
type PListener = (e: PEvent) => void;
interface PTarget {
  addEventListener(type: string, fn: PListener): void;
  removeEventListener(type: string, fn: PListener): void;
}
interface PPointer {
  getEnabled(): boolean;
  getPointerCapture(): { object: Object3D } | undefined;
}
/** `@pmndrs/handle`'s HandleStore listeners, which IWSDK 1.1.0 never unbinds when a grabbable is removed. */
interface HandleListeners {
  handlers?: {
    onPointerDown?: PListener;
    onPointerMove?: PListener;
    onPointerEnd?: PListener;
  };
}

type MVec3 = [number, number, number];
interface MPointer {
  id: number;
  hand: Hand | null;
  source: PointerSource;
  mode: PointerMode;
  origin: MVec3;
  direction: MVec3;
}
interface MEvent {
  type: InteractionType;
  pointer: MPointer;
  target: string;
  point?: MVec3;
  instance?: number;
}

interface Press {
  readonly pointerId: number;
  readonly grab: boolean;
  readonly button: number;
  readonly hand: Hand | null;
  readonly source: PointerSource;
  /** A pointer capture holds this press: ours for ray and mouse selects, the grab handle's for grabs. */
  readonly captured: boolean;
  readonly instance: number | undefined;
  /** Reused by this press's move events. */
  readonly pointer: MPointer;
  readonly point: MVec3;
  readonly grabMove: MEvent;
  readonly dragMove: MEvent;
  readonly lastOrigin: MVec3;
  readonly lastDirection: MVec3;
}

interface Binding {
  readonly id: string;
  readonly object: Object3D;
  readonly entity: Entity;
  readonly flags: GrabFlags;
  readonly hasGrab: boolean;
  readonly nearSelect: boolean;
  readonly handler: (e: InteractionEvent) => void;
  readonly hovered: Set<number>;
  readonly presses: Map<number, Press>;
  unbind: Unsubscribe;
}

interface PointerInfo {
  kind: PointerKind;
  hand: Hand | null;
  source: PointerSource;
}

interface PinchState extends Heading {
  active: boolean;
  /** The pinch began as (or became) a press on a bound object, so it is not a stick. */
  consumed: boolean;
  sx: number;
  sz: number;
}

const on = (o: Object3D, type: string, fn: PListener) => (o as unknown as PTarget).addEventListener(type, fn);
const off = (o: Object3D, type: string, fn: PListener) => (o as unknown as PTarget).removeEventListener(type, fn);
const noop = () => {};

/**
 * Creates the input service and registers its per-frame system on `world`. Create one per world, after
 * `World.create`. Grabs need `features.grabbing` (IWSDK's GrabSystem); hand pinch grabs need its
 * `useHandPinchForGrab` (on by default).
 *
 * Move events (`drag-move`, `grab-move`) reuse one event object per press, and `stick()` reuses one object per hand,
 * so per-frame input allocates nothing here. Copy what you keep.
 */
export interface InputServiceOptions {
  /** Read on every `pulse`: false silences controller haptics (`XrSettings.haptics`). Default: always on. */
  readonly haptics?: () => boolean;
}

export function createInputService(world: World, opts: InputServiceOptions = {}): InputService {
  const xr = world.input.xr;
  const player = world.player;

  // Pointers outside XR come from the canvas; keep the scene's target lists so the mouse only hits bound objects.
  const inputSystem = world.getSystem(InputSystem);
  if (inputSystem) inputSystem.config.maintainScenePointers.value = true;

  // Which pmndrs pointer is which: the six sub-pointers are created once per world and keep their ids.
  const slots = new Map<number, { readonly hand: Hand; readonly kind: PointerKind }>();
  const xrPointers = new Map<number, PPointer>();
  for (const hand of HANDS) {
    for (const kind of SUB_POINTERS) {
      const p = xr.multiPointers[hand].getPointer(kind);
      slots.set(p.id, { hand, kind });
      xrPointers.set(p.id, p);
    }
  }
  const gaze = xr.gazePointer;
  const gazeId = gaze.pointer.id;
  xrPointers.set(gazeId, gaze.pointer);

  const pointerById = (id: number): PPointer | undefined =>
    xrPointers.get(id) ??
    (globalThis as { pointerEventspointerMap?: Map<number, PPointer> }).pointerEventspointerMap?.get(id);

  const info: PointerInfo = { kind: 'mouse', hand: null, source: 'mouse' };
  const resolve = (e: PEvent): PointerInfo => {
    const slot = slots.get(e.pointerId);
    if (slot) {
      info.kind = slot.kind;
      info.hand = slot.hand;
      info.source = sourceOf(slot.kind, xr.isPrimary('hand', slot.hand));
    } else if (e.pointerId === gazeId) {
      info.kind = 'gaze';
      info.hand = gaze.getHeldByHand();
      info.source = 'gaze';
    } else {
      info.kind = 'mouse';
      info.hand = null;
      info.source = 'mouse';
    }
    return info;
  };

  // ---- events ----------------------------------------------------------------------------------------------------

  const anyFns = new Set<(e: InteractionEvent) => void>();
  let anyEvent: InteractionEvent | null = null;
  const callAny = (fn: (e: InteractionEvent) => void) => {
    try {
      fn(anyEvent!);
    } catch (err) {
      console.error('[input] onAny listener threw', err);
    }
  };
  const emit = (b: Binding, ev: InteractionEvent) => {
    try {
      b.handler(ev);
    } catch (err) {
      console.error(`[input] handler for "${b.id}" threw on ${ev.type}`, err);
    }
    if (anyFns.size === 0) return;
    const outer = anyEvent;
    anyEvent = ev;
    anyFns.forEach(callAny);
    anyEvent = outer;
  };

  const tmpDir = new Vector3();
  const fillPose = (e: PEvent, origin: MVec3, direction: MVec3) => {
    const p = e.pointerPosition;
    origin[0] = p.x;
    origin[1] = p.y;
    origin[2] = p.z;
    const d = e.details.type === 'screen-ray' && e.details.direction ? e.details.direction : null;
    if (d) tmpDir.copy(d);
    else tmpDir.set(0, 0, -1).applyQuaternion(e.pointerQuaternion);
    tmpDir.normalize();
    direction[0] = tmpDir.x;
    direction[1] = tmpDir.y;
    direction[2] = tmpDir.z;
  };
  const newPointer = (e: PEvent, i: PointerInfo): MPointer => {
    const p: MPointer = {
      id: e.pointerId,
      hand: i.hand,
      source: i.source,
      mode: modeOf(i.kind),
      origin: [0, 0, 0],
      direction: [0, 0, -1],
    };
    fillPose(e, p.origin, p.direction);
    return p;
  };
  const copyPointer = (p: MPointer): MPointer => ({
    ...p,
    origin: [p.origin[0], p.origin[1], p.origin[2]],
    direction: [p.direction[0], p.direction[1], p.direction[2]],
  });
  const makeEvent = (type: InteractionType, b: Binding, pointer: MPointer, e: PEvent | null, instance?: number) => {
    const ev: MEvent = { type, pointer, target: b.id };
    if (e) {
      const p = e.point;
      if (p) ev.point = [p.x, p.y, p.z];
      const inst = instance ?? e.instanceId;
      if (inst !== undefined) ev.instance = inst;
    } else if (instance !== undefined) {
      ev.instance = instance;
    }
    return ev;
  };

  // ---- presses ---------------------------------------------------------------------------------------------------

  /** Bindings with a press in flight, so the frame only looks at those. */
  const pressing = new Set<Binding>();
  /** Presses in flight from a tracked hand (not a controller), per side: those pinches are not a virtual stick. */
  const handPresses: Record<Hand, number> = { left: 0, right: 0 };
  /** Grabs in flight per side, from a hand or a controller. */
  const grabPresses: Record<Hand, number> = { left: 0, right: 0 };
  /** Presses in flight from a tracked hand or controller (select or grab), per side: a hold they cover is not free. */
  const sidePresses: Record<Hand, number> = { left: 0, right: 0 };
  const fromSide = (press: Press) => press.hand !== null && (press.source === 'hand' || press.source === 'controller');

  const capturedWithin = (pointerId: number, root: Object3D): boolean => {
    let o: Object3D | null = pointerById(pointerId)?.getPointerCapture()?.object ?? null;
    while (o) {
      if (o === root) return true;
      o = o.parent;
    }
    return false;
  };

  const raycaster = new Raycaster();
  raycaster.camera = world.camera;
  const hits: Intersection[] = [];
  const visibleWithin = (o: Object3D | null, root: Object3D): boolean => {
    while (o) {
      if (!o.visible) return false;
      if (o === root) return true;
      o = o.parent;
    }
    return false;
  };
  /** Whether a captured ray still points at the bound object (and the same instance) when the press ends. */
  const rayStillOn = (b: Binding, press: Press): boolean => {
    const { origin, direction } = press.pointer;
    raycaster.ray.origin.set(origin[0], origin[1], origin[2]);
    raycaster.ray.direction.set(direction[0], direction[1], direction[2]);
    hits.length = 0;
    raycaster.intersectObject(b.object, true, hits);
    let over = false;
    for (const h of hits) {
      if (press.instance !== undefined && h.instanceId !== press.instance) continue;
      if (visibleWithin(h.object, b.object)) {
        over = true;
        break;
      }
    }
    hits.length = 0;
    return over;
  };

  const startPress = (b: Binding, e: PEvent, i: PointerInfo, grab: boolean) => {
    if (b.presses.has(e.pointerId)) return;
    const pointer = newPointer(e, i);
    let captured = grab;
    if (!grab && (i.kind === 'ray' || i.kind === 'gaze' || i.kind === 'mouse' || isNearSelectPress(i.kind, b.nearSelect))) {
      // Keep the ray on this object while held: drags report off the object, and the release comes back here.
      b.object.setPointerCapture(e.pointerId);
      captured = true;
    }
    const point: MVec3 = [e.point.x, e.point.y, e.point.z];
    const moveEvent = (type: InteractionType): MEvent => {
      const ev: MEvent = { type, pointer, target: b.id, point };
      if (e.instanceId !== undefined) ev.instance = e.instanceId;
      return ev;
    };
    const press: Press = {
      pointerId: e.pointerId,
      grab,
      button: e.button,
      hand: i.hand,
      source: i.source,
      captured,
      instance: e.instanceId,
      pointer,
      point,
      grabMove: moveEvent('grab-move'),
      dragMove: moveEvent('drag-move'),
      lastOrigin: [pointer.origin[0], pointer.origin[1], pointer.origin[2]],
      lastDirection: [pointer.direction[0], pointer.direction[1], pointer.direction[2]],
    };
    b.presses.set(e.pointerId, press);
    pressing.add(b);
    if (press.source === 'hand' && press.hand) handPresses[press.hand]++;
    if (press.grab && press.hand) grabPresses[press.hand]++;
    if (press.hand && fromSide(press)) sidePresses[press.hand]++;
    emit(b, makeEvent(grab ? 'grab-start' : 'select-start', b, copyPointer(pointer), e));
  };

  const forgetPress = (b: Binding, press: Press) => {
    b.presses.delete(press.pointerId);
    if (b.presses.size === 0) pressing.delete(b);
    if (press.source === 'hand' && press.hand) handPresses[press.hand] = Math.max(0, handPresses[press.hand] - 1);
    if (press.grab && press.hand) grabPresses[press.hand] = Math.max(0, grabPresses[press.hand] - 1);
    if (press.hand && fromSide(press)) sidePresses[press.hand] = Math.max(0, sidePresses[press.hand] - 1);
  };

  /** `e` is the pointerup (completed), the pointercancel or pointerleave, or null when the capture vanished. */
  const endPress = (b: Binding, press: Press, e: PEvent | null, completed: boolean) => {
    forgetPress(b, press);
    if (!press.grab && press.captured && b.object.hasPointerCapture(press.pointerId)) {
      b.object.releasePointerCapture(press.pointerId);
    }
    const pointer = copyPointer(press.pointer);
    if (press.grab) {
      emit(b, makeEvent('grab-end', b, pointer, e, press.instance));
      return;
    }
    emit(b, makeEvent('select-end', b, pointer, e, press.instance));
    if (!completed) return;
    const over = press.captured
      ? rayStillOn(b, press)
      : press.instance === undefined || e?.instanceId === press.instance;
    if (over) emit(b, makeEvent('select', b, copyPointer(press.pointer), e, press.instance));
  };

  const moved = (press: Press): boolean => {
    const o = press.pointer.origin;
    const d = press.pointer.direction;
    const lo = press.lastOrigin;
    const ld = press.lastDirection;
    const dx = o[0] - lo[0];
    const dy = o[1] - lo[1];
    const dz = o[2] - lo[2];
    const far = dx * dx + dy * dy + dz * dz > MOVE_EPS_M * MOVE_EPS_M;
    const turned = d[0] * ld[0] + d[1] * ld[1] + d[2] * ld[2] < MOVE_EPS_COS;
    if (!far && !turned) return false;
    lo[0] = o[0];
    lo[1] = o[1];
    lo[2] = o[2];
    ld[0] = d[0];
    ld[1] = d[1];
    ld[2] = d[2];
    return true;
  };

  // ---- entities --------------------------------------------------------------------------------------------------

  /** Entities this service made, for objects created without a Transform (where `entityIdx` is not set). */
  const created = new WeakMap<Object3D, Entity>();
  const entityOf = (o: Object3D): Entity | undefined => {
    const idx = (o as Object3D & { entityIdx?: number }).entityIdx;
    if (idx !== undefined) {
      const e = world.entityManager.getEntityByIndex(idx);
      if (e && e.active && e.object3D === o) return e;
    }
    const c = created.get(o);
    return c && c.active && c.object3D === o ? c : undefined;
  };
  /**
   * The entity for `o`, made if missing. IWSDK keeps an entity's Object3D directly under its parent entity's Object3D
   * (TransformSystem re-adds it there), so plain ancestors between `o` and the nearest entity get entities too, which
   * leaves the hierarchy where it was. Entities are never destroyed here: that would take the object out of the scene.
   */
  const ensureEntity = (o: Object3D): Entity => {
    const found = entityOf(o);
    if (found) return found;
    if (o === world.scene) return world.sceneEntity;
    const parent = o.parent;
    const parentEntity = parent ? (parent === world.scene ? world.sceneEntity : ensureEntity(parent)) : undefined;
    const e = parentEntity
      ? world.createTransformEntity(o, {
          parent: parentEntity,
          persistent: !(parentEntity.hasComponent(LevelTag) || parentEntity.hasComponent(LevelRoot)),
        })
      : world.createTransformEntity(o);
    created.set(o, e);
    return e;
  };

  // ---- bind ------------------------------------------------------------------------------------------------------

  const bindings = new WeakMap<Object3D, Binding>();
  let warnedNoGrab = false;

  const bind = (object: Object3D, opts: BindOptions, handler: (e: InteractionEvent) => void): Unsubscribe => {
    const previous = bindings.get(object);
    if (previous) {
      console.warn(`[input] "${opts.id}" rebinds an object already bound as "${previous.id}"; the old binding is removed`);
      previous.unbind();
    }
    const ray = opts.ray ?? true;
    const poke = opts.poke ?? false;
    const nearSelect = opts.nearSelect ?? false;
    const flags = grabFlags(effectiveGrab(opts.grab, nearSelect));
    const hasGrab = flags.near || flags.distance;
    // nearSelect needs OneHandGrabbable (the grab sphere only hits grabbables) and the gate, but never a grab.
    const usesHandle = hasGrab || nearSelect;
    const order = orderOfKind(opts.kind);
    const prevOrder = object.pointerEventsOrder;
    if (order !== undefined) object.pointerEventsOrder = order;
    if (hasGrab && !world.getSystem(GrabSystem) && !warnedNoGrab) {
      warnedNoGrab = true;
      console.warn('[input] grab needs IWSDK grabbing (World.create features.grabbing); grabs will not start');
    }
    const entity = ensureEntity(object);
    const b: Binding = {
      id: opts.id,
      object,
      entity,
      flags,
      hasGrab,
      nearSelect,
      handler,
      hovered: new Set(),
      presses: new Map(),
      unbind: noop,
    };

    // Before any grab handle exists on the object: stop the presses that are selects, so the handle does not move it.
    const gate: PListener = (e) => {
      const i = resolve(e);
      if (i.kind === 'mouse' && e.button !== 0) {
        e.stopImmediatePropagation();
        return;
      }
      if (isGrabPress(i.kind, flags)) return;
      e.stopImmediatePropagation();
      e.stopPropagation();
      startPress(b, e, i, false);
    };
    const handleBefore = entity.getComponents().some((c) => c.id === 'Handle');
    if (usesHandle) {
      if (handleBefore) console.warn(`[input] "${opts.id}" was grabbable before bind; ray and poke presses may also grab it`);
      on(object, 'pointerdown', gate);
    }

    const prevPointerEventsType = object.pointerEventsType;
    const added: Array<Parameters<Entity['removeComponent']>[0]> = [];
    const add = (c: Parameters<Entity['removeComponent']>[0], data?: Record<string, unknown>) => {
      if (entity.hasComponent(c)) return;
      entity.addComponent(c, data as never);
      added.push(c);
    };
    if (ray) add(RayInteractable);
    if (poke) add(PokeInteractable);
    // DistanceGrabbable first: the first grab component decides the handle, and a distance handle in MoveFromTarget
    // moves with any one pointer, so `both` can share it with the near grab sphere.
    if (flags.distance) add(DistanceGrabbable, { movementMode: MovementMode.MoveFromTarget });
    if (flags.near || nearSelect) add(OneHandGrabbable);
    // GrabSystem hides a near grabbable from rays ({ deny: 'ray' }) and a distance one from the grab sphere
    // ({ deny: 'grab' }). Open it up where the binding asks for both.
    let overrodeType = false;
    if ((flags.near || nearSelect) && (ray || flags.distance)) {
      object.pointerEventsType = 'all';
      overrodeType = true;
    }

    const down: PListener = (e) => {
      const i = resolve(e);
      if (i.kind === 'mouse' && e.button !== 0) return;
      const grab = hasGrab && isGrabPress(i.kind, flags);
      // A grab press the handle did not take (it already holds the object with another pointer) is nothing.
      if (grab && !capturedWithin(e.pointerId, object)) return;
      e.stopPropagation();
      startPress(b, e, i, grab);
    };
    const up: PListener = (e) => {
      const press = b.presses.get(e.pointerId);
      if (!press || e.button !== press.button) return;
      e.stopPropagation();
      fillPose(e, press.pointer.origin, press.pointer.direction);
      endPress(b, press, e, true);
    };
    const cancel: PListener = (e) => {
      const press = b.presses.get(e.pointerId);
      if (!press) return;
      e.stopPropagation();
      endPress(b, press, e, false);
    };
    const move: PListener = (e) => {
      const press = b.presses.get(e.pointerId);
      if (!press) return;
      e.stopPropagation();
      fillPose(e, press.pointer.origin, press.pointer.direction);
      if (!moved(press)) return;
      const p = e.point;
      press.point[0] = p.x;
      press.point[1] = p.y;
      press.point[2] = p.z;
      if (press.grab) emit(b, press.grabMove);
      emit(b, press.dragMove);
    };
    const enter: PListener = (e) => {
      if (b.hovered.has(e.pointerId)) return;
      b.hovered.add(e.pointerId);
      emit(b, makeEvent('hover-start', b, newPointer(e, resolve(e)), e));
    };
    const leave: PListener = (e) => {
      // A poke can slide off without a pointerup; nothing captures it, so it ends here, unfinished.
      const press = b.presses.get(e.pointerId);
      if (press && !press.captured) endPress(b, press, e, false);
      if (!b.hovered.delete(e.pointerId)) return;
      emit(b, makeEvent('hover-end', b, newPointer(e, resolve(e)), e));
    };
    const listeners: Array<[string, PListener]> = [
      ['pointerdown', down],
      ['pointerup', up],
      ['pointercancel', cancel],
      ['pointermove', move],
      ['pointerenter', enter],
      ['pointerleave', leave],
    ];
    for (const [type, fn] of listeners) on(object, type, fn);

    let done = false;
    b.unbind = () => {
      if (done) return;
      done = true;
      if (bindings.get(object) === b) bindings.delete(object);
      if (usesHandle) off(object, 'pointerdown', gate);
      if (order !== undefined) object.pointerEventsOrder = prevOrder;
      for (const [type, fn] of listeners) off(object, type, fn);

      const grabSystem = world.getSystem(GrabSystem);
      b.presses.forEach((press) => {
        if (press.grab) grabSystem?.forceRelease(entity);
        else if (press.captured && object.hasPointerCapture(press.pointerId)) object.releasePointerCapture(press.pointerId);
        forgetPress(b, press);
      });
      b.hovered.clear();
      if (!entity.active) return;

      for (let k = added.length - 1; k >= 0; k--) entity.removeComponent(added[k]!);
      let droppedHandle = false;
      const stillGrabbable =
        entity.hasComponent(OneHandGrabbable) ||
        entity.hasComponent(TwoHandsGrabbable) ||
        entity.hasComponent(DistanceGrabbable);
      if (usesHandle && !handleBefore && !stillGrabbable) droppedHandle = dropHandle(entity, object);
      if (overrodeType || droppedHandle) object.pointerEventsType = prevPointerEventsType;
      // InputSystem keeps one listener set per object and drops it when either tag leaves; give a remaining
      // (pre-existing) tag its listeners back.
      const removedRay = added.includes(RayInteractable);
      const removedPoke = added.includes(PokeInteractable);
      if (removedRay && entity.hasComponent(PokeInteractable)) requalify(entity, PokeInteractable);
      else if (removedPoke && entity.hasComponent(RayInteractable)) requalify(entity, RayInteractable);
    };
    bindings.set(object, b);
    return b.unbind;
  };

  // ---- per frame: sources and sticks -----------------------------------------------------------------------------

  const tracked = (hand: Hand): boolean => {
    const mp = xr.multiPointers[hand];
    return mp.getPointer('ray').getEnabled() || mp.getPointer('touch').getEnabled() || mp.getPointer('grab').getEnabled();
  };
  const sourceNow = (hand: Hand): PointerSource | null => {
    if (xr.isPrimary('hand', hand)) return tracked(hand) ? 'hand' : null;
    if (xr.isPrimary('controller', hand)) return tracked(hand) ? 'controller' : null;
    return null;
  };
  const sources = signal<Readonly<Record<Hand, PointerSource | null>>>(Object.freeze({ left: null, right: null }));

  const sticks: Record<Hand, Stick> = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
  const stickViews: Record<Hand, Stick> = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
  const pinches: Record<Hand, PinchState> = {
    left: { active: false, consumed: false, sx: 0, sz: 0, fx: 0, fz: -1 },
    right: { active: false, consumed: false, sx: 0, sz: 0, fx: 0, fz: -1 },
  };

  const updateStick = (hand: Hand, source: PointerSource | null) => {
    const out = sticks[hand];
    const pinch = pinches[hand];
    if (source === 'controller') {
      pinch.active = false;
      const axes = xr.gamepads[hand]?.getAxesValues(InputComponent.Thumbstick);
      out.x = clampUnit(axes?.x ?? 0);
      out.y = clampUnit(axes?.y ?? 0);
      return;
    }
    out.x = 0;
    out.y = 0;
    if (source !== 'hand' || !xr.getSelectState(hand).active) {
      pinch.active = false;
      return;
    }
    // The pinch point is the index tip (it meets the thumb there); both it and the head are rig-local, so walking
    // or turning the rig does not move the stick.
    const tip = player.indexTipSpaces[hand].position;
    if (!pinch.active) {
      pinch.active = true;
      pinch.consumed = false;
      pinch.sx = tip.x;
      pinch.sz = tip.z;
      const q = player.head.quaternion;
      headingOf(q.x, q.y, q.z, q.w, pinch);
    }
    // A pinch that selects or grabs something is that, not a stick.
    if (handPresses[hand] > 0) pinch.consumed = true;
    if (!pinch.consumed) virtualStick(tip.x - pinch.sx, tip.z - pinch.sz, pinch, out);
  };

  const checkPress = function (this: Binding, press: Press) {
    // A capture can vanish without pointerup or pointercancel (GrabSystem.forceRelease, a session ending).
    if (press.captured && !capturedWithin(press.pointerId, this.object)) endPress(this, press, null, false);
  };
  const checkBinding = (b: Binding) => b.presses.forEach(checkPress, b);

  // ---- per frame: controller grip and fingertip arbitration ------------------------------------------------------
  //
  // IWSDK's MultiPointer ranks touch above grab above ray and feeds the squeeze button only to the winner, so a grip
  // within 15 cm of anything pokeable never reaches the grab sphere. GrabSystem already routes a hand's pinch straight
  // to the grab sphere; the grip gets the same route here, so near grabs work alike with both. And while a side holds
  // something its fingertip pointer is off: a pressing fingertip locks the MultiPointer on touch, which would freeze
  // the grab, and a held part should not poke the buttons it passes.

  const routedSqueeze: Record<Hand, boolean> = { left: false, right: false };
  const touchOff: Record<Hand, boolean> = { left: false, right: false };
  const routeEvent = { timeStamp: 0 };

  const routeGrip = (hand: Hand, source: PointerSource | null) => {
    const mp = xr.multiPointers[hand];
    const gp = source === 'controller' ? xr.gamepads[hand] : undefined;
    if (routedSqueeze[hand]) {
      if (!gp || gp.getButtonUp(InputComponent.Squeeze) || !gp.getButtonPressed(InputComponent.Squeeze)) {
        routedSqueeze[hand] = false;
        mp.routeUp('squeeze', 'grab', routeEvent);
      }
      return;
    }
    // Only where MultiPointer withholds it: touch won the hand, and the grab sphere has a target of its own.
    if (!gp || !gp.getButtonDown(InputComponent.Squeeze) || mp.getActiveKind() !== 'touch') return;
    const grab = mp.getPointer('grab');
    const hit = grab.getEnabled() ? grab.getIntersection() : undefined;
    if (!hit || (hit.object as Object3D & { isVoidObject?: boolean }).isVoidObject) return;
    routedSqueeze[hand] = true;
    mp.routeDown('squeeze', 'grab', routeEvent);
  };

  const pokeTargetsExist = () => (inputSystem ? inputSystem.queries.pokeInteractables.entities.size > 0 : true);
  const arbitrateTouch = (hand: Hand) => {
    if (grabPresses[hand] > 0) {
      if (!touchOff[hand]) {
        touchOff[hand] = true;
        xr.multiPointers[hand].toggleSubPointer('touch', false);
      }
    } else if (touchOff[hand]) {
      touchOff[hand] = false;
      if (pokeTargetsExist()) xr.multiPointers[hand].toggleSubPointer('touch', true);
    }
  };
  // InputSystem turns both fingertips back on whenever a pokeable appears; keep a holding side's off.
  inputSystem?.queries.pokeInteractables.subscribe('qualify', () => {
    for (const hand of HANDS) if (touchOff[hand]) xr.multiPointers[hand].toggleSubPointer('touch', false);
  });

  // ---- per frame: poses -------------------------------------------------------------------------------------------

  interface MPose {
    source: PointerSource;
    position: MVec3;
    normal: MVec3;
    pinching: boolean;
    open: boolean;
    ray: { origin: MVec3; direction: MVec3 };
  }
  const newPose = (): MPose => ({
    source: 'hand',
    position: [0, 0, 0],
    normal: [0, -1, 0],
    pinching: false,
    open: false,
    ray: { origin: [0, 0, 0], direction: [0, 0, -1] },
  });
  const poses: Record<Hand, MPose> = { left: newPose(), right: newPose() };
  const posed: Record<Hand, boolean> = { left: false, right: false };
  const joints = new Float32Array(POSE_JOINTS.length * 16);
  const jointSpaces = new WeakMap<XRHand, XRSpace[]>();
  const pv = new Vector3();
  const pd = new Vector3();
  const toVec = (v: Vector3, out: MVec3) => {
    out[0] = v.x;
    out[1] = v.y;
    out[2] = v.z;
  };
  type JointFrame = XRFrame & { fillPoses?(spaces: XRSpace[], base: XRSpace, out: Float32Array): boolean };
  /** Packs the pose joints of a tracked hand into `joints`, in the reference space; false when any is missing. */
  const readJoints = (hand: XRHand): boolean => {
    const frame = world.renderer.xr.getFrame() as JointFrame | null;
    const ref = world.renderer.xr.getReferenceSpace();
    if (!frame || !ref) return false;
    let spaces = jointSpaces.get(hand);
    if (!spaces) {
      spaces = [];
      for (const name of POSE_JOINTS) {
        const s = hand.get(name);
        if (!s) return false;
        spaces.push(s);
      }
      jointSpaces.set(hand, spaces);
    }
    if (frame.fillPoses) return frame.fillPoses(spaces, ref, joints);
    for (let i = 0; i < spaces.length; i++) {
      const p = frame.getJointPose?.(spaces[i] as XRJointSpace, ref);
      if (!p) return false;
      joints.set(p.transform.matrix, i * 16);
    }
    return true;
  };
  const updatePose = (hand: Hand, source: PointerSource | null) => {
    posed[hand] = source === 'hand' || source === 'controller';
    if (!posed[hand]) return;
    const out = poses[hand];
    out.source = source!;
    out.pinching = xr.getSelectState(hand).active;
    const raySpace = player.raySpaces[hand];
    toVec(raySpace.getWorldPosition(pv), out.ray.origin);
    toVec(pd.set(0, 0, -1).transformDirection(raySpace.matrixWorld), out.ray.direction);
    if (source === 'controller') {
      const grip = player.gripSpaces[hand];
      toVec(grip.getWorldPosition(pv), out.position);
      toVec(pd.set(0, 0, -1).transformDirection(grip.matrixWorld), out.normal);
      out.open = false;
      return;
    }
    toVec(player.indexTipSpaces[hand].getWorldPosition(pv), out.position);
    const xrHand = xr.getPrimaryInputSource(hand)?.hand;
    if (xrHand && readJoints(xrHand)) {
      // Joint poses are in the reference space, which is the player rig's frame.
      palmNormal(joints, hand, out.normal);
      toVec(pd.set(out.normal[0], out.normal[1], out.normal[2]).transformDirection(player.matrixWorld), out.normal);
      out.open = fingersOpen(joints);
    } else {
      out.open = false;
    }
  };

  // ---- per frame: face buttons and free holds ---------------------------------------------------------------------

  const BUTTON_IDS: Record<Hand, Record<FaceButton, string>> = {
    left: { lower: InputComponent.X_Button, upper: InputComponent.Y_Button, stick: InputComponent.Thumbstick },
    right: { lower: InputComponent.A_Button, upper: InputComponent.B_Button, stick: InputComponent.Thumbstick },
  };
  const FACE_BUTTONS: readonly FaceButton[] = ['lower', 'upper', 'stick'];
  const newButtons = (): Record<FaceButton, MutableButton> => ({
    lower: { pressed: false, down: false, up: false },
    upper: { pressed: false, down: false, up: false },
    stick: { pressed: false, down: false, up: false },
  });
  const buttons: Record<Hand, Record<FaceButton, MutableButton>> = { left: newButtons(), right: newButtons() };
  const holds: Record<Hand, HoldState> = { left: newHoldState(), right: newHoldState() };

  const updateButtons = (hand: Hand, source: PointerSource | null) => {
    const gp = source === 'controller' ? xr.gamepads[hand] : undefined;
    for (const which of FACE_BUTTONS) {
      stepButton(buttons[hand][which], gp ? gp.getButtonPressed(BUTTON_IDS[hand][which]) : false);
    }
  };

  /** After the poses, and after this frame's pointer events (InputSystem runs first), so presses are already counted. */
  const updateHold = (hand: Hand, source: PointerSource | null, nowMs: number) => {
    const state = holds[hand];
    if (source !== 'hand' && source !== 'controller') {
      stepHold(state, false, false, nowMs, 'pinch', 0, 0, 0);
      return;
    }
    const isHand = source === 'hand';
    const down = isHand ? xr.getSelectState(hand).active : !!xr.gamepads[hand]?.getButtonPressed(InputComponent.Squeeze);
    const consumed = sidePresses[hand] > 0 || (isHand && pinches[hand].consumed);
    const p = poses[hand].position;
    stepHold(state, down, consumed, nowMs, isHand ? 'pinch' : 'grip', p[0], p[1], p[2]);
  };

  const tick = (time: number) => {
    const left = sourceNow('left');
    const right = sourceNow('right');
    const cur = sources.value;
    if (cur.left !== left || cur.right !== right) sources.value = Object.freeze({ left, right });
    updatePose('left', left);
    updatePose('right', right);
    updateStick('left', left);
    updateStick('right', right);
    updateButtons('left', left);
    updateButtons('right', right);
    updateHold('left', left, time * 1000);
    updateHold('right', right, time * 1000);
    routeEvent.timeStamp = time * 1000;
    routeGrip('left', left);
    routeGrip('right', right);
    if (pressing.size > 0) pressing.forEach(checkBinding);
    arbitrateTouch('left');
    arbitrateTouch('right');
  };

  class InputServiceSystem extends createSystem({}, {}) {
    update(_delta: number, time: number): void {
      tick(time);
    }
  }
  world.registerSystem(InputServiceSystem, { priority: SYSTEM_PRIORITY });

  return {
    bind,
    sources,
    pose(hand): HandPose | null {
      return posed[hand] ? poses[hand] : null;
    },
    stick(hand) {
      const view = stickViews[hand];
      view.x = sticks[hand].x;
      view.y = sticks[hand].y;
      return view;
    },
    pulse(hand, intensity, ms) {
      if (opts.haptics && !opts.haptics()) return;
      if (!xr.isPrimary('controller', hand)) return;
      const gamepad = xr.getPrimaryInputSource(hand)?.gamepad as HapticGamepad | null | undefined;
      if (!gamepad) return;
      const value = Math.min(1, Math.max(0, Number.isFinite(intensity) ? intensity : 0));
      const duration = Math.max(0, Number.isFinite(ms) ? ms : 0);
      if (value === 0 || duration === 0) return;
      try {
        const actuator = gamepad.hapticActuators?.[0];
        if (actuator?.pulse) {
          void Promise.resolve(actuator.pulse(value, duration)).catch(noop);
        } else if (gamepad.vibrationActuator?.playEffect) {
          void Promise.resolve(
            gamepad.vibrationActuator.playEffect('dual-rumble', {
              duration,
              strongMagnitude: value,
              weakMagnitude: value,
            }),
          ).catch(noop);
        }
      } catch {
        // A runtime without haptics: a pulse is only a nicety.
      }
    },
    button(hand, which): ButtonState {
      return buttons[hand][which];
    },
    freeHold(hand): FreeHold | null {
      return holds[hand].free ? holds[hand].hold : null;
    },
    onAny(fn) {
      anyFns.add(fn);
      return () => {
        anyFns.delete(fn);
      };
    },
  };
}

/** WebXR controllers expose `hapticActuators` (not in the DOM typings); some runtimes only `vibrationActuator`. */
type HapticGamepad = Gamepad & {
  hapticActuators?: ReadonlyArray<{ pulse?(value: number, duration: number): unknown }>;
};

/**
 * Removes IWSDK's internal `Handle` component (GrabSystem cancels it and resets `pointerEventsType`) and detaches the
 * HandleStore's listeners, which GrabSystem 1.1.0 leaves on the object: a stale store would still capture presses and,
 * on release, put the object back where that press began.
 */
function dropHandle(entity: Entity, object: Object3D): boolean {
  const comp = entity.getComponents().find((c) => c.id === 'Handle');
  if (!comp) return false;
  const store = (comp.data as { instance?: ArrayLike<unknown> }).instance?.[entity.index] as HandleListeners | undefined;
  const h = store?.handlers;
  if (h?.onPointerDown) off(object, 'pointerdown', h.onPointerDown);
  if (h?.onPointerMove) off(object, 'pointermove', h.onPointerMove);
  if (h?.onPointerEnd) {
    off(object, 'pointerup', h.onPointerEnd);
    off(object, 'pointercancel', h.onPointerEnd);
  }
  entity.removeComponent(comp);
  return true;
}

function requalify(entity: Entity, tag: typeof RayInteractable) {
  entity.removeComponent(tag);
  entity.addComponent(tag);
}
