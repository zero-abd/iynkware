/**
 * The grip bar every floating panel carries (the panel kits mount it; a pillar never needs to): an inked paper pill
 * with the kit's three-dot move mark, centred under the panel's lower edge. Hover fills it accent and lifts it 3 dmm
 * towards the viewer; held, it sinks flush onto its shadow. A hand pinch (near or along the hand ray), a controller
 * trigger along the ray, or a grip or trigger at it, starts a drag: the panel follows (`registry.ts`, `drag.ts`), and
 * stays where it is let go, for the session and after a reload.
 *
 *   const grip = movable(app, { id: 'shell/home', group: p.group, width: 0.8, height: 0.63, distanceM: 0.95 });
 *   grip.drag(e);        // a title bar's presses move the panel the same way
 *   grip.setOpacity(a);  // fade with the panel
 *
 * The grip's hit follows its panel: a hidden or closed panel's grip takes no rays (`setPanelHit`), whichever way the
 * panel's kit hides it. Its input is bound once the panel is in the scene, never on a parentless object.
 */
import {
  CanvasTexture,
  createSystem,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type Object3D,
  type World,
} from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import type { InteractionEvent } from '../../contracts/input';
import { hoverLift, setPanelHit } from '../../look/moves';
import { makeCanvas, paintIcon, paintPlate, PLATE, PX_PER_DMM } from '../../look/paint';
import { ACCENT, INK, PAPER, SHADOW } from '../../look/palette';
import { dmm } from '../../look/type';
import { createPanelPlaces, type PanelPlaces } from './registry';
import { createPlaceStore } from './store';
import { uploadNow } from '../../look/upload';

/** The grip in dmm at its panel's reading distance: the pill, its shadow, the gap under the panel, and the hit. */
export const GRIP_DMM = { barH: 16, shadow: 4, gap: 18, hitH: 56, hitPad: 14, minW: 96, maxW: 200, lift: 3 } as const;
/** The bar's length as a share of the panel's width, within `minW` and `maxW`. */
const BAR_SHARE = 0.34;
/** After everything that places panels (pillar systems at -2 to 0, the look frame at -1). */
const PRIORITY = 50;

export type GripLook = 'idle' | 'hover' | 'held';

export interface MovableOptions {
  /** One stored place per id; namespace it by kit (`shell/home`, `learn/guide`). */
  readonly id: string;
  /** The panel's root: moved and turned to the eyes. Its local +z faces the person, +y is up. */
  readonly group: Object3D;
  /** The panel's width and height in its root's frame, metres. */
  readonly width: number;
  readonly height: number;
  /** The root-frame y of the panel's centre; 0 when the root is at the panel's centre. */
  readonly centreY?: number;
  /** Which edge carries the bar: the lower one (the usual place), or the upper one for a panel standing on the bench. */
  readonly edge?: 'bottom' | 'top';
  /** The distance its dmm sizes are read at (sizes the bar); 1 m by default. */
  readonly distanceM?: number;
  /** The root-frame z of the bar (just in front of the plate). */
  readonly z?: number;
  /** A fixture lying on the bench (the parts shelf): moved flat on the bench top, keeping its own turn and height. */
  readonly flat?: boolean;
  /** Called with the panel's new world position while it is dragged. */
  onMove?(world: Vector3): void;
  /**
   * Shows a round Close beside the bar and calls this when it is pressed: for a panel with no Close of its own (the
   * calm layout's panels that open from the menu and close again here).
   */
  onClose?(): void;
}

export interface Movable {
  /** The bar and its hit, a child of the panel's root. */
  readonly grip: Group;
  /** True while the panel is being dragged. */
  readonly moving: boolean;
  /** Moves the panel from another handle's events (a title bar): select-start, drag-move, select-end. */
  drag(e: InteractionEvent): void;
  /** Fades the bar with its panel. */
  setOpacity(a: number): void;
  /** The panel changed size: the bar moves to the new edge. */
  resize(width: number, height: number, centreY?: number): void;
  /** The person's place for the panel in world space, when they moved it (to draw a leader to it). */
  placed(out: Vector3): boolean;
  /** Forgets the person's place for this panel alone (and ends a drag): its kit's own placement holds again. */
  forget(): void;
  dispose(): void;
}

// ---- the world's places: one registry and one late system per world ----

const worlds = new WeakMap<World, PanelPlaces>();

/** The world's movable panels. `app.bench.table` is the frame places are kept in. */
export function panelPlacesOf(app: Pick<XrApp, 'world'> & { bench?: Pick<XrApp['bench'], 'table'> }): PanelPlaces {
  const world = app.world;
  let reg = worlds.get(world);
  if (reg) return reg;
  const cam = world.camera;
  const r = createPanelPlaces({
    store: createPlaceStore(),
    frame: app.bench?.table ?? world.scene,
    scene: world.scene,
    bench: !!app.bench,
    eye: (out) => cam.getWorldPosition(out),
  });
  reg = r;
  worlds.set(world, r);
  class PanelPlaceSystem extends createSystem({}, {}) {
    update(): void {
      try {
        r.step();
      } catch (err) {
        console.error('[ui/panels] place pass threw', err);
      }
    }
  }
  world.registerSystem(PanelPlaceSystem, { priority: PRIORITY });
  return r;
}

const tidiers = new WeakMap<World, Set<() => void>>();

/** Forgets every moved panel's place and puts each back where its pillar placed it (the menu's Tidy up). */
export function tidyPanels(app: Pick<XrApp, 'world'>): void {
  worlds.get(app.world)?.tidy();
  for (const fn of [...(tidiers.get(app.world) ?? [])]) fn();
}

/** Runs `fn` on every Tidy up too: a thing that keeps its own place (the bench) puts itself back. */
export function onTidy(app: Pick<XrApp, 'world'>, fn: () => void): Unsubscribe {
  let set = tidiers.get(app.world);
  if (!set) tidiers.set(app.world, (set = new Set()));
  const s = set;
  s.add(fn);
  return () => void s.delete(fn);
}

/**
 * Binding gives the hit (and the grip's root) IWSDK entities, which outlive the unbind; left alive, IWSDK would put the
 * removed grip back under the level root. Destroys them deepest first.
 */
function releaseEntities(world: World, root: Object3D): void {
  const list: Object3D[] = [];
  root.traverse((n) => void list.push(n));
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i]!;
    const idx = (n as Object3D & { entityIdx?: number }).entityIdx;
    if (idx === undefined) continue;
    const e = world.entityManager.getEntityByIndex(idx);
    if (e && e.active && e.object3D === n) e.destroy();
  }
}

// ---- the bar ----

/** Paints the pill and its three-dot move mark for `look` into a canvas `w` by `h` px at `px` px per dmm. */
export function paintGrip(g: CanvasRenderingContext2D, w: number, h: number, px: number, look: GripLook): void {
  g.clearRect(0, 0, w, h);
  const s = GRIP_DMM.shadow * px;
  g.save();
  // Held, the pill sinks onto its shadow's place (design 4: a press sinks flush), and no shadow shows.
  if (look === 'held') g.translate(s * 0.67, s * 0.67);
  paintPlate(g, 0, 0, w, h, {
    fill: look === 'idle' ? PAPER : ACCENT,
    ink: INK,
    border: PLATE.border * px,
    radius: h,
    shadow: s,
    shadowColor: look === 'held' ? 'rgba(0,0,0,0)' : SHADOW,
  });
  const cx = (w - s) / 2;
  const cy = (h - s) / 2;
  g.fillStyle = INK;
  for (let i = -1; i <= 1; i++) {
    g.beginPath();
    g.arc(cx + i * 9 * px, cy, 2.4 * px, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Close beside the bar, in dmm: the drawn disc (with its shadow), the gap to the bar, and its hit. */
export const CLOSE_DMM = { size: 40, gap: 12, hit: 56 } as const;

/** Paints the round Close for `look` into a square canvas `s` px a side at `px` px per dmm. */
export function paintClose(g: CanvasRenderingContext2D, s: number, px: number, look: GripLook): void {
  g.clearRect(0, 0, s, s);
  const sh = GRIP_DMM.shadow * px;
  g.save();
  if (look === 'held') g.translate(sh * 0.67, sh * 0.67);
  paintPlate(g, 0, 0, s, s, {
    fill: look === 'idle' ? PAPER : ACCENT,
    ink: INK,
    border: PLATE.border * px,
    radius: s,
    shadow: sh,
    shadowColor: look === 'held' ? 'rgba(0,0,0,0)' : SHADOW,
  });
  const icon = 22 * px;
  paintIcon(g, 'close', (s - sh) / 2 - icon / 2, (s - sh) / 2 - icon / 2, icon, INK);
  g.restore();
}

/** The bar's length in metres for a panel `width` wide read at `distanceM`. */
export function barWidth(width: number, distanceM: number): number {
  return Math.min(dmm(GRIP_DMM.maxW, distanceM), Math.max(dmm(GRIP_DMM.minW, distanceM), width * BAR_SHARE));
}

/**
 * The bar's centre y in the root's frame for a panel `height` tall centred at `centreY`: under the lower edge, clear
 * of the panel's own flat shadow, or over the upper edge (where no shadow falls, so a little closer).
 */
export function barCentreY(centreY: number, height: number, distanceM: number, edge: 'bottom' | 'top' = 'bottom'): number {
  const half = GRIP_DMM.barH / 2 + GRIP_DMM.shadow / 2;
  return edge === 'top' ? centreY + height / 2 + dmm(GRIP_DMM.gap * 0.6 + half, distanceM) : centreY - height / 2 - dmm(GRIP_DMM.gap + half, distanceM);
}

/** How far under the root's origin the panel's lowest point is (the bar's hit when it is at the bottom). */
export function dropOf(centreY: number, height: number, distanceM: number, edge: 'bottom' | 'top' = 'bottom'): number {
  return edge === 'top' ? height / 2 - centreY : -(barCentreY(centreY, height, distanceM, 'bottom') - dmm(GRIP_DMM.hitH / 2, distanceM));
}

/** Gives a panel the grip bar and makes it movable. Every panel kit calls this; see the file comment. */
export function movable(app: Pick<XrApp, 'world' | 'input'> & { bench?: Pick<XrApp['bench'], 'table'> }, o: MovableOptions): Movable {
  const places = panelPlacesOf(app);
  const D = o.distanceM ?? 1;
  const barW = barWidth(o.width, D);
  const barH = dmm(GRIP_DMM.barH + GRIP_DMM.shadow, D);
  const px = PX_PER_DMM;
  const canvas = makeCanvas((barW / dmm(1, D)) * px, (barH / dmm(1, D)) * px);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const bar = new Mesh(new PlaneGeometry(barW, barH), mat);
  bar.name = `panel-grip-bar:${o.id}`;
  bar.renderOrder = 21;
  bar.raycast = () => undefined;
  const hitMat = new MeshBasicMaterial({ visible: false });
  const hit = new Mesh(new PlaneGeometry(barW + dmm(GRIP_DMM.hitPad * 2, D), dmm(GRIP_DMM.hitH, D)), hitMat);
  hit.name = `panel-grip:${o.id}`;
  const grip = new Group();
  grip.name = `panel-grip-root:${o.id}`;
  grip.add(bar, hit);
  o.group.add(grip);
  setPanelHit(grip, false);

  // Close beside the bar, when the panel has none of its own.
  const close = o.onClose ? closeDisc(app, D, o.id, () => o.onClose?.()) : null;
  if (close) {
    close.root.position.set(barW / 2 + dmm(CLOSE_DMM.gap + CLOSE_DMM.size / 2, D), 0, 0);
    grip.add(close.root);
  }

  let look: GripLook | null = null;
  const paint = (next: GripLook) => {
    if (next === look) return;
    const was = look;
    look = next;
    const g = canvas.getContext('2d');
    if (g) {
      paintGrip(g, canvas.width, canvas.height, canvas.width / (barW / dmm(1, D)), next);
      tex.needsUpdate = true;
      uploadNow(tex);
    }
    const up = next === 'hover';
    if (was !== null && (was === 'hover') !== up) hoverLift(app.world, bar, dmm(GRIP_DMM.lift, D), up);
  };
  paint('idle');

  const edge = o.edge ?? 'bottom';
  const layout = (width: number, height: number, centreY = 0) => {
    grip.position.set(0, barCentreY(centreY, height, D, edge), o.z ?? dmm(3, D));
    delete bar.userData.lookRest;
    bar.position.set(0, 0, 0);
    handle.drop = dropOf(centreY, height, D, edge);
    handle.halfWidth = Math.max(width, barW + (close ? 2 * dmm(CLOSE_DMM.gap + CLOSE_DMM.size, D) : 0)) / 2;
  };

  const hovered = new Set<number>();
  let pressId: number | null = null;
  let unbind: Unsubscribe | null = null;
  const at = new Vector3();
  const refresh = () => paint(pressId !== null ? 'held' : hovered.size > 0 ? 'hover' : 'idle');

  const onEvent = (e: InteractionEvent) => {
    const p = e.pointer;
    switch (e.type) {
      case 'hover-start':
        hovered.add(p.id);
        break;
      case 'hover-end':
        hovered.delete(p.id);
        break;
      case 'select-start':
        if (pressId !== null) return;
        pressId = p.id;
        reg.begin(p, e.point);
        if (p.hand) app.input.pulse(p.hand, 0.3, 18);
        break;
      case 'drag-move':
        if (p.id !== pressId) return;
        reg.move(p);
        if (o.onMove && reg.placed(at)) o.onMove(at);
        break;
      case 'select-end':
        if (p.id !== pressId) return;
        pressId = null;
        reg.end();
        if (p.hand) app.input.pulse(p.hand, 0.15, 12);
        break;
      default:
        return;
    }
    refresh();
  };

  const handle = {
    id: o.id,
    group: o.group,
    drop: 0,
    halfWidth: 0,
    flat: o.flat,
    onShown(shown: boolean) {
      setPanelHit(grip, shown);
      if (!shown) {
        hovered.clear();
        pressId = null;
        refresh();
        close?.reset();
      }
    },
    onAttached() {
      unbind = app.input.bind(hit, { id: `panel-grip/${o.id}`, ray: true, nearSelect: true, kind: 'control' }, onEvent);
      close?.bind();
    },
  };
  layout(o.width, o.height, o.centreY);
  const reg = places.add(handle);

  return {
    grip,
    get moving() {
      return reg.dragging;
    },
    drag: onEvent,
    setOpacity(a) {
      mat.opacity = a;
      bar.visible = a > 0.001;
      close?.setOpacity(a);
    },
    resize: layout,
    placed: (out) => reg.placed(out),
    forget() {
      reg.forget();
      pressId = null;
      refresh();
    },
    dispose() {
      reg.remove();
      unbind?.();
      unbind = null;
      close?.unbind();
      releaseEntities(app.world, grip);
      grip.removeFromParent();
      tex.dispose();
      mat.dispose();
      hitMat.dispose();
      bar.geometry.dispose();
      hit.geometry.dispose();
      close?.dispose();
    },
  };
}

interface Disc {
  readonly root: Group;
  bind(): void;
  unbind(): void;
  reset(): void;
  setOpacity(a: number): void;
  dispose(): void;
}

/** The round Close: drawn disc, its hit, hover lift, press sink; a ray, a pinch or a poke selects it. */
function closeDisc(app: Pick<XrApp, 'world' | 'input'>, D: number, id: string, onSelect: () => void): Disc {
  const size = dmm(CLOSE_DMM.size, D);
  const side = Math.ceil(CLOSE_DMM.size * PX_PER_DMM);
  const canvas = makeCanvas(side, side);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const disc = new Mesh(new PlaneGeometry(size, size), mat);
  disc.name = `panel-close-disc:${id}`;
  disc.renderOrder = 21;
  disc.raycast = () => undefined;
  const hitMat = new MeshBasicMaterial({ visible: false });
  const hit = new Mesh(new PlaneGeometry(dmm(CLOSE_DMM.hit, D), dmm(CLOSE_DMM.hit, D)), hitMat);
  hit.name = `panel-close:${id}`;
  const root = new Group();
  root.add(disc, hit);
  let look: GripLook | null = null;
  const hovered = new Set<number>();
  let pressed: number | null = null;
  const paint = () => {
    const next: GripLook = pressed !== null ? 'held' : hovered.size > 0 ? 'hover' : 'idle';
    if (next === look) return;
    const was = look;
    look = next;
    const g = canvas.getContext('2d');
    if (g) {
      paintClose(g, side, side / CLOSE_DMM.size, next);
      tex.needsUpdate = true;
      uploadNow(tex);
    }
    if (was !== null && (was === 'hover') !== (next === 'hover')) hoverLift(app.world, disc, dmm(GRIP_DMM.lift, D), next === 'hover');
  };
  paint();
  let off: Unsubscribe | null = null;
  return {
    root,
    bind() {
      off = app.input.bind(hit, { id: `panel-close/${id}`, ray: true, poke: true, nearSelect: true, kind: 'control' }, (e) => {
        if (e.type === 'hover-start') hovered.add(e.pointer.id);
        else if (e.type === 'hover-end') hovered.delete(e.pointer.id);
        else if (e.type === 'select-start') pressed = e.pointer.id;
        else if (e.type === 'select-end') pressed = null;
        else if (e.type === 'select') {
          if (e.pointer.hand) app.input.pulse(e.pointer.hand, 0.35, 12);
          onSelect();
        }
        paint();
      });
    },
    unbind() {
      off?.();
      off = null;
    },
    reset() {
      hovered.clear();
      pressed = null;
      paint();
    },
    setOpacity(a) {
      mat.opacity = a;
      disc.visible = a > 0.001;
    },
    dispose() {
      tex.dispose();
      mat.dispose();
      hitMat.dispose();
      disc.geometry.dispose();
      hit.geometry.dispose();
    },
  };
}
