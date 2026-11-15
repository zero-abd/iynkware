/**
 * Session controls: Recentre and Exit, two inked buttons in the lower left of the person's view, in every mode and every
 * project. The cluster follows the head lazily (`follow.ts`: it waits until the head has turned 28 degrees, then eases
 * after it and settles), at touch range (0.46 m), 26 degrees to the left and 38 below eye level, so it never covers
 * the work and a poke or a ray finds it. It is shown only inside a session.
 *
 *   Recentre  puts the bench (and everything anchored to it) in front of the person again with an eased move, through
 *             `BenchSpace.setBenchTop`, at the height and distance of XR_DESIGN.md 2.1. At Room size or in the Range,
 *             which place their own content from the head when they open, it leaves and re-enters the place.
 *   Exit      ends the immersive session, behind a 700 ms hold with a filling ring (a tap only shows "Hold").
 *
 * Both are bound through `app.input`, so hands (poke, pinch) and controllers (ray, trigger) work alike.
 */
import { Group, Vector3 } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../contracts/app';
import { DURATION, easeIynk } from '../../look/motion';
import { motionOf, onLookFrame } from '../../look/runner';
import { dropEntities, ownEntity } from '../kit/entity';
import { say } from '../copy';
import { sessionButton, type SessionButton } from './button';
import { SESSION } from './copy';
import { clusterSpot, FOLLOW, startFollow, stepFollow, yawOfForward, type FollowState } from './follow';
import { lerpPose, recentreTarget, type BenchPose } from './recentre';

/** How long Exit must be held, ms (the design's Arm hold is 600 ms; leaving the headset is rarer, so a little longer). */
export const EXIT_HOLD_MS = 700;
const W = 0.1;
const H = 0.082;
const GAP = 0.012;
const TWEEN_KEY = 'session-controls/recentre';

const eye = new Vector3();
const dir = new Vector3();

/** Recentres the bench from the current head pose; returns the target. Exported for the emulator walk. */
export function recentre(app: XrApp): BenchPose {
  const cam = app.world.camera;
  cam.updateMatrixWorld(true);
  cam.getWorldPosition(eye);
  cam.getWorldDirection(dir);
  const from = app.bench.benchTop.value;
  const to = recentreTarget([eye.x, eye.y, eye.z], [dir.x, dir.y, dir.z], app.settings.xr.value.posture, from.yawRad);
  const place = app.shell.place.value;
  const motion = motionOf(app.world);
  if (place !== 'bench') {
    // Hidden or placed by its own owner: set the pose now, then let the place open again from where the head is.
    motion.cancel(TWEEN_KEY);
    app.bench.setBenchTop(to);
    if (app.shell.offered.value.includes(place) && app.shell.go('bench')) app.shell.go(place);
    return to;
  }
  motion.tween({ key: TWEEN_KEY, ms: DURATION.move, ease: easeIynk, onUpdate: (k) => app.bench.setBenchTop(lerpPose(from, to, k)) });
  return to;
}

export const sessionControlsModule: FeatureModule = {
  id: 'shell/session-controls',
  mount(app: XrApp) {
    const d = FOLLOW.distance;
    const lang = () => app.settings.lang.value;
    const root = new Group();
    root.name = 'session-controls';
    root.visible = false;
    ownEntity(app.world, root);

    const recentreButton: SessionButton = sessionButton(
      app,
      { id: 'session/recentre', w: W, h: H, distanceM: d, icon: 'target', onSelect: () => recentre(app) },
      { label: say(SESSION, lang(), 'recentre') },
    );
    const exitButton: SessionButton = sessionButton(
      app,
      { id: 'session/exit', w: W, h: H, distanceM: d, icon: 'exit', hold: { ms: EXIT_HOLD_MS, onDone: () => app.world.exitXR() } },
      { label: say(SESSION, lang(), 'exit'), hint: say(SESSION, lang(), 'hold') },
    );
    recentreButton.group.position.x = -(W + GAP) / 2;
    exitButton.group.position.x = (W + GAP) / 2;
    root.add(recentreButton.group, exitButton.group);

    let follow: FollowState | null = null;
    let opacity = 0;
    const setOpacity = (a: number) => {
      opacity = a;
      recentreButton.setOpacity(a);
      exitButton.setOpacity(a);
      root.visible = a > 0.001;
    };
    setOpacity(0);

    const head = (): { x: number; y: number; z: number; yaw: number } => {
      const cam = app.world.camera;
      cam.updateMatrixWorld(true);
      cam.getWorldPosition(eye);
      cam.getWorldDirection(dir);
      return { x: eye.x, y: eye.y, z: eye.z, yaw: yawOfForward(dir.x, dir.z, follow?.yaw ?? 0) };
    };

    const place = () => {
      if (!follow) return;
      const spot = clusterSpot(follow);
      root.position.set(spot.position[0], spot.position[1], spot.position[2]);
      root.lookAt(spot.eye[0], spot.eye[1], spot.eye[2]);
    };

    const fade = (to: number) => {
      const from = opacity;
      motionOf(app.world).tween({
        key: 'session-controls/fade',
        ms: DURATION.fade,
        onUpdate: (k) => setOpacity(from + (to - from) * k),
      });
    };

    const syncMode = () => {
      if (app.mode.value === 'flat') {
        follow = null;
        motionOf(app.world).cancel('session-controls/fade');
        setOpacity(0);
        return;
      }
      follow = startFollow(head());
      place();
      fade(1);
    };

    const offs = [
      app.mode.subscribe(syncMode),
      app.settings.lang.subscribe(() => {
        recentreButton.set({ label: say(SESSION, lang(), 'recentre') });
        exitButton.set({ label: say(SESSION, lang(), 'exit'), hint: say(SESSION, lang(), 'hold') });
      }),
      onLookFrame(app.world, (dt) => {
        if (!follow) return;
        stepFollow(follow, head(), dt);
        place();
        exitButton.tick(dt * 1000);
      }),
    ];
    syncMode();
    // For scripts and tests: where the buttons are and what Exit is doing.
    root.userData.sessionControls = { recentre: recentreButton, exit: exitButton };

    return () => {
      for (const off of offs) off();
      motionOf(app.world).cancel(TWEEN_KEY);
      recentreButton.dispose();
      exitButton.dispose();
      dropEntities(app.world, root);
    };
  },
};
