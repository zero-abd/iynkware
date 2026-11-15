/**
 * Fly in the room (issue #122): the course mapped into a 3 x 3 m volume in front of the person, the craft in it,
 * flown with the controller thumbsticks on the flight core. The person never moves; only the mapping places the craft.
 * While in the range the bench is hidden (a stopgap until the bench pillar hides its own content).
 */
import { BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial, Quaternion, Vector3, type Object3D } from '@iwsdk/core';
import { loadDrone as loadDroneContent } from '@/content/index.generated';
import { flightOf, lapClock, startMode, type Sticks } from '@/lib/flight';
import type { FeatureModule, XrApp } from '../../../contracts/app';
import type { Unsubscribe } from '../../../contracts/common';
import { headingOf, type Heading } from '../../../input/helpers';
import { dropEntities } from '../../../shell/kit';
import { movable } from '../../../ui/panels';
import { rangeOf } from '../../activate';
import { bindPlate, dropIn, fadeIn, INK, langOf, loadFlightText, onLookFrame, plateButton, textLabel, type Plate, type TextLabel } from '../../shared';
import { loadDrone } from '../../shared';
import {
  controllerExpo,
  createRunner,
  mapCourse,
  newControllerFrame,
  readController,
  roomVolume,
  type ControllerFrame,
  type FlightRunner,
  type RunnerEvent,
} from '../core';
import { courseChoiceOf, pickCourse, pickerOpenOf } from '../picker/model';
import { flightSceneOf, type FlightScene } from '../scene';
import { drawCourse, type CourseDrawing } from './course';
import {
  buildThatFlies,
  crashText,
  craftPose,
  createTrail,
  newPose,
  propRpm,
  readoutLines,
  refusedByRule,
  refusedText,
  type FlyingBuild,
} from './model';
import { ROOM_STRINGS as S } from './strings';

/** Plates stand this far ahead of the head, this far below it and this far to the left. */
const PLATE_AHEAD_M = 0.45;
const PLATE_BELOW_M = 0.38;
const PLATE_LEFT_M = 0.3;
const PLATE_GAP_M = 0.125;
/** The readout is redrawn at most this often while nothing happens. */
const READOUT_S = 0.25;
const PROPS = ['prop:M1', 'prop:M2', 'prop:M3', 'prop:M4'] as const;

interface Session {
  readonly dispose: () => void;
}

export const roomModule: FeatureModule = {
  id: 'range/flight/room',
  mount(app) {
    let session: Session | null = null;
    let entering = false;
    let epoch = 0;
    const leave = () => {
      epoch++;
      entering = false;
      session?.dispose();
      session = null;
    };
    // what is flying: the craft and the chosen course; a change while in the Range leaves and enters again
    let flying = '';
    const keyOf = () => {
      const p = rangeOf(app).value;
      return `${p?.kind === 'drone' ? p.contentId : ''}|${courseChoiceOf(app).value ?? ''}`;
    };
    const sync = () => {
      const inRange = app.shell.place.value === 'range' && rangeOf(app).value?.kind === 'drone';
      if (inRange && (session || entering) && flying !== keyOf()) leave();
      if (inRange && !session && !entering) {
        flying = keyOf();
        const mine = ++epoch;
        entering = true;
        const head = headPose(app);
        void enter(app, head, () => mine === epoch)
          .then((s) => {
            if (!s) return;
            if (mine !== epoch) s.dispose();
            else session = s;
          })
          .finally(() => {
            if (mine === epoch) entering = false;
          });
      } else if (!inRange && (session || entering)) leave();
    };
    const offPlace = app.shell.place.subscribe(sync);
    const offRange = rangeOf(app).subscribe(sync);
    const offChoice = courseChoiceOf(app).subscribe(sync);
    sync();
    return () => {
      offChoice();
      offPlace();
      offRange();
      leave();
    };
  },
};

interface Head {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: Heading;
}

/** The head pose, once, as the person enters. */
function headPose(app: XrApp): Head {
  const p = new Vector3();
  const q = new Quaternion();
  app.world.camera.getWorldPosition(p);
  app.world.camera.getWorldQuaternion(q);
  const heading = headingOf(q.x, q.y, q.z, q.w, { fx: 0, fz: -1 });
  return { x: p.x, y: p.y, z: p.z, heading };
}

async function enter(app: XrApp, head: Head, alive: () => boolean): Promise<Session | null> {
  const project = rangeOf(app).value;
  if (project?.kind !== 'drone') return null;
  const content = await loadDroneContent(project.contentId as Parameters<typeof loadDroneContent>[0]);
  const flight = content ? flightOf(content) : null;
  if (!content || !flight || !alive()) return null;
  const course = pickCourse(flight.courses, courseChoiceOf(app).value)!;
  const build: FlyingBuild = buildThatFlies(content, app.project.doc);
  const volume = roomVolume(head.x, head.z, head.heading);
  const map = mapCourse(volume, course.field, course.ceiling ?? flight.craft.ceiling, course.pad);
  const runner: FlightRunner = createRunner(flight.craft, course, build.calc, { mode: startMode(content, course.id), faults: build.faults });
  const drone = await loadDrone(project.contentId);
  const flightText = await loadFlightText(langOf(app));
  if (!alive()) {
    drone?.dispose();
    return null;
  }

  const disposers: Unsubscribe[] = [];
  const root = new Group();
  root.name = 'range-room';
  app.world.scene.add(root);
  disposers.push(() => dropEntities(app.world, root));

  // the bench steps aside while the room flies
  const benchRoot = app.bench.root, benchTable = app.bench.table;
  const wasVisible = [benchRoot.visible, benchTable.visible];
  benchRoot.visible = false;
  benchTable.visible = false;
  disposers.push(() => {
    benchRoot.visible = wasVisible[0]!;
    benchTable.visible = wasVisible[1]!;
  });

  // the course, fading in and dropping onto the floor
  const drawing: CourseDrawing = drawCourse(map, course);
  const stage = new Group();
  stage.add(drawing.group);
  root.add(stage);
  disposers.push(() => drawing.dispose());
  drawing.setOpacity(0);
  fadeIn(app.world, drawing.setOpacity, { onDone: () => drawing.setOpacity(1) });
  dropIn(app.world, stage, { height: 0.05 });
  drawing.setNext(course.gates.length ? 0 : null);

  // the craft
  const span = drone ? drone.sidecar.bounds.max[0] - drone.sidecar.bounds.min[0] : 0.285;
  if (drone) {
    drone.object.rotation.order = 'YXZ';
    root.add(drone.object);
    disposers.push(() => drone.dispose());
  }
  const pose = newPose();

  // a short ink trail, 2 s of the path, in one preallocated buffer
  const trail = createTrail();
  const trailGeometry = new BufferGeometry();
  const trailAttr = new BufferAttribute(trail.positions, 3);
  trailGeometry.setAttribute('position', trailAttr);
  const trailMaterial = new LineBasicMaterial({ color: INK, transparent: true, opacity: 0.55 });
  const trailLine = new Line(trailGeometry, trailMaterial);
  trailLine.frustumCulled = false;
  trailLine.name = 'range-trail';
  root.add(trailLine);
  disposers.push(() => {
    trailGeometry.dispose();
    trailMaterial.dispose();
  });

  // the readout, world-locked beside the volume, turned towards where the person stood
  const label: TextLabel = textLabel(1.7, 0.6, { role: 'label', maxLines: 6, align: 'left' });
  const { rx, rz, fx, fz } = volume;
  const lateral = volume.left + 0.55, ahead = volume.far - 0.15;
  label.mesh.position.set(head.x + lateral * rx + ahead * fx, 1.0, head.z + lateral * rz + ahead * fz);
  label.mesh.lookAt(head.x, 1.0, head.z);
  label.mesh.name = 'range-readout';
  root.add(label.mesh);
  disposers.push(() => {
    label.dispose();
    dropEntities(app.world, label.mesh);
  });
  // The shared grip bar under the readout moves it (ui/panels).
  const grip = movable(app, { id: 'range/readout', group: label.mesh, width: 1.7, height: 0.6, distanceM: 2.2, z: 0.004 });
  disposers.push(() => grip.dispose());

  // the plates: Arm, Reset, Back, standing a little to the person's left at chest height
  const plates = new Group();
  plates.name = 'range-plates';
  plates.position.set(head.x + PLATE_AHEAD_M * fx - PLATE_LEFT_M * rx, head.y - PLATE_BELOW_M, head.z + PLATE_AHEAD_M * fz - PLATE_LEFT_M * rz);
  plates.rotation.y = Math.atan2(-fx, -fz);
  root.add(plates);
  const lang = () => langOf(app);
  const makePlate = (name: string, slot: number, icon: 'run' | 'reset' | 'close' | 'restart', primary: boolean, label: string): Plate => {
    const p = plateButton(app, { w: 0.11, d: 0.055, standing: true, primary }, { icon, label, lang: lang() });
    p.group.name = `room:${name}`;
    p.group.position.x = slot * PLATE_GAP_M;
    plates.add(p.group);
    disposers.push(() => {
      p.dispose();
      dropEntities(app.world, p.group);
    });
    return p;
  };
  const armPlate = makePlate('arm', 0, 'run', true, S.t(lang(), 'arm'));
  const resetPlate = makePlate('reset', 1, 'reset', false, S.t(lang(), 'reset'));
  const backPlate = makePlate('back', 2, 'close', false, S.t(lang(), 'back'));
  const craftPlate = makePlate('craft', 3, 'restart', false, S.t(lang(), 'craft'));
  dropIn(app.world, plates, { height: 0.04 });

  // what the label says
  let message = drone ? S.t(lang(), 'ready') : S.t(lang(), 'noCraft');
  let flightMessages = flightText;
  let dirty = true;
  let sinceReadout = 0;
  const say = (text: string) => {
    message = text;
    dirty = true;
  };
  const refreshPlates = () => {
    armPlate.set({ label: S.t(lang(), runner.frame.armed ? 'disarm' : 'arm'), lang: lang() });
    resetPlate.set({ label: S.t(lang(), 'reset'), lang: lang() });
    backPlate.set({ label: S.t(lang(), 'back'), lang: lang() });
    craftPlate.set({ label: S.t(lang(), 'craft'), lang: lang() });
  };
  let shownArmed = false;
  const offLang = app.settings.lang.subscribe((l) => {
    void loadFlightText(l).then((m) => {
      flightMessages = m;
      refreshPlates();
      dirty = true;
    });
  });
  disposers.push(offLang);

  const onEvent = (e: RunnerEvent) => {
    const l = lang();
    switch (e.type) {
      case 'armed':
        say(S.t(l, 'armed'));
        break;
      case 'disarmed':
        say(S.t(l, 'disarmed'));
        break;
      case 'blocked':
        say(refusedText(e.why, l));
        break;
      case 'gate':
        say(S.t(l, 'gatePassed', { n: e.index + 1, total: e.total }));
        app.input.pulse('right', 0.4, 60);
        break;
      case 'lap':
        say(S.t(l, e.best ? 'lapBest' : 'lapDone', { time: e.time.toFixed(2) }));
        break;
      case 'crash':
        say(crashText(flightMessages, e.why, l));
        app.input.pulse('right', 0.9, 160);
        app.input.pulse('left', 0.9, 160);
        break;
      case 'net':
        say(S.t(l, 'net'));
        break;
      default:
        break;
    }
  };
  disposers.push(runner.onEvent(onEvent));

  // the actions, shared by the plates and the controller buttons
  const arm = () => {
    if (!drone) return;
    if (!runner.frame.armed && build.refusal) return say(refusedByRule(build.refusal, lang()));
    runner.toggleArm();
  };
  const reset = () => {
    if (!drone) return;
    runner.reset();
    trail.reset(pose.x, pose.y, pose.z);
    drawing.setNext(course.gates.length ? 0 : null);
    say(S.t(lang(), 'reseated'));
  };
  disposers.push(bindPlate(app, armPlate, 'range/room/arm', arm));
  disposers.push(bindPlate(app, resetPlate, 'range/room/reset', reset));
  disposers.push(bindPlate(app, backPlate, 'range/room/back', () => void app.shell.go('bench')));
  disposers.push(bindPlate(app, craftPlate, 'range/room/craft', () => pickerOpenOf(app).set(!pickerOpenOf(app).value)));

  // the sticks: a claim wins (the hand rings, a guide), else the thumbsticks, read afresh every frame (`readController`)
  const claims: Array<{ owner: string; read: (out: Sticks) => void }> = [];
  const pad: ControllerFrame = newControllerFrame();
  const sticks: Sticks = { throttle: 0.5, yaw: 0, pitch: 0, roll: 0 };
  let expoMode = '';
  let expo = 0;
  const expoNow = (): number => {
    if (runner.mode !== expoMode) {
      expoMode = runner.mode;
      expo = controllerExpo(flight.craft.modes.find((m) => m.id === expoMode));
    }
    return expo;
  };

  const scene: FlightScene | null = drone
    ? {
        contentId: project.contentId,
        content,
        spec: flight.craft,
        course,
        build: { source: build.source, faults: build.faults },
        runner,
        volume,
        map,
        head,
        root,
        craft: drone,
        arm,
        reset,
        say,
        claimSticks(owner, read) {
          const i = claims.findIndex((c) => c.owner === owner);
          if (i >= 0) claims.splice(i, 1);
          const claim = { owner, read };
          claims.push(claim);
          return () => {
            const at = claims.indexOf(claim);
            if (at >= 0) claims.splice(at, 1);
          };
        },
      }
    : null;
  if (scene) {
    flightSceneOf(app).set(scene);
    disposers.push(() => {
      if (flightSceneOf(app).value === scene) flightSceneOf(app).set(null);
    });
  }
  // for scripts and tests: the flight and what the label says
  root.userData.flight = scene;
  root.userData.readout = () => message;
  root.userData.build = build.source;

  let lastGate = -1;
  disposers.push(
    onLookFrame(app.world, (dt) => {
      if (!drone) {
        if (dirty) label.set(`${S.t(lang(), 'noCraft')}`);
        dirty = false;
        return;
      }
      readController(app.input, 2, expoNow(), pad);
      if (pad.arm) arm();
      if (pad.reset) reset();
      const claim = claims[claims.length - 1];
      if (claim) claim.read(sticks);
      else Object.assign(sticks, pad.sticks);
      runner.setSticks(sticks);
      runner.tick(dt);
      const f = runner.frame;

      craftPose(map, f, span, pose);
      const o: Object3D = drone.object;
      o.position.set(pose.x, pose.y, pose.z);
      o.rotation.set(pose.rx, pose.ry, pose.rz, 'YXZ');
      o.scale.setScalar(pose.scale);
      const rpm = propRpm(f.thr, f.armed);
      for (let i = 0; i < PROPS.length; i++) drone.set(PROPS[i]!, rpm);
      drone.update(dt);

      if (trail.tick(dt, pose.x, pose.y, pose.z)) trailAttr.needsUpdate = true;
      drawing.showNet(map.netFace(f.x, f.y, f.z));
      if (f.gate !== lastGate) {
        lastGate = f.gate;
        drawing.setNext(course.gates.length ? f.gate % course.gates.length : null);
      }
      if (f.armed !== shownArmed) {
        shownArmed = f.armed;
        refreshPlates();
        dirty = true;
      }
      sinceReadout += dt;
      if (dirty || sinceReadout >= READOUT_S) {
        sinceReadout = 0;
        dirty = false;
        label.set(
          readoutLines({
            lang: lang(),
            flight: flightMessages,
            source: build.source,
            mode: runner.mode,
            perCell: f.perCell,
            low: f.low,
            gate: f.gate,
            gates: course.gates.length,
            lap: lapClock(runner.session.sim),
            message,
          }).join('\n'),
        );
      }
    }),
  );
  // the first frame in place before anything moves
  runner.tick(0);
  craftPose(map, runner.frame, span, pose);
  trail.reset(pose.x, pose.y, pose.z);

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const d of disposers.splice(0).reverse()) {
        try {
          d();
        } catch (e) {
          console.warn('range room: a part did not dispose', e);
        }
      }
    },
  };
}
