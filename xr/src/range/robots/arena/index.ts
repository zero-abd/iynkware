/**
 * The robot arena (issue #126): a physics robot's arena on the real floor at 1:1, its near edge 1.0 m ahead of the head
 * at entry, the robot drawn from the sim's mech frames (interpolated between them), a dashed trail of its last 5 s, a
 * readout and Run, Stop and Back plates. The programs drive; the person never moves. While in the range the bench is
 * hidden.
 */
import { Group, Quaternion, Vector3, type Object3D } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../../contracts/app';
import type { Unsubscribe } from '../../../contracts/common';
import type { MechStatus, RunState } from '../../../contracts/sim';
import { headingOf, type Heading } from '../../../input/helpers';
import { rangeOf } from '../../activate';
import { bindPlate, dropIn, fadeIn, langOf, onLookFrame, plateButton, textLabel, type Plate, type TextLabel } from '../../shared';
import { drawArena, type ArenaDrawing } from './draw';
import { arenaOf, createPoseTrack, createTrail, placeArena, readoutLines, TRAIL_LIFT_M } from './model';
import { ARENA_STRINGS as S } from './strings';

const PLATE_AHEAD_M = 0.45;
const PLATE_BELOW_M = 0.38;
const PLATE_LEFT_M = 0.3;
const PLATE_GAP_M = 0.125;
const READOUT_S = 0.2;

interface Session {
  readonly dispose: () => void;
}

/** The doc each sim was last loaded with by this arena, so Run does not load twice. */
const loadedDoc = new WeakMap<object, string>();

export const arenaModule: FeatureModule = {
  id: 'range/robots/arena',
  mount(app) {
    let session: Session | null = null;
    let sessionDoc = '';
    const leave = () => {
      session?.dispose();
      session = null;
      sessionDoc = '';
    };
    const sync = () => {
      const inRange = app.shell.place.value === 'range' && rangeOf(app).value?.kind === 'robot';
      if (inRange && session && sessionDoc !== app.project.doc.id) leave();
      if (inRange && !session) {
        session = enter(app, headPose(app));
        sessionDoc = session ? app.project.doc.id : '';
      } else if (!inRange && session) leave();
    };
    const offPlace = app.shell.place.subscribe(sync);
    const offRange = rangeOf(app).subscribe(sync);
    const offDoc = app.project.subscribe(() => {
      if (session && sessionDoc !== app.project.doc.id) sync();
    });
    sync();
    return () => {
      offPlace();
      offRange();
      offDoc();
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

function headPose(app: XrApp): Head {
  const p = new Vector3();
  const q = new Quaternion();
  app.world.camera.getWorldPosition(p);
  app.world.camera.getWorldQuaternion(q);
  return { x: p.x, y: p.y, z: p.z, heading: headingOf(q.x, q.y, q.z, q.w, { fx: 0, fz: -1 }) };
}

function enter(app: XrApp, head: Head): Session | null {
  const doc = app.project.doc;
  const spec = arenaOf(doc);
  if (!spec) return null;
  const disposers: Unsubscribe[] = [];
  const lang = () => langOf(app);

  const root = new Group();
  root.name = 'range-arena-room';
  app.world.scene.add(root);
  // The input service gives every ancestor of a bound plate an entity, and IWSDK puts an entity's object back under its
  // parent whenever it is removed, so a plain removeFromParent leaves the room and its plates standing. Destroying the
  // entities of this room's own objects, children first, takes them out for good.
  let everything: Object3D[] = [];
  disposers.push(() => {
    for (const o of everything.reverse()) {
      const idx = (o as Object3D & { entityIdx?: number }).entityIdx;
      const entity = idx === undefined ? undefined : app.world.entityManager.getEntityByIndex(idx);
      if (entity?.active && entity.object3D === o) entity.destroy();
      o.removeFromParent();
    }
    everything = [];
  });

  // the bench steps aside while the arena runs
  const benchRoot = app.bench.root, benchTable = app.bench.table;
  const wasVisible = [benchRoot.visible, benchTable.visible];
  benchRoot.visible = false;
  benchTable.visible = false;
  disposers.push(() => {
    benchRoot.visible = wasVisible[0]!;
    benchTable.visible = wasVisible[1]!;
  });

  // the arena, fading in and dropping onto the floor
  const place = placeArena(spec, head);
  const poses = createPoseTrack(spec.bodies, spec.chassis);
  const chassisAt = Math.max(0, spec.bodies.findIndex((b) => b.id === spec.chassis));
  const trail = createTrail();
  const drawing: ArenaDrawing = drawArena(spec, place, trail);
  const stage = new Group();
  stage.add(drawing.group);
  root.add(stage);
  disposers.push(() => drawing.dispose());
  drawing.setOpacity(0);
  fadeIn(app.world, drawing.setOpacity, { onDone: () => drawing.setOpacity(1) });
  dropIn(app.world, stage, { height: 0.05 });

  // the readout stands behind the far edge, turned towards where the person stood
  const { rx, rz, fx, fz } = place;
  const label: TextLabel = textLabel(1.5, 0.42, { role: 'label', maxLines: 5, align: 'left' });
  const behind = 1.0 + spec.depth + 0.15;
  label.mesh.position.set(head.x + behind * fx, 0.55, head.z + behind * fz);
  label.mesh.lookAt(head.x, 0.55, head.z);
  label.mesh.name = 'range-arena-readout';
  root.add(label.mesh);
  disposers.push(() => label.dispose());

  // the plates: Run, Stop, Back, standing a little to the person's left at chest height
  const plates = new Group();
  plates.name = 'range-arena-plates';
  plates.position.set(head.x + PLATE_AHEAD_M * fx - PLATE_LEFT_M * rx, head.y - PLATE_BELOW_M, head.z + PLATE_AHEAD_M * fz - PLATE_LEFT_M * rz);
  plates.rotation.y = Math.atan2(-fx, -fz);
  root.add(plates);
  const makePlate = (name: string, slot: number, icon: 'run' | 'stop' | 'close', primary: boolean, text: string): Plate => {
    const p = plateButton(app, { w: 0.11, d: 0.055, standing: true, primary }, { icon, label: text, lang: lang() });
    p.group.name = `arena:${name}`;
    p.group.position.x = slot * PLATE_GAP_M;
    plates.add(p.group);
    disposers.push(() => p.dispose());
    return p;
  };
  const runPlate = makePlate('run', 0, 'run', true, S.t(lang(), 'run'));
  const stopPlate = makePlate('stop', 1, 'stop', false, S.t(lang(), 'stop'));
  const backPlate = makePlate('back', 2, 'close', false, S.t(lang(), 'back'));
  dropIn(app.world, plates, { height: 0.04 });
  const refreshPlates = () => {
    runPlate.set({ label: S.t(lang(), 'run'), lang: lang() });
    stopPlate.set({ label: S.t(lang(), 'stop'), lang: lang() });
    backPlate.set({ label: S.t(lang(), 'back'), lang: lang() });
  };

  // the sim: the physics state, the run state and the frames
  const sim = app.sim;
  let alive = true;
  disposers.push(() => (alive = false));
  let mech: MechStatus | null = sim.lastMech ? { state: 'ready' } : null;
  let runState: RunState = sim.state;
  let message = '';
  let dirty = true;
  let now = 0;
  let sinceReadout = 0;
  disposers.push(
    sim.onMechState((s) => {
      mech = s;
      dirty = true;
    }),
    sim.onState((s) => {
      runState = s;
      dirty = true;
    }),
    sim.onMech((f) => {
      if (poses.push(f, now)) trail.reset(poses.pose[chassisAt * 4]!, poses.pose[chassisAt * 4 + 1]!, TRAIL_LIFT_M);
    }),
  );
  if (sim.lastMech) poses.push(sim.lastMech, now);

  let loading: Promise<boolean> | null = null;
  const ensureLoaded = (): Promise<boolean> => {
    if (loadedDoc.get(sim) === doc.id && sim.state !== 'unloaded' && sim.state !== 'error' && sim.lastMech) return Promise.resolve(true);
    loading ??= sim
      .load(doc)
      .then((r) => {
        if (!r.ok) {
          const why = r.diagnostics.find((d) => d.severity === 'error')?.id ?? 'refused';
          if (alive) message = S.t(lang(), 'loadRefused', { why });
          return false;
        }
        loadedDoc.set(sim, doc.id);
        if (alive) message = '';
        return true;
      })
      .catch(() => false)
      .finally(() => {
        loading = null;
        dirty = true;
      });
    return loading;
  };
  const run = async () => {
    if (!(await ensureLoaded()) || !alive) return;
    if (sim.state !== 'running') await sim.run();
  };
  const stop = async () => {
    if (sim.state !== 'unloaded' && sim.state !== 'error') await sim.stop();
  };
  disposers.push(bindPlate(app, runPlate, 'range/arena/run', () => void run()));
  disposers.push(bindPlate(app, stopPlate, 'range/arena/stop', () => void stop()));
  disposers.push(bindPlate(app, backPlate, 'range/arena/back', () => void app.shell.go('bench')));
  const offLang = app.settings.lang.subscribe(() => {
    refreshPlates();
    dirty = true;
  });
  disposers.push(offLang);
  void ensureLoaded();

  everything = [];
  root.traverse((o) => everything.push(o));

  // for scripts and tests
  root.userData.arena = {
    spec,
    place,
    poses,
    trail,
    run,
    stop,
    bodies: drawing.bodies,
    readout: () => label.mesh.userData.text ?? '',
    status: () => ({ mech, run: runState, simS: poses.simS }),
  };

  const place3 = (i: number) => {
    const k = i * 4;
    const o = drawing.bodies[i]!;
    o.position.set(poses.pose[k]!, poses.pose[k + 1]!, poses.pose[k + 2]!);
    o.rotation.z = poses.pose[k + 3]!;
  };
  const place0 = () => {
    for (let i = 0; i < drawing.bodies.length; i++) place3(i);
  };
  place0();
  trail.reset(poses.pose[chassisAt * 4]!, poses.pose[chassisAt * 4 + 1]!, TRAIL_LIFT_M);
  disposers.push(
    onLookFrame(app.world, (dt) => {
      now += dt;
      poses.sample(now);
      place0();
      if (poses.hasFrame && trail.tick(dt, poses.pose[chassisAt * 4]!, poses.pose[chassisAt * 4 + 1]!, TRAIL_LIFT_M)) drawing.trailAttr.needsUpdate = true;
      sinceReadout += dt;
      if (dirty || sinceReadout >= READOUT_S) {
        sinceReadout = 0;
        dirty = false;
        const text = readoutLines({ lang: lang(), mech, run: runState, simS: poses.simS, sensors: sim.lastMech?.sensors, message }).join('\n');
        if (label.mesh.userData.text !== text) {
          label.mesh.userData.text = text;
          label.set(text);
        }
      }
    }),
  );

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const d of disposers.splice(0).reverse()) {
        try {
          d();
        } catch (err) {
          console.error('[arena] dispose', err);
        }
      }
    },
  };
}
