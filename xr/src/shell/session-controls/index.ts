/**
 * Session controls: Home, Reset, Recentre and Exit, four inked buttons in a row, in every mode and every project, shown only
 * inside a session. The cluster is fixed in the room: when the session starts it is put once about 48 degrees to the
 * person's left, 0.85 m from the eyes and just above eye level, beside the companion (`CLUSTER` in `spot.ts`), turned
 * to face them, and it never follows the head or body after that. It carries the shared grip bar (`ui/panels`): pinch it or ray and
 * trigger it to move the cluster; it stays where it is let go, after a reload too, and the menu's Tidy up puts it back.
 *
 *   Home      opens Home in front of the person from anywhere (the bench, Room size, the Range), closing whatever
 *             shell panel is open; pressed while Home is open, it brings Home round to where the person now looks.
 *   Reset     stops whatever runs (a drone flying, the Range, a circuit run, a lab) and opens a new empty workbench,
 *             from anywhere, without leaving the session (the project that was open stays in Projects).
 *   Recentre  puts the bench (and everything anchored to it) in front of the person again with an eased move, through
 *             `BenchSpace.setBenchTop`, at the height and distance of XR_DESIGN.md 2.1. At Room size or in the Range,
 *             which place their own content from the head when they open, it leaves and re-enters the place. It also
 *             brings this cluster back to its default place beside the person, so it can never be lost in the room.
 *             "In front" is the way the person faces, not the way they turned to reach the button: a press while
 *             looking at the cluster uses the heading held before (`headingTracker` in `spot.ts`).
 *   Exit      ends the immersive session, behind a 700 ms hold with a filling ring (a tap only shows "Hold").
 *
 * All are bound through `app.input`, so hands (poke, pinch) and controllers (ray, trigger) work alike.
 */
import { Group, Vector3 } from '@iwsdk/core';
import type { Unsubscribe } from '../../contracts/common';
import type { FeatureModule, XrApp } from '../../contracts/app';
import { DURATION, easeIynk } from '../../look/motion';
import { motionOf, onLookFrame } from '../../look/runner';
import { dmm } from '../../look/type';
import { movable, panelPlacesOf } from '../../ui/panels';
import { dropEntities, ownEntity } from '../kit/entity';
import { say } from '../copy';
import { sessionButton, type SessionButton } from './button';
import { SESSION } from './copy';
import { lerpPose, recentreTarget, type BenchPose } from './recentre';
import { CLUSTER, clusterHome, headingTracker, yawOfForward } from './spot';
import { newProject } from '../switch';

/** How long Exit must be held, ms (the design's Arm hold is 600 ms; leaving the headset is rarer, so a little longer). */
export const EXIT_HOLD_MS = 700;
/** Each button and the gap between them, dmm at the cluster's distance (a generous ray target, labels on one line). */
export const BUTTON_DMM = { w: 150, h: 118, gap: 14 } as const;
/** The grip's stored-place id (`ui/panels`). */
export const CONTROLS_ID = 'shell/session-controls';
/** Frames and time to wait after entering before the cluster is placed (the headset pose arrives after the start). */
const SETTLE_FRAMES = 4;
const SETTLE_MS = 300;
/** The cluster is always findable: farther than this from the eyes, or this far behind the heading, for `LOST_S`, it comes back. */
const LOST_M = 2.5;
const LOST_RAD = (150 * Math.PI) / 180;
const LOST_S = 2;
const TWEEN_KEY = 'session-controls/recentre';

const eye = new Vector3();
const dir = new Vector3();
const at = new Vector3();

/** Opens Home ahead of the person, from anywhere. Exported for the emulator walk. */
export function goHome(app: XrApp): void {
  // Closing first makes Home place itself again where the person looks now (it places only when it opens). A place
  // the person once dragged Home to would win over that and can be behind them, or follow the bench out of view (in
  // the Range the bench is hidden), so it is forgotten: the Home button always brings Home in front of the person.
  panelPlacesOf(app).store.forget('shell/home');
  if (app.shell.homeOpen.value) app.shell.closeHome();
  app.shell.openHome();
}

/**
 * Recentres the bench from the current head pose, facing `headingYaw` when given (bench convention; the head's own
 * heading otherwise); returns the target. Exported for the emulator walk.
 */
export function recentre(app: XrApp, headingYaw?: number): BenchPose {
  const cam = app.world.camera;
  cam.updateMatrixWorld(true);
  cam.getWorldPosition(eye);
  cam.getWorldDirection(dir);
  if (headingYaw !== undefined) dir.set(-Math.sin(headingYaw), 0, -Math.cos(headingYaw));
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
    const d = CLUSTER.distance;
    const W = dmm(BUTTON_DMM.w, d);
    const H = dmm(BUTTON_DMM.h, d);
    const GAP = dmm(BUTTON_DMM.gap, d);
    const lang = () => app.settings.lang.value;
    const root = new Group();
    root.name = 'session-controls';
    root.visible = false;
    ownEntity(app.world, root);

    /**
     * Puts the cluster at its default place beside the person as they stand and face now (or facing `headingYaw`),
     * turned to them.
     */
    const placeHome = (headingYaw?: number) => {
      const cam = app.world.camera;
      cam.updateMatrixWorld(true);
      cam.getWorldPosition(eye);
      cam.getWorldDirection(dir);
      if (headingYaw !== undefined) dir.set(-Math.sin(headingYaw), 0, -Math.cos(headingYaw));
      const yaw = yawOfForward(dir.x, dir.z, app.bench.benchTop.value.yawRad);
      const p = clusterHome([eye.x, eye.y, eye.z], [dir.x, dir.y, dir.z], yaw);
      root.position.set(p.position[0], p.position[1], p.position[2]);
      root.lookAt(eye);
      heading.reset(yaw);
    };

    // Where the person faces, not where they turned to reach these buttons (spot.ts, `headingTracker`).
    const heading = headingTracker(app.bench.benchTop.value.yawRad);
    const looks = () => {
      const cam = app.world.camera;
      cam.updateMatrixWorld(true);
      cam.getWorldPosition(eye);
      cam.getWorldDirection(dir);
      const head = yawOfForward(dir.x, dir.z, NaN);
      root.getWorldPosition(at);
      const cluster = root.visible ? yawOfForward(at.x - eye.x, at.z - eye.z, NaN) : NaN;
      return { head: Number.isNaN(head) ? null : head, cluster: Number.isNaN(cluster) ? null : cluster };
    };

    const homeButton: SessionButton = sessionButton(
      app,
      { id: 'session/home', w: W, h: H, distanceM: d, icon: 'home', onSelect: () => goHome(app) },
      { label: say(SESSION, lang(), 'home') },
    );
    const resetButton: SessionButton = sessionButton(
      app,
      { id: 'session/reset', w: W, h: H, distanceM: d, icon: 'reset', onSelect: () => void newProject(app) },
      { label: say(SESSION, lang(), 'reset') },
    );
    const recentreButton: SessionButton = sessionButton(
      app,
      {
        id: 'session/recentre',
        w: W,
        h: H,
        distanceM: d,
        icon: 'target',
        onSelect: () => {
          const l = looks();
          const yaw = l.head === null ? undefined : heading.heading(l.head, l.cluster);
          recentre(app, yaw);
          // The cluster comes back beside the person too, whatever place it was moved to.
          grip.forget();
          placeHome(yaw);
        },
      },
      { label: say(SESSION, lang(), 'recentre') },
    );
    const exitButton: SessionButton = sessionButton(
      app,
      { id: 'session/exit', w: W, h: H, distanceM: d, icon: 'exit', hold: { ms: EXIT_HOLD_MS, onDone: () => app.world.exitXR() } },
      { label: say(SESSION, lang(), 'exit'), hint: say(SESSION, lang(), 'hold') },
    );
    const row = [homeButton, resetButton, recentreButton, exitButton];
    row.forEach((b, i) => (b.group.position.x = (i - (row.length - 1) / 2) * (W + GAP)));
    root.add(...row.map((b) => b.group));
    // The shared grip bar under the row moves the whole cluster (ui/panels); its place is kept per id.
    const grip = movable(app, { id: CONTROLS_ID, group: root, width: row.length * W + (row.length - 1) * GAP, height: H, distanceM: d });

    let opacity = 0;
    let lost = 0;
    const setOpacity = (a: number) => {
      opacity = a;
      homeButton.setOpacity(a);
      resetButton.setOpacity(a);
      recentreButton.setOpacity(a);
      exitButton.setOpacity(a);
      grip.setOpacity(a);
      root.visible = a > 0.001;
    };
    setOpacity(0);

    const fade = (to: number) => {
      const from = opacity;
      motionOf(app.world).tween({
        key: 'session-controls/fade',
        ms: DURATION.fade,
        onUpdate: (k) => setOpacity(from + (to - from) * k),
      });
    };

    // Placed once per session, from where the person stands and faces once the headset pose has arrived.
    let inSession = false;
    let placed = false;
    let stopWait: Unsubscribe | null = null;
    const syncMode = () => {
      if (app.mode.value === 'flat') {
        inSession = false;
        placed = false;
        stopWait?.();
        stopWait = null;
        motionOf(app.world).cancel('session-controls/fade');
        setOpacity(0);
        return;
      }
      if (inSession) return;
      inSession = true;
      let frames = 0;
      const since = performance.now();
      stopWait = onLookFrame(app.world, () => {
        if (++frames < SETTLE_FRAMES || performance.now() - since < SETTLE_MS) return;
        stopWait?.();
        stopWait = null;
        placeHome();
        placed = true;
        fade(1);
      });
    };

    const offs = [
      app.mode.subscribe(syncMode),
      app.settings.lang.subscribe(() => {
        homeButton.set({ label: say(SESSION, lang(), 'home') });
        resetButton.set({ label: say(SESSION, lang(), 'reset') });
        recentreButton.set({ label: say(SESSION, lang(), 'recentre') });
        exitButton.set({ label: say(SESSION, lang(), 'exit'), hint: say(SESSION, lang(), 'hold') });
      }),
      onLookFrame(app.world, (dt) => {
        if (!placed) return;
        const l = looks();
        if (l.head !== null) heading.update(l.head, l.cluster, dt);
        // Fixed in the room, only turned to keep facing the person (a moved place is turned by ui/panels as well).
        app.world.camera.getWorldPosition(eye);
        // Always findable: lost far away or behind the person for a moment, it comes back beside them.
        root.getWorldPosition(at);
        const far = at.distanceTo(eye) > LOST_M;
        const behind = l.head !== null && l.cluster !== null && Math.abs(Math.atan2(Math.sin(l.cluster - l.head), Math.cos(l.cluster - l.head))) > LOST_RAD;
        lost = far || behind ? lost + dt : 0;
        if (lost > LOST_S) {
          lost = 0;
          grip.forget();
          placeHome();
        }
        root.visible = opacity > 0.001;
        root.lookAt(eye);
        exitButton.tick(dt * 1000);
      }),
    ];
    syncMode();
    // For scripts and tests: where the buttons are and what Exit is doing.
    root.userData.sessionControls = { home: homeButton, reset: resetButton, recentre: recentreButton, exit: exitButton, grip };

    return () => {
      for (const off of offs) off();
      stopWait?.();
      motionOf(app.world).cancel(TWEEN_KEY);
      homeButton.dispose();
      resetButton.dispose();
      recentreButton.dispose();
      exitButton.dispose();
      grip.dispose();
      dropEntities(app.world, root);
    };
  },
};
