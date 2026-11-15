/**
 * The bench itself: a grip bar standing on the table's far edge moves the whole bench, the work mat, the board, parts,
 * wires, the shelf and everything else in the bench's frames (`BenchSpace.table` and `root`), in all three dimensions.
 *
 * The bar is the panels' grip (`ui/panels/grip.ts`: an inked paper pill with the three-dot move mark, accent and a
 * 3 dmm lift on hover, sinking flush when held), at its panel size, standing on the centre of the table's far edge
 * (beyond the mat) and leaning back a little, facing the eyes. It used to lie on the front edge, 0.12 m ahead of the
 * eyes: level with or behind the hands, so a hand ray had to point back at the body and the hand's own grab sphere sat
 * on it, and on a headset it could not be taken (#363). A controller ray and trigger, a controller grip or trigger at
 * the bar, or a hand pinch (near or along the hand ray) holds it; while held the bench follows (`move.ts`), level,
 * turned to face the eyes, never nearer the floor than 0.1 m. The only write is `BenchSpace.setBenchTop`: no project operation, no undo step, and the
 * simulation runs on. It binds as the panel grips do (a control): standing beyond the mat, no part is in front of it.
 *
 * Where it was left is kept across reloads (`iynk:xr:bench:v1`). Anyone else moving the bench (Recentre) forgets it,
 * and the menu's Tidy up puts the bench back where it stood before the person moved it.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe, Vec3 } from '../../contracts/common';
import type { InteractionEvent } from '../../contracts/input';
import { hoverLift, setPanelHit } from '../../look/moves';
import { makeCanvas, PX_PER_DMM } from '../../look/paint';
import { onLookFrame } from '../../look/runner';
import { dmm } from '../../look/type';
import type { DragHold } from '../../ui/panels/drag';
import { barWidth, GRIP_DMM, onTidy, paintGrip, type GripLook } from '../../ui/panels/grip';
import { browserStorage } from '../../ui/panels/store';
import { benchGeometry } from '../core/geometry';
import { removeBound } from '../wire/entities';
import { beginBenchDrag, createBenchPlaceStore, orbitedTop, type TopPose } from './move';
import { uploadNow } from '../../look/upload';

/** The bar's id for `app.input` and its hit's name (the emulator walk finds it by name). */
export const BENCH_GRIP_ID = 'bench/grip';
/**
 * The bar, table frame: the distance its dmm sizes are read at (the far edge is about 1 m from the eyes), how far in
 * from the table's far edge and how high its centre stands, how far it leans back from upright (radians; facing about
 * where the eyes and hands are), and how thick its hit is.
 */
const eyeAt = new Vector3();
const BAR = { distanceM: 1.0, inset: 0.03, y: 0.03, leanRad: 0.5, hitDepth: 0.03 } as const;

export const poseModule: FeatureModule = {
  id: 'bench/pose',
  mount: (app) => mountBenchGrip(app),
};

/** Whether `o` is drawn: it and every ancestor visible, up to the scene. */
function shownIn(o: Object3D, scene: Object3D): boolean {
  for (let n: Object3D | null = o; n; n = n.parent) {
    if (!n.visible) return false;
    if (n === scene) return true;
  }
  return false;
}

function mountBenchGrip(app: XrApp): Unsubscribe {
  const D = BAR.distanceM;
  // The panels' own bar, sized as for a panel the bench's width.
  const barW = barWidth(1, D);
  const barH = dmm(GRIP_DMM.barH + GRIP_DMM.shadow, D);
  const pxPerDmm = PX_PER_DMM;
  const canvas = makeCanvas((barW / dmm(1, D)) * pxPerDmm, (barH / dmm(1, D)) * pxPerDmm);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const bar = new Mesh(new PlaneGeometry(barW, barH), mat);
  bar.name = 'bench:grip-bar';
  bar.renderOrder = 21;
  bar.raycast = () => undefined;
  const hitMat = new MeshBasicMaterial({ visible: false });
  const hit = new Mesh(new BoxGeometry(barW + dmm(GRIP_DMM.hitPad * 2, D), dmm(GRIP_DMM.hitH, D), BAR.hitDepth), hitMat);
  hit.name = 'bench:grip';
  // Its order is a control's (`kind: 'control'` below), as every panel grip's: on the far edge it stands in front of the
  // low ring panels (onboarding, the scope screen), which outrank every bench proxy and would take a ray that passes it.
  const grip = new Group();
  grip.name = 'bench:grip-root';
  grip.add(bar, hit);
  const root = new Group();
  root.name = 'bench:grip-place';
  root.add(grip);
  app.bench.table.add(root);

  const place = () => {
    const xr = app.settings.xr.value;
    const { table } = benchGeometry(xr.posture, xr.dominantHand);
    // Straight ahead, the ring's outer edge is at z = cz - outer.
    root.position.set(0, BAR.y, table.cz - table.outer + BAR.inset);
    root.rotation.set(-BAR.leanRad, 0, 0);
  };
  place();

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

  // ---- the place: the person's, kept; and home, where the bench stood before they moved it ----
  const store = createBenchPlaceStore(browserStorage());
  /** The last pose this module wrote; any other pose is someone else's (Recentre). */
  let mine: TopPose | null = null;
  let home: TopPose = app.bench.benchTop.value;
  const write = (pose: TopPose) => {
    mine = pose;
    app.bench.setBenchTop(pose);
  };
  const saved = store.get();
  if (saved) write(saved);

  const hovered = new Set<number>();
  let press: { id: number; hold: DragHold; yawRad: number; eye: Vec3; moved: boolean } | null = null;
  const refresh = () => paint(press ? 'held' : hovered.size > 0 ? 'hover' : 'idle');
  const end = () => {
    if (press?.moved) store.set(app.bench.benchTop.value);
    press = null;
  };

  const onEvent = (e: InteractionEvent) => {
    const p = e.pointer;
    switch (e.type) {
      case 'hover-start':
        hovered.add(p.id);
        break;
      case 'hover-end':
        hovered.delete(p.id);
        break;
      case 'select-start': {
        if (press) return;
        const top = app.bench.benchTop.value;
        // The eyes as the hold starts: the bench swings round them (`orbitedTop`), steady while the head looks about.
        app.world.camera.updateMatrixWorld(true);
        app.world.camera.getWorldPosition(eyeAt);
        const eye: Vec3 = [eyeAt.x, eyeAt.y, eyeAt.z];
        press = { id: p.id, hold: beginBenchDrag(top, p, e.point), yawRad: top.yawRad, eye, moved: false };
        if (p.hand) app.input.pulse(p.hand, 0.3, 18);
        break;
      }
      case 'drag-move':
        if (!press || p.id !== press.id) return;
        press.moved = true;
        write(orbitedTop(press.hold, p, press.yawRad, press.eye));
        return;
      case 'select-end':
        if (!press || p.id !== press.id) return;
        end();
        if (p.hand) app.input.pulse(p.hand, 0.15, 12);
        break;
      default:
        return;
    }
    refresh();
  };

  const offs: Unsubscribe[] = [];
  offs.push(app.input.bind(hit, { id: BENCH_GRIP_ID, ray: true, nearSelect: true, kind: 'control' }, onEvent));
  offs.push(app.settings.xr.subscribe(place));
  offs.push(
    app.bench.benchTop.subscribe((pose) => {
      if (pose === mine) return;
      // Someone else put the bench somewhere (Recentre): that is its home now, and the person's place is forgotten.
      home = pose;
      press = null;
      store.clear();
      refresh();
    }),
  );
  offs.push(
    onTidy(app, () => {
      press = null;
      store.clear();
      const now = app.bench.benchTop.value;
      if (now === mine && now !== home) write(home);
      refresh();
    }),
  );
  // The bar takes rays only while the bench is drawn (Room size and the Range hide it).
  let shown = true;
  offs.push(
    onLookFrame(app.world, () => {
      const s = shownIn(root, app.world.scene);
      if (s === shown) return;
      shown = s;
      setPanelHit(grip, s);
      if (!s) {
        hovered.clear();
        end();
        refresh();
      }
    }),
  );

  return () => {
    for (const off of offs) off();
    removeBound(app, root);
    tex.dispose();
    mat.dispose();
    hitMat.dispose();
    bar.geometry.dispose();
    hit.geometry.dispose();
  };
}
