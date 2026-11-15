/**
 * Every movable panel of a world, and the one late pass each frame that puts a moved panel where the person left it.
 *
 * Pillars keep placing their panels as they always have (ahead of the head when opened, on the bench layout, next to a
 * part every frame). This pass runs after all of them: for a panel the person has moved (a place in the store, or a
 * drag in progress) it overrides that placement with the person's place, turned to the eyes in yaw and pitch, never
 * rolled. It also notes each pillar placement (`home`), so Tidy up can put every panel back where its pillar wanted it,
 * and tells the grip when its panel is shown or hidden (a closed panel's grip takes no rays).
 *
 * Places are kept in the bench's frame (`BenchSpace.table`), so Recentre and "bring the bench here" move moved panels
 * with the bench. Nothing here allocates per frame.
 */
import { Vector3, Quaternion, type Object3D } from '@iwsdk/core';
import type { DragPointer } from './drag';
import { beginDrag, clampReach, heldPoint, keepAboveBench, type DragHold, type MVec3 } from './drag';
import type { PlaceStore } from './store';

export interface PlacedPanel {
  /** The store's key: one place per id. */
  readonly id: string;
  /** The panel's root, moved and turned. Its +z faces the person. */
  readonly group: Object3D;
  /** Metres from the root's origin down to its lowest point (the grip included), and half its width: the bench guard. */
  drop: number;
  halfWidth: number;
  /** A fixture lying on the bench (the parts shelf): it slides on the bench top at its own height and keeps its own turn. */
  readonly flat?: boolean;
  /** The panel was shown or hidden (the grip's hit follows). */
  onShown?(shown: boolean): void;
  /** The root is in the scene for the first time (bind input now: binding a parentless object would move it). */
  onAttached?(): void;
}

export interface PanelHandle {
  readonly dragging: boolean;
  /** Starts moving the panel with `pointer`, which pressed it at `hit` (world). */
  begin(pointer: DragPointer, hit?: readonly [number, number, number]): void;
  /** The pointer moved: the panel follows (within reach, above the bench). */
  move(pointer: DragPointer): void;
  /** The press ended: the place is kept (and stored) where the panel is. */
  end(): void;
  /** The person's place for it in world space, if they moved it; false when it keeps its pillar's place. */
  placed(out: Vector3): boolean;
  remove(): void;
}

export interface PanelPlaces {
  readonly store: PlaceStore;
  add(panel: PlacedPanel): PanelHandle;
  /** The late pass; the world's system calls it every frame. */
  step(): void;
  /** Forgets every moved place and puts each panel back where its pillar last placed it. */
  tidy(): void;
  /** Ids of the panels now registered (the emulator walk reads it). */
  ids(): string[];
}

export interface PlacesContext {
  readonly store: PlaceStore;
  /** The frame places are kept in: the bench (`BenchSpace.table`), or the scene. */
  readonly frame: Object3D;
  /** The scene the panels must be in to be shown. */
  readonly scene: Object3D;
  /** Writes the eyes' world position into `out`. */
  eye(out: Vector3): Vector3;
  /** Whether `frame` is the bench (its top at y = 0): then panels stay above it. */
  readonly bench: boolean;
}

interface Entry {
  readonly p: PlacedPanel;
  attached: boolean;
  shown: boolean;
  /** What this pass last wrote into the root's position (parent frame), when it owns the placement. */
  readonly set: Vector3;
  owning: boolean;
  /** The pillar's own last placement of the root (parent frame). */
  readonly home: Vector3;
  readonly homeQ: Quaternion;
  hasHome: boolean;
  hold: DragHold | null;
  /** The place while dragging, in the frame. */
  live: MVec3 | null;
  readonly liveBuf: MVec3;
  /** The frame-space height the drag began at (a flat fixture keeps it). */
  startY: number;
}

/** How far a flat fixture's origin may slide from the bench's centre, metres (the bench is 1.0 x 0.55 m). */
const FLAT_BOX = { x: 0.7, z: 0.4 } as const;

const NEAR = 1e-4;
const differs = (a: Vector3, b: Vector3) => Math.abs(a.x - b.x) > NEAR || Math.abs(a.y - b.y) > NEAR || Math.abs(a.z - b.z) > NEAR;

/** Whether `o` is under `scene` and drawn: every ancestor visible and none closed to pointers (`setPanelHit`). */
function shownIn(o: Object3D, scene: Object3D): boolean {
  let n: Object3D | null = o;
  while (n) {
    if (!n.visible) return false;
    if ((n as { pointerEvents?: string }).pointerEvents === 'none') return false;
    if (n === scene) return true;
    n = n.parent;
  }
  return false;
}

function attachedTo(o: Object3D, scene: Object3D): boolean {
  let n: Object3D | null = o;
  while (n) {
    if (n === scene) return true;
    n = n.parent;
  }
  return false;
}

export function createPanelPlaces(ctx: PlacesContext): PanelPlaces {
  const entries = new Set<Entry>();
  const eye = new Vector3();
  const v = new Vector3();
  const frameWorld = new Vector3();
  const eyeT: MVec3 = [0, 0, 0];
  const w: MVec3 = [0, 0, 0];

  const floorY = (): number => {
    if (!ctx.bench) return -Infinity;
    ctx.frame.getWorldPosition(frameWorld);
    return -frameWorld.y;
  };

  /** Writes `local` (in the frame) into the root's position in its parent's frame, and turns it to the eyes. */
  const apply = (e: Entry, local: Readonly<MVec3>) => {
    const g = e.p.group;
    const parent = g.parent;
    if (!parent) return;
    v.set(local[0], local[1], local[2]);
    ctx.frame.localToWorld(v);
    parent.updateWorldMatrix(true, false);
    parent.worldToLocal(v);
    g.position.copy(v);
    if (!e.p.flat) g.lookAt(eye);
    e.set.copy(g.position);
    e.owning = true;
  };

  const finish = (e: Entry, keep: boolean) => {
    if (keep && e.live) ctx.store.set(e.p.id, e.live);
    e.hold = null;
    e.live = null;
  };

  const step = () => {
    ctx.frame.updateWorldMatrix(true, false);
    ctx.eye(eye);
    for (const e of entries) {
      const g = e.p.group;
      if (!e.attached) {
        if (!attachedTo(g, ctx.scene)) continue;
        e.attached = true;
        e.p.onAttached?.();
      }
      const shown = shownIn(g, ctx.scene);
      if (shown !== e.shown) {
        e.shown = shown;
        e.p.onShown?.(shown);
        if (!shown && e.hold) finish(e, true);
      }
      if (!shown) continue;
      // The pillar placed it since this pass last did (or this pass never has): that is its own place now.
      if (!e.owning || differs(g.position, e.set)) {
        e.home.copy(g.position);
        e.homeQ.copy(g.quaternion);
        e.hasHome = true;
      }
      const target = e.live ?? ctx.store.get(e.p.id);
      if (!target) {
        e.owning = false;
        continue;
      }
      apply(e, target);
    }
  };

  return {
    store: ctx.store,
    add(p) {
      const e: Entry = {
        p,
        attached: false,
        shown: false,
        set: new Vector3(),
        owning: false,
        home: new Vector3(),
        homeQ: new Quaternion(),
        hasHome: false,
        hold: null,
        live: null,
        liveBuf: [0, 0, 0],
        startY: 0,
      };
      entries.add(e);
      return {
        get dragging() {
          return e.hold !== null;
        },
        begin(pointer, hit) {
          const g = p.group;
          g.updateWorldMatrix(true, false);
          g.getWorldPosition(v);
          e.hold = beginDrag([v.x, v.y, v.z], pointer, hit);
          ctx.frame.updateWorldMatrix(true, false);
          ctx.frame.worldToLocal(v);
          e.liveBuf[0] = v.x;
          e.liveBuf[1] = v.y;
          e.liveBuf[2] = v.z;
          e.startY = v.y;
          e.live = e.liveBuf;
        },
        move(pointer) {
          if (!e.hold) return;
          ctx.eye(eye);
          eyeT[0] = eye.x;
          eyeT[1] = eye.y;
          eyeT[2] = eye.z;
          clampReach(heldPoint(e.hold, pointer, w), eyeT);
          v.set(w[0], w[1], w[2]);
          ctx.frame.updateWorldMatrix(true, false);
          ctx.frame.worldToLocal(v);
          e.liveBuf[0] = v.x;
          e.liveBuf[1] = v.y;
          e.liveBuf[2] = v.z;
          if (p.flat) {
            // A fixture on the bench top: it keeps its own height and stays within the bench's reach.
            e.liveBuf[0] = Math.max(-FLAT_BOX.x, Math.min(FLAT_BOX.x, e.liveBuf[0]));
            e.liveBuf[1] = e.startY;
            e.liveBuf[2] = Math.max(-FLAT_BOX.z, Math.min(FLAT_BOX.z, e.liveBuf[2]));
          } else if (ctx.bench) keepAboveBench(e.liveBuf, p.drop, floorY(), p.halfWidth);
          e.live = e.liveBuf;
        },
        end() {
          if (e.hold) finish(e, true);
        },
        placed(out) {
          const t = e.live ?? ctx.store.get(p.id);
          if (!t) return false;
          ctx.frame.updateWorldMatrix(true, false);
          ctx.frame.localToWorld(out.set(t[0], t[1], t[2]));
          return true;
        },
        remove() {
          entries.delete(e);
        },
      };
    },
    step,
    tidy() {
      ctx.store.clear();
      for (const e of entries) {
        e.hold = null;
        e.live = null;
        if (e.owning && e.hasHome) {
          e.p.group.position.copy(e.home);
          e.p.group.quaternion.copy(e.homeQ);
        }
        e.owning = false;
      }
    },
    ids: () => [...entries].map((e) => e.p.id),
  };
}
