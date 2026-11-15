/**
 * Room size (design 8.1): the board big on the floor in front of the person. The menu's place switch offers it
 * (`shell.offer('room')`) and calls `shell.go('room')`; this module reacts to `shell.place`. The bench content fades out
 * (250 ms), the pillar's own live copy of the board fades in on the floor (400 ms), and a small "Back to bench" panel
 * takes the person back by the reverse fade. Nothing ever scales or grows. Reduced motion shortens every fade to 150 ms
 * at most. If the immersive session ends at Room size the bench is back at once.
 *
 * Files: `copy.ts` the live copy, `size.ts` scale and placement, `fade.ts` the fade state machine, `back.ts` the panel.
 * The near-eye fade and teleport are issue #276, not here.
 */
import { Vector3, type Object3D } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../contracts/app';
import { benchInternals } from '../../bench/space';
import { onFrame } from '../kit/frame';
import { ownMaterials, setOpacity, type OwnedMaterials } from '../kit/materials';
import { fadeMs } from '../kit/prefs';
import { scaleInternals } from '../service';
import { createBackPanel } from './back';
import { buildRoomCopy, type RoomCopy } from './copy';
import { createFade, type FadeTimes } from './fade';
import { boundsShortSide, roomPose, roomScale, type RoomPose } from './size';

const OUT_MS = 250;
const IN_MS = 400;

/** Best effort: the guardian's shorter side from a `bounded-floor` space, or null. */
async function readBounds(app: XrApp): Promise<number | null> {
  const session = app.world.session;
  if (!session) return null;
  try {
    const space = (await session.requestReferenceSpace('bounded-floor')) as XRReferenceSpace & { boundsGeometry?: ReadonlyArray<{ x: number; z: number }> };
    return boundsShortSide(space.boundsGeometry ?? []);
  } catch {
    return null;
  }
}

export const roomModule: FeatureModule = {
  id: 'scale/room',
  mount(app) {
    const internals = scaleInternals(app.scale);
    const times = (): FadeTimes => ({ outMs: fadeMs(app, OUT_MS), inMs: fadeMs(app, IN_MS) });
    const fade = createFade(times());
    const head = new Vector3();
    const dir = new Vector3();

    let copy: RoomCopy | null = null;
    let pose: RoomPose | null = null;
    let dirty = true;
    let owned: OwnedMaterials[] | null = null;
    let benchHidden = false;
    let fading = false;
    let boundsShort: number | null = null;
    let disposed = false;

    const benchNodes = (): Object3D[] => [app.bench.root, app.bench.table];
    const markDirty = () => {
      dirty = true;
    };
    const wantsRoom = () => app.shell.place.value === 'room';

    const applyPose = () => {
      if (!copy || !pose) return;
      copy.root.position.set(pose.x, 0, pose.z);
      copy.root.rotation.set(0, pose.yaw, 0);
      copy.root.scale.setScalar(pose.scale);
    };

    const rebuild = () => {
      copy?.dispose();
      copy = buildRoomCopy(app.bench.root);
      app.world.scene.add(copy.root);
      applyPose();
      copy.root.visible = fade.state.room > 0;
      copy.sync(fade.state.room);
      dirty = false;
      // A new object each time, so overlays re-bind to the copy.
      if (fade.state.target === 1) internals.setStage({ kind: 'room', root: copy.root });
    };

    const release = () => {
      if (!owned) return;
      for (const o of owned) o.restore();
      owned = null;
    };
    const own = () => {
      if (owned) return;
      owned = benchNodes().map((n) => ownMaterials(n));
    };

    const applyBench = (a: number) => {
      if (a >= 1) {
        release();
        if (benchHidden) for (const n of benchNodes()) n.visible = true;
        benchHidden = false;
      } else if (a <= 0) {
        release();
        if (!benchHidden) for (const n of benchNodes()) n.visible = false;
        benchHidden = true;
      } else {
        if (benchHidden) for (const n of benchNodes()) n.visible = true;
        benchHidden = false;
        own();
        for (const o of owned!) for (const m of o.clones.values()) setOpacity(m, a);
      }
    };

    const setFading = (on: boolean) => {
      if (fading === on) return;
      fading = on;
      internals.setFading(on);
    };

    const apply = () => {
      const st = fade.state;
      applyBench(st.bench);
      if (copy) {
        copy.root.visible = st.room > 0;
        if (st.room > 0) copy.sync(st.room);
      }
      setFading(st.moving);
    };

    const enter = () => {
      if (fade.state.p === 0 || !copy) {
        // A fresh entry: a fresh copy, sized and placed from the head as it is now.
        release();
        rebuild();
        const extent = copy!.extent();
        app.world.camera.getWorldPosition(head);
        app.world.camera.getWorldDirection(dir);
        pose = roomPose(extent, roomScale(extent, boundsShort), { x: head.x, z: head.z, fx: dir.x, fz: dir.z });
        applyPose();
        void readBounds(app).then((b) => {
          if (b !== null) boundsShort = b;
        });
      }
      fade.setTimes(times());
      fade.go(1);
      internals.setStage({ kind: 'room', root: copy!.root });
      back.show(true);
      apply();
    };

    const leave = () => {
      fade.setTimes(times());
      fade.go(0);
      internals.setStage({ kind: 'bench', root: app.bench.root });
      back.show(false);
      // The session ended: the bench is back at once.
      if (app.mode.value === 'flat') fade.snap(0);
      apply();
    };

    const goBack = () => {
      app.scale.leaveRoom();
      // leaveRoom is ignored while a fade runs; the fade reverses from where it is, so go on regardless.
      if (wantsRoom()) app.shell.go('bench');
    };
    const back = createBackPanel(app, goBack);

    const onPlace = () => {
      if (disposed) return;
      const want = wantsRoom() ? 1 : 0;
      if (fade.state.target === want) return;
      if (want === 1) enter();
      else leave();
    };

    const offOffer = app.shell.offer('room', 'scale/room');
    const offPlace = app.shell.place.subscribe(onPlace);
    const offMode = app.mode.subscribe((mode) => {
      if (mode === 'flat') {
        if (wantsRoom()) app.shell.go('bench');
        else if (fade.state.p !== 0) leave();
      }
    });
    const offLayout = app.bench.onLayout(markDirty);
    const offItems = benchInternals(app.bench)?.onItems(markDirty);
    const offFrame = onFrame(app.world, (dt) => {
      if (copy && dirty && fade.state.p > 0 && !owned) rebuild();
      fade.step(dt * 1000);
      apply();
      back.tick();
    });
    onPlace();

    return () => {
      disposed = true;
      offFrame();
      offLayout();
      offItems?.();
      offMode();
      offPlace();
      offOffer();
      if (wantsRoom()) fade.snap(0);
      release();
      if (benchHidden) for (const n of benchNodes()) n.visible = true;
      internals.setStage({ kind: 'bench', root: app.bench.root });
      internals.setFading(false);
      back.dispose();
      copy?.dispose();
      copy = null;
    };
  },
};
