/**
 * Hands and controllers in the two rooms (XR_DESIGN.md 2.5). IWSDK draws each tracked hand as a skinned model with its
 * own outline shader (a transparent depth-writing body and a back-face outline clone) and each controller as a model, both
 * loaded by IWSDK from its default asset path (a CDN; this module adds no fetch and no asset).
 *
 *   passthrough   the hand body draws depth only, first, so virtual parts hide behind the real fingers; the outline
 *                 clone and every controller mesh are hidden (the real ones show through).
 *   paper room    the hand is a paper fill with an inked, inflated back-face hull; controllers stay hidden.
 *
 * `mountHandSkin` swaps materials when the room changes and when a model appears (checked each frame by identity, no
 * allocation), keeps the originals and puts them back on dispose.
 */
import { BackSide, FrontSide, MeshBasicMaterial, type Material, type Mesh, type Object3D } from '@iwsdk/core';
import type { ReadonlyValue, Unsubscribe } from '../../contracts/common';
import type { RoomKind } from '../../contracts/scale';
import { INK, PAPER } from '../../look/palette';

export type VisualKind = 'hand' | 'controller';
export interface HandVisual {
  readonly kind: VisualKind;
  readonly model: Object3D;
}

/** Drawn before everything else, so the fingers' depth is in place when parts draw. */
export const OCCLUDER_ORDER = -100;
/** How far the ink hull stands off the paper hand, metres. */
export const HULL_THICKNESS = 0.0013;

interface Saved {
  readonly mesh: Mesh;
  readonly kind: VisualKind;
  readonly outline: boolean;
  readonly material: Material | Material[];
  readonly visible: boolean;
  readonly renderOrder: number;
}

export interface HandSkin {
  dispose(): void;
}

export interface HandSkinOptions {
  /** The visuals IWSDK holds right now (hand and controller models that have loaded). */
  visuals(): Iterable<HandVisual>;
  room: ReadonlyValue<RoomKind>;
  /** Calls `fn` every frame; returns its removal. */
  onFrame(fn: () => void): Unsubscribe;
}

export function makeOccluder(): MeshBasicMaterial {
  return new MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true, side: FrontSide });
}
export function makePaperHand(): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: PAPER, side: FrontSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
}
export function makeInkHull(): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: INK, side: BackSide });
  // Skinned meshes carry `objectNormal` in the basic material's vertex shader; push the hull out along it.
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `transformed += normalize(objectNormal) * ${HULL_THICKNESS.toFixed(5)};\n#include <project_vertex>`,
    );
  };
  m.customProgramCacheKey = () => 'iynkware-hand-hull';
  return m;
}

const isOutline = (m: Material | Material[]): boolean => !Array.isArray(m) && m.side === BackSide;

export function mountHandSkin(opts: HandSkinOptions): HandSkin {
  const occluder = makeOccluder();
  const paper = makePaperHand();
  const hull = makeInkHull();
  const saved = new Map<Object3D, Saved[]>();

  const skin = (s: Saved, room: RoomKind): void => {
    const { mesh } = s;
    if (s.kind === 'controller') {
      mesh.visible = false;
    } else if (room === 'passthrough') {
      if (s.outline) mesh.visible = false;
      else {
        mesh.material = occluder;
        mesh.renderOrder = OCCLUDER_ORDER;
        mesh.visible = s.visible;
      }
    } else {
      mesh.material = s.outline ? hull : paper;
      mesh.visible = s.visible;
      mesh.renderOrder = s.renderOrder;
    }
  };

  const take = (v: HandVisual): void => {
    const list: Saved[] = [];
    v.model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      list.push({ mesh, kind: v.kind, outline: v.kind === 'hand' && isOutline(mesh.material), material: mesh.material, visible: mesh.visible, renderOrder: mesh.renderOrder });
    });
    saved.set(v.model, list);
    for (const s of list) skin(s, opts.room.value);
  };

  const sweep = (): void => {
    for (const v of opts.visuals()) if (!saved.has(v.model)) take(v);
  };
  const reskin = (): void => {
    for (const list of saved.values()) for (const s of list) skin(s, opts.room.value);
  };

  sweep();
  const offs = [
    opts.room.subscribe(() => {
      sweep();
      reskin();
    }),
    opts.onFrame(sweep),
  ];
  return {
    dispose() {
      for (const off of offs) off();
      for (const list of saved.values()) {
        for (const s of list) {
          s.mesh.material = s.material;
          s.mesh.visible = s.visible;
          s.mesh.renderOrder = s.renderOrder;
        }
      }
      saved.clear();
      occluder.dispose();
      paper.dispose();
      hull.dispose();
    },
  };
}
