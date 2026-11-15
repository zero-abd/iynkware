/**
 * FPV and chase on a world-locked screen at 15 Hz (issue #125, XR_DESIGN 8.2 and 8.3).
 *
 * Views are line of sight (default: the screen is away), chase and FPV. Chase and FPV are a 0.48 x 0.27 m picture on a
 * panel standing beside the flight volume, turned towards where the person stood, never head-locked and never the
 * person's own eyes: the picture is a small render target drawn from a second camera 15 times a second. Controller Y or
 * the View plate cycles the views. Nothing is allocated per frame.
 */
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, SRGBColorSpace, WebGLRenderTarget, type Object3D } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../../contracts/app';
import type { Unsubscribe } from '../../../contracts/common';
import { PLATE } from '../../../look/paint';
import { dmm } from '../../../look/type';
import { dropEntities, shellPanel, placementFrom, TITLE_BAR_DMM, type Fading } from '../../../shell/kit';
import { bindPlate, langOf, onLookFrame, plateButton } from '../../shared';
import { flightSceneOf, type FlightScene } from '../scene';
import { ASPECT, chasePosition, fpvCamera, frameDue, nextView, verticalFov, type Pose, type Quat, type Vec, type View } from './model';
import { SCREEN_STRINGS as S } from './strings';

export const PICTURE_W = 0.48;
export const PICTURE_H = 0.27;
const TARGET_W = 512;
const TARGET_H = 288;
const DISTANCE_M = 1.2;
const SIDE_DEG = 50;
const BELOW_DEG = 6;
/** The room's plate row (room/index.ts): the View plate stands in its fourth slot beyond the room's three. */
const PLATE_AHEAD_M = 0.45;
const PLATE_BELOW_M = 0.38;
const PLATE_LEFT_M = 0.3;
const PLATE_GAP_M = 0.125;
const VIEW_SLOT = 4;

export const screenModule: FeatureModule = {
  id: 'range/flight/screen',
  mount(app) {
    let current: { dispose(): void } | null = null;
    const sync = (scene: FlightScene | null) => {
      current?.dispose();
      current = scene ? openScreen(app, scene) : null;
    };
    const off = flightSceneOf(app).subscribe(sync);
    sync(flightSceneOf(app).value);
    return () => {
      off();
      current?.dispose();
      current = null;
    };
  },
};

function openScreen(app: XrApp, scene: FlightScene): { dispose(): void } {
  const { head, root, craft, spec } = scene;
  const disposers: Unsubscribe[] = [];
  const lang = () => langOf(app);
  let view: View = 'los';

  // ---- the panel and the picture ----
  const bar = dmm(TITLE_BAR_DMM, DISTANCE_M);
  const pad = dmm(PLATE.padding * 1.4, DISTANCE_M);
  const shadow = dmm(PLATE.shadow, DISTANCE_M);
  const panelW = PICTURE_W + 2 * pad + shadow;
  const panelH = PICTURE_H + bar + 2.4 * pad + shadow;
  const panel = shellPanel(app, {
    id: 'range-screen',
    w: panelW,
    h: panelH,
    distanceM: DISTANCE_M,
    title: S.t(lang(), 'fpv'),
    kicker: S.t(lang(), 'kicker'),
    icon: 'eye',
    onClose: () => setView('los'),
  });
  disposers.push(() => panel.dispose());
  const place = placementFrom([head.x, head.y, head.z], [head.heading.fx, 0, head.heading.fz], { distance: DISTANCE_M, belowDeg: BELOW_DEG, sideDeg: SIDE_DEG });
  panel.group.position.set(place.position[0], place.position[1], place.position[2]);
  panel.group.lookAt(head.x, place.position[1], head.z);

  const target = new WebGLRenderTarget(TARGET_W, TARGET_H, { depthBuffer: true });
  target.texture.colorSpace = SRGBColorSpace;
  disposers.push(() => target.dispose());
  const material = new MeshBasicMaterial({ map: target.texture, transparent: true, opacity: 0, toneMapped: false });
  const geometry = new PlaneGeometry(PICTURE_W, PICTURE_H);
  const picture = new Mesh(geometry, material);
  picture.name = 'range-screen-picture';
  picture.raycast = () => undefined;
  const fading: Fading & { group: Group } = {
    group: new Group(),
    setOpacity(a) {
      material.opacity = a;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
  fading.group.add(picture);
  panel.add(fading, 0, panel.top - PICTURE_H / 2);
  root.userData.screen = { target, panel };

  // ---- the View plate, in the plate row's fourth slot ----
  const { fx, fz } = head.heading;
  const rx = -fz, rz = fx;
  const plates = new Group();
  plates.name = 'range-screen-plates';
  plates.position.set(
    head.x + PLATE_AHEAD_M * fx + (VIEW_SLOT * PLATE_GAP_M - PLATE_LEFT_M) * rx,
    head.y - PLATE_BELOW_M,
    head.z + PLATE_AHEAD_M * fz + (VIEW_SLOT * PLATE_GAP_M - PLATE_LEFT_M) * rz,
  );
  plates.rotation.y = Math.atan2(-fx, -fz);
  root.add(plates);
  disposers.push(() => dropEntities(app.world, plates));
  const plate = plateButton(app, { w: 0.11, d: 0.055, standing: true }, { icon: 'scope', label: S.t(lang(), 'los'), lang: lang() });
  plate.group.name = 'screen:view';
  plates.add(plate.group);
  disposers.push(() => plate.dispose());

  const refresh = () => {
    plate.set({ label: S.t(lang(), view), lang: lang() });
    panel.setTitle(S.t(lang(), view === 'chase' ? 'chase' : 'fpv'), S.t(lang(), 'kicker'));
  };
  function setView(v: View): void {
    if (v === view) return;
    view = v;
    refresh();
    if (v === 'los') panel.close();
    else panel.open();
    root.userData.view = view;
  }
  const cycle = () => setView(nextView(view));
  root.userData.view = view;
  root.userData.setView = setView;
  disposers.push(bindPlate(app, plate, 'range/screen/view', cycle));
  disposers.push(app.settings.lang.subscribe(refresh));

  // ---- the picture, 15 times a second ----
  const camera = new PerspectiveCamera(verticalFov(spec.fov), ASPECT, 0.02, 40);
  const pos: Vec = { x: 0, y: 0, z: 0 };
  const quat: Quat = { x: 0, y: 0, z: 0, w: 1 };
  const pose: Pose = { x: 0, y: 0, z: 0, ry: 0, rx: 0, rz: 0 };
  const clock = { t: 0 };
  const buttonY = app.input.button('left', 'upper');
  const object: Object3D = craft.object;

  disposers.push(
    onLookFrame(app.world, (dt) => {
      if (buttonY.down) cycle();
      if (view === 'los') return;
      if (!frameDue(clock, dt)) return;
      const renderer = app.world.renderer;
      if (!renderer) return;
      pose.x = object.position.x;
      pose.y = object.position.y;
      pose.z = object.position.z;
      pose.rx = object.rotation.x;
      pose.ry = object.rotation.y;
      pose.rz = object.rotation.z;
      if (view === 'fpv') {
        fpvCamera(pose, spec.camTilt, pos, quat);
        camera.position.set(pos.x, pos.y, pos.z);
        camera.quaternion.set(quat.x, quat.y, quat.z, quat.w);
      } else {
        chasePosition(pose, scene.volume, pos);
        camera.position.set(pos.x, pos.y, pos.z);
        camera.up.set(0, 1, 0);
        camera.lookAt(pose.x, pose.y, pose.z);
      }
      camera.updateMatrixWorld(true);
      const xr = renderer.xr.enabled;
      const previous = renderer.getRenderTarget();
      const shown = panel.group.visible;
      const craftShown = object.visible;
      panel.group.visible = false;
      if (view === 'fpv') object.visible = false;
      renderer.xr.enabled = false;
      renderer.setRenderTarget(target);
      renderer.render(app.world.scene, camera);
      renderer.setRenderTarget(previous);
      renderer.xr.enabled = xr;
      object.visible = craftShown;
      panel.group.visible = shown;
    }),
  );

  // The screen draws into a single-view target, whose programs are not the headset's multiview ones: start compiling
  // them now rather than on the screen's first render (look/upload.ts warmUp).
  {
    const renderer = app.world.renderer;
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(target);
      renderer.compile(app.world.scene, camera);
    } catch {
      // compiled on first use, as before
    } finally {
      renderer.setRenderTarget(previous);
    }
  }

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      delete root.userData.screen;
      for (const d of disposers.splice(0).reverse()) d();
    },
  };
}
