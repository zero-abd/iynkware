/**
 * Hand flight (issue #123, XR_DESIGN 8.3): gimbal stick rings under a free pinch, the Arm hold plate, and Guide flight.
 * It reads `flightSceneOf` and claims the sticks only while a hand holds (so controllers fly again the moment hands
 * let go). The person never moves; everything stands in the room at the place the pinch or the plate is.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  SphereGeometry,
  TorusGeometry,
} from '@iwsdk/core';
import type { Sticks } from '@/lib/flight';
import type { FeatureModule, XrApp } from '../../../contracts/app';
import type { Hand } from '../../../contracts/input';
import { VIRTUAL_STICK_FULL_M, VIRTUAL_STICK_DEADZONE } from '../../../input/helpers';
import { ACCENT, dropIn, INK, inkSolid, langOf, onLookFrame, plateButton, type InkSolid, type Plate } from '../../shared';
import { bindPlate } from '../../shared';
import { clampTarget, guideSticks, guideSpeed, handSticks, type Out3 } from '../core';
import { flightSceneOf, type FlightScene } from '../scene';
import { ClaimGate, guideTarget, HoldTimer, PinchTrack, ringOffset } from './logic';
import { HANDS_STRINGS as S } from './strings';

const PLATE_AHEAD_M = 0.45;
const PLATE_BELOW_M = 0.38;
const PLATE_RIGHT_M = 0.3;
const PLATE_GAP_M = 0.085;
const PLATE_M = 0.064;
const OWNER = 'range/flight/hands';
const HALF_PI = Math.PI / 2;

type Mode = 'rings' | 'guide';

const ring = (radius: number, tube: number, hex: string): InkSolid => inkSolid(new TorusGeometry(radius, tube, 8, 40), hex, { outline: 0.0007 });
const dot = (radius: number, hex: string): InkSolid => inkSolid(new SphereGeometry(radius, 12, 8), hex, { outline: 0.0007 });

/** One hand's gimbal ring: the full-deflection ring, the dead-zone circle and the dot for the hand's offset. */
interface RingDraw {
  readonly root: Group;
  readonly tilt: Group;
  readonly dot: Group;
  dispose(): void;
}

function makeRing(hand: Hand): RingDraw {
  const root = new Group();
  root.name = `hands:ring-${hand}`;
  const tilt = new Group();
  // the left hand's plane stands facing the person (right and up); the right hand's lies flat (right and away)
  if (hand === 'right') tilt.rotation.x = -HALF_PI;
  root.add(tilt);
  const outer = ring(VIRTUAL_STICK_FULL_M, 0.0014, INK);
  const dead = ring(VIRTUAL_STICK_FULL_M * VIRTUAL_STICK_DEADZONE, 0.0008, INK);
  const d = dot(0.006, ACCENT);
  tilt.add(outer.group, dead.group, d.group);
  root.visible = false;
  return {
    root,
    tilt,
    dot: d.group,
    dispose() {
      outer.dispose();
      dead.dispose();
      d.dispose();
      root.removeFromParent();
    },
  };
}

interface Session {
  dispose(): void;
}

function start(app: XrApp, scene: FlightScene): Session {
  const off: Array<() => void> = [];
  const lang = () => langOf(app);
  const { head, map, runner } = scene;
  const fx = head.heading.fx, fz = head.heading.fz;
  const rx = -fz, rz = fx;
  const faceY = Math.atan2(-fx, -fz);

  // ---- plates: Arm (hold) and the Rings / Guide toggle, standing a little to the person's right
  const plates = new Group();
  plates.name = 'hands-plates';
  plates.position.set(head.x + PLATE_AHEAD_M * fx + PLATE_RIGHT_M * rx, head.y - PLATE_BELOW_M, head.z + PLATE_AHEAD_M * fz + PLATE_RIGHT_M * rz);
  plates.rotation.y = faceY;
  scene.root.add(plates);
  const makePlate = (name: string, slot: number, icon: 'run' | 'reset', label: string, primary: boolean): Plate => {
    const p = plateButton(app, { w: PLATE_M, d: PLATE_M, standing: true, primary }, { icon, label, lang: lang() });
    p.group.name = `hands:${name}`;
    p.group.position.x = slot * PLATE_GAP_M;
    plates.add(p.group);
    off.push(() => p.dispose());
    return p;
  };
  const armPlate = makePlate('arm', 0, 'run', S.t(lang(), 'armHold'), true);
  const modePlate = makePlate('mode', 1, 'reset', S.t(lang(), 'rings'), false);
  dropIn(app.world, plates, { height: 0.04 });

  let mode: Mode = 'rings';
  let shownArmed = false;
  const refresh = () => {
    shownArmed = runner.frame.armed;
    armPlate.set({ label: S.t(lang(), shownArmed ? 'disarm' : 'armHold'), lang: lang() });
    modePlate.set({ label: S.t(lang(), mode), lang: lang(), latched: mode === 'guide' });
  };
  refresh();
  off.push(app.settings.lang.subscribe(refresh));

  // hold to arm: a press starts the timer, letting go early does nothing
  const timer = new HoldTimer();
  off.push(
    app.input.bind(armPlate.hit, { id: 'range/hands/arm', ray: true, poke: true }, (e) => {
      switch (e.type) {
        case 'select-start':
          timer.press();
          armPlate.press(true);
          break;
        case 'select-end':
        case 'hover-end':
          timer.release();
          armPlate.press(false);
          armPlate.set({ progress: null });
          armPlate.hover(e.type === 'select-end');
          break;
        case 'hover-start':
          armPlate.hover(true);
          break;
        default:
          break;
      }
    }),
  );
  off.push(bindPlate(app, modePlate, 'range/hands/mode', () => setMode(mode === 'rings' ? 'guide' : 'rings')));

  // ---- the rings
  const rings: Record<Hand, RingDraw> = { left: makeRing('left'), right: makeRing('right') };
  for (const h of ['left', 'right'] as const) {
    scene.root.add(rings[h].root);
    off.push(() => rings[h].dispose());
  }
  const tracks: Record<Hand, PinchTrack> = { left: new PinchTrack(head.heading), right: new PinchTrack(head.heading) };
  const offset = { a: 0, b: 0 };

  // ---- guide: the target ring, a dot and a thin line to the craft
  const targetRoot = new Group();
  targetRoot.name = 'hands:guide-target';
  const targetTilt = new Group();
  targetTilt.rotation.x = -HALF_PI;
  const tRing = ring(0.05, 0.0015, INK);
  const tDot = dot(0.008, ACCENT);
  targetTilt.add(tRing.group);
  targetRoot.add(targetTilt, tDot.group);
  targetRoot.visible = false;
  scene.root.add(targetRoot);
  const linePos = new BufferAttribute(new Float32Array(6), 3);
  const lineGeo = new BufferGeometry();
  lineGeo.setAttribute('position', linePos);
  const lineMat = new LineBasicMaterial({ color: INK });
  const line = new Line(lineGeo, lineMat);
  line.frustumCulled = false;
  line.visible = false;
  scene.root.add(line);
  off.push(() => {
    tRing.dispose();
    tDot.dispose();
    targetRoot.removeFromParent();
    lineGeo.dispose();
    lineMat.dispose();
    line.removeFromParent();
    plates.removeFromParent();
  });

  const targetCourse: Out3 = [0, 0, 0];
  const targetWorld: Out3 = [0, 0, 0];
  const craftStart: Out3 = [0, 0, 0];
  const handStart: Out3 = [0, 0, 0];
  const handNow: Out3 = [0, 0, 0];
  let hasTarget = false;
  let guideHand: Hand | null = null;

  // ---- the claim: while a hand holds in rings, or a guide target stands
  const gate = new ClaimGate(() =>
    scene.claimSticks(OWNER, (out: Sticks) => {
      if (mode === 'rings') {
        handSticks(tracks.left.active ? tracks.left.pinch : null, tracks.right.active ? tracks.right.pinch : null, out);
      } else {
        guideSticks(runner.session.sim, targetCourse[0], targetCourse[1], targetCourse[2], guideSpeed(map.k), out);
      }
    }),
  );
  off.push(() => gate.set(false));

  function setMode(next: Mode): void {
    if (next === mode) return;
    mode = next;
    hasTarget = false;
    guideHand = null;
    targetRoot.visible = false;
    line.visible = false;
    gate.set(false);
    refresh();
  }

  const tick = (dt: number) => {
    // the Arm hold plate
    if (timer.held) {
      if (timer.tick(dt * 1000)) scene.arm();
      armPlate.set({ progress: timer.fired ? null : timer.progress });
    }
    if (runner.frame.armed !== shownArmed) refresh();

    const l = tracks.left.update(app.input.freeHold('left'));
    const r = tracks.right.update(app.input.freeHold('right'));

    if (mode === 'rings') {
      for (const h of ['left', 'right'] as const) {
        const t = tracks[h];
        const d = rings[h];
        if (!t.active) {
          d.root.visible = false;
          continue;
        }
        if (t.began) {
          d.root.position.set(t.origin[0], t.origin[1], t.origin[2]);
          d.root.rotation.y = faceY;
        }
        d.root.visible = true;
        ringOffset(t.pinch, h, offset);
        d.dot.position.set(offset.a, offset.b, 0);
      }
      gate.set(l !== null || r !== null);
      return;
    }

    // guide: one hand's free pinch drags the target, starting at the craft
    rings.left.root.visible = false;
    rings.right.root.visible = false;
    if (guideHand && !tracks[guideHand].active) guideHand = null;
    if (!guideHand) {
      const next: Hand | null = tracks.left.active ? 'left' : tracks.right.active ? 'right' : null;
      if (next) {
        guideHand = next;
        const o = scene.craft.object.position;
        craftStart[0] = o.x;
        craftStart[1] = o.y;
        craftStart[2] = o.z;
        handStart[0] = tracks[next].origin[0];
        handStart[1] = tracks[next].origin[1];
        handStart[2] = tracks[next].origin[2];
        if (!hasTarget) {
          map.toCourse(o.x, o.y, o.z, targetCourse);
          clampTarget(targetCourse[0], targetCourse[1], targetCourse[2], map.field, map.ceiling, targetCourse);
        }
        hasTarget = true;
      }
    }
    if (guideHand) {
      const p = tracks[guideHand].point;
      handNow[0] = p[0];
      handNow[1] = p[1];
      handNow[2] = p[2];
      guideTarget(map, craftStart, handStart, handNow, targetCourse, targetWorld);
    } else if (hasTarget) {
      map.toRoom(targetCourse[0], targetCourse[1], targetCourse[2], targetWorld);
    }
    // controllers fly again when neither hand is a hand
    if (hasTarget && !guideHand) {
      const s = app.input.sources.value;
      if (s.left !== 'hand' && s.right !== 'hand') {
        hasTarget = false;
      }
    }
    targetRoot.visible = hasTarget;
    line.visible = hasTarget;
    if (hasTarget) {
      targetRoot.position.set(targetWorld[0], targetWorld[1], targetWorld[2]);
      const o = scene.craft.object.position;
      linePos.setXYZ(0, o.x, o.y, o.z);
      linePos.setXYZ(1, targetWorld[0], targetWorld[1], targetWorld[2]);
      linePos.needsUpdate = true;
    }
    gate.set(hasTarget);
  };
  off.push(onLookFrame(app.world, tick));

  // for scripts and tests
  scene.root.userData.hands = {
    mode: () => mode,
    claimed: () => gate.claimed,
    target: () => (hasTarget ? targetCourse.slice() : null),
    held: () => timer.held,
  };

  let done = false;
  return {
    dispose() {
      if (done) return;
      done = true;
      delete scene.root.userData.hands;
      for (const d of off.splice(0).reverse()) d();
    },
  };
}

export const handsModule: FeatureModule = {
  id: 'range/flight/hands',
  mount(app) {
    let session: Session | null = null;
    let current: FlightScene | null = null;
    const sync = (scene: FlightScene | null) => {
      if (scene === current) return;
      current = scene;
      session?.dispose();
      session = scene ? start(app, scene) : null;
    };
    const unsubscribe = flightSceneOf(app).subscribe(sync);
    sync(flightSceneOf(app).value);
    return () => {
      unsubscribe();
      session?.dispose();
      session = null;
    };
  },
};
