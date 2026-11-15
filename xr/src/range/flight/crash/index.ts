/**
 * The crash freeze, card and slow-motion replay with its timeline (issue #124, XR_DESIGN 8.3 "Crash" and "Replay").
 *
 * The room's runner freezes the craft for 300 ms where it hit, then holds `crashed`. This module watches the runner
 * each frame: an ink ring opens at the crash point during the freeze, the crash card (a paper plate with what it hit,
 * the impact speed in room m/s, the fix, and the plates Replay, Reset, Why and Fix on bench) opens above it turned
 * towards where the person stood, and Replay opens the runner's replay: a see-through ghost craft driven by a
 * `ReplayClock` at a third of real time along a dotted trail, with a timeline under the card (marks, a playhead to
 * drag by pinch or trigger, Play, Pause, Close). A reset (the card's, or Y) ends it all. The person's view never
 * moves; everything is world-locked in the room and nothing is allocated per frame.
 */
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Points, PointsMaterial, RingGeometry, Vector3, type Object3D } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../../contracts/app';
import type { Unsubscribe } from '../../../contracts/common';
import type { InteractionEvent } from '../../../contracts/input';
import { ACCENT, bindPlate, hexNum, INK, inkSolid, langOf, loadDrone, loadFlightText, motionOf, onLookFrame, panelOpen, plateButton, roundedSlab, textLabel, type InkSolid, type Plate, type TextLabel } from '../../shared';
import { dropEntities } from '../../../shell/kit';
import { movable } from '../../../ui/panels';
import { ReplayClock, type ReplayWindow, type RunnerFrame } from '../core';
import { benchFocusOf } from '../focus';
import { craftPose, modeTitle, newPose, propRpm } from '../room/model';
import { flightSceneOf, type FlightScene } from '../scene';
import { cardLines, labelRows, markLabel, partOfFault, timeAtX, timelineX } from './model';
import { CRASH_STRINGS as S } from './strings';

const CARD_W = 0.4;
const CARD_H = 0.24;
const CARD_ABOVE_M = 0.4;
const CARD_MIN_Y = 0.75;
/** Furthest the card stands from the person; a crash beyond it brings the card in along the line to the person. */
const CARD_REACH_M = 1.5;
const TRACK_W = 0.4;
const TRACK_Y = -0.33;
const RING_M = 0.3;
const MAX_DOTS = 128;
const PROPS = ['prop:M1', 'prop:M2', 'prop:M3', 'prop:M4'] as const;

type Flight = Readonly<Record<string, unknown>>;

/** A flat inked slab standing in the card's plane (faces +z). */
function slab(w: number, h: number, t: number, hex: string): InkSolid {
  return inkSolid(roundedSlab(w, h, t, Math.min(w, h) * 0.3).rotateX(Math.PI / 2), hex);
}

function openCrash(app: XrApp, scene: FlightScene): { dispose(): void } {
  const { runner, map, head, root } = scene;
  const disposers: Unsubscribe[] = [];
  let disposed = false;
  const lang = () => langOf(app);
  let flight: Flight = {};
  let why = false;
  let win: ReplayWindow | null = null;
  let cardShown = false;
  let clock: ReplayClock | null = null;
  const out: [number, number, number] = [0, 0, 0];

  const group = new Group();
  group.name = 'range-crash';
  group.visible = false;
  root.add(group);
  // Binding gave the plates, the grip and their plain ancestors IWSDK entities: destroy them, or IWSDK parents the card
  // under the level root, where it outlives the Range (shell/kit/entity.ts).
  disposers.push(() => dropEntities(app.world, group));

  // ---- the ring ----
  const ringMat = new MeshBasicMaterial({ color: hexNum(INK), transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
  const ring = new Mesh(new RingGeometry(RING_M / 2 - 0.012, RING_M / 2, 48), ringMat);
  ring.name = 'range-crash-ring';
  ring.visible = false;
  group.add(ring);
  disposers.push(() => {
    ring.geometry.dispose();
    ringMat.dispose();
  });

  // ---- the card ----
  const card = new Group();
  card.name = 'range-crash-card';
  card.visible = false;
  group.add(card);
  const label: TextLabel = textLabel(CARD_W, CARD_H, { role: 'body', maxLines: 7, align: 'left' });
  label.mesh.name = 'range-crash-text';
  card.add(label.mesh);
  disposers.push(() => label.dispose());
  const labelMat = label.mesh.material as MeshBasicMaterial;
  // The shared grip bar moves it (ui/panels); on the top edge, clear of the plates and the timeline under the card.
  const grip = movable(app, { id: 'range/crash', group: card, width: CARD_W, height: CARD_H, distanceM: 1.5, edge: 'top', z: 0.004 });
  disposers.push(() => grip.dispose());

  const plates: Plate[] = [];
  const mk = (id: string, x: number, y: number, icon: 'run' | 'reset' | 'pause' | 'fail' | null, key: Parameters<typeof S.t>[1], act: () => void, primary = false): Plate => {
    const p = plateButton(app, { w: 0.095, d: 0.055, standing: true, primary }, { icon, label: S.t(lang(), key), lang: lang() });
    p.group.name = `crash:${id}`;
    p.group.position.set(x, y, 0.004);
    card.add(p.group);
    plates.push(p);
    disposers.push(() => p.dispose());
    disposers.push(bindPlate(app, p, `range/crash/${id}`, act));
    return p;
  };
  const PLATE_Y = -CARD_H / 2 - 0.085;
  const replayPlate = mk('replay', -0.2, PLATE_Y, 'run', 'replay', () => startReplay(), true);
  const resetPlate = mk('reset', -0.1, PLATE_Y, 'reset', 'reset', () => scene.reset());
  const whyPlate = mk('why', 0, PLATE_Y, null, 'why', () => {
    why = !why;
    redraw();
  });
  // Close: the card goes away for this crash (the next crash shows it again). Every optional window can be closed.
  let dismissed: ReplayWindow | null = null;
  const dismissPlate = mk('dismiss', 0.2, PLATE_Y, 'fail', 'close', () => {
    closeReplay();
    dismissed = win;
    hideAll();
  });
  const fixPlate = mk('fix', 0.1, PLATE_Y, null, 'fix', () => {
    const part = fixPart();
    if (!part) return;
    benchFocusOf(app).set(part);
    void app.shell.go('bench');
  });

  // ---- the timeline ----
  const tl = new Group();
  tl.name = 'range-crash-timeline';
  tl.visible = false;
  card.add(tl);
  const badge: TextLabel = textLabel(TRACK_W, 0.028, { role: 'caption', maxLines: 1 });
  badge.mesh.position.set(0, TRACK_Y + 0.085, 0.004);
  tl.add(badge.mesh);
  disposers.push(() => badge.dispose());
  const track = slab(TRACK_W, 0.012, 0.008, '#e4ddcf');
  track.group.position.set(0, TRACK_Y, 0);
  tl.add(track.group);
  disposers.push(() => track.dispose());
  const head3 = slab(0.012, 0.055, 0.012, ACCENT);
  head3.group.position.set(0, TRACK_Y, 0.008);
  tl.add(head3.group);
  disposers.push(() => head3.dispose());
  // a taller, invisible plane to aim at: the track itself is a hair thin
  const hitMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const hit = new Mesh(new PlaneGeometry(TRACK_W + 0.03, 0.07), hitMat);
  hit.position.set(0, TRACK_Y, 0.012);
  hit.name = 'range-crash-scrub';
  tl.add(hit);
  disposers.push(() => {
    hit.geometry.dispose();
    hitMat.dispose();
  });
  let marks: Array<{ tick: InkSolid; label: TextLabel }> = [];
  const clearMarks = () => {
    for (const m of marks) {
      m.tick.dispose();
      m.label.dispose();
    }
    marks = [];
  };
  disposers.push(clearMarks);
  const TL_Y = TRACK_Y - 0.14;
  const playPlate = mk('play', -0.1, TL_Y, 'run', 'play', () => clock?.play());
  const pausePlate = mk('pause', 0, TL_Y, 'pause', 'pause', () => clock?.pause());
  const closePlate = mk('close', 0.1, TL_Y, 'fail', 'close', () => closeReplay());
  for (const p of [playPlate, pausePlate, closePlate]) {
    tl.add(p.group);
  }

  // scrubbing: where the pointer's ray crosses the track's plane, as a time in the window
  const p0 = new Vector3(), n = new Vector3(), o = new Vector3(), d = new Vector3(), at = new Vector3();
  const scrub = (e: InteractionEvent) => {
    if (!clock || !win) return;
    if (e.type !== 'select-start' && e.type !== 'drag-move' && e.type !== 'select') return;
    track.group.updateWorldMatrix(true, false);
    const m = track.group.matrixWorld;
    let ok = false;
    if (e.pointer.mode === 'ray') {
      p0.setFromMatrixPosition(m);
      n.set(0, 0, 1).transformDirection(m);
      o.set(e.pointer.origin[0], e.pointer.origin[1], e.pointer.origin[2]);
      d.set(e.pointer.direction[0], e.pointer.direction[1], e.pointer.direction[2]);
      const den = n.dot(d);
      if (Math.abs(den) > 1e-4) {
        const s = n.dot(p0.sub(o)) / den;
        at.copy(o).addScaledVector(d, s);
        ok = true;
      }
    }
    if (!ok) {
      const q = e.point ?? e.pointer.origin;
      at.set(q[0], q[1], q[2]);
    }
    track.group.worldToLocal(at);
    clock.scrub(timeAtX(at.x, clock.duration, TRACK_W));
  };
  disposers.push(app.input.bind(hit, { id: 'range/crash/scrub', ray: true, poke: true }, scrub));

  // ---- the ghost and its trail ----
  let ghost: Awaited<ReturnType<typeof loadDrone>> = null;
  let span = 0.285;
  const trailPos = new Float32Array(MAX_DOTS * 3);
  const trailGeo = new BufferGeometry();
  const trailAttr = new BufferAttribute(trailPos, 3);
  trailGeo.setAttribute('position', trailAttr);
  const trailMat = new PointsMaterial({ color: hexNum(INK), size: 0.014, sizeAttenuation: true, toneMapped: false });
  const trail = new Points(trailGeo, trailMat);
  trail.frustumCulled = false;
  trail.visible = false;
  trail.name = 'range-crash-trail';
  group.add(trail);
  disposers.push(() => {
    trailGeo.dispose();
    trailMat.dispose();
  });
  void loadDrone(scene.contentId).then((g) => {
    if (!g) return;
    if (disposed) return g.dispose();
    ghost = g;
    span = g.sidecar.bounds.max[0] - g.sidecar.bounds.min[0];
    g.object.rotation.order = 'YXZ';
    g.object.visible = false;
    g.object.name = 'range-crash-ghost';
    g.seeThrough(1);
    group.add(g.object);
    disposers.push(() => g.dispose());
  });

  // ---- state ----
  const partIds = scene.craft.sidecar.parts.map((p) => p.id).filter((id) => id !== '');
  const fixPart = (): string | null => {
    const fix = win?.fix;
    return fix?.kind === 'fault' ? partOfFault(fix.fault, partIds) : null;
  };

  function redraw(): void {
    if (!win) return;
    const l = lang();
    label.set(cardLines({ win, k: map.k, flight, lang: l, modeTitle: (m) => modeTitle(flight, m), why }).join('\n'));
    replayPlate.set({ label: S.t(l, 'replay'), lang: l, disabled: false });
    resetPlate.set({ label: S.t(l, 'reset'), lang: l });
    whyPlate.set({ label: S.t(l, 'why'), lang: l, latched: why });
    fixPlate.set({ label: S.t(l, 'fix'), lang: l });
    dismissPlate.set({ label: S.t(l, 'close'), lang: l });
    fixPlate.group.visible = fixPart() !== null;
    playPlate.set({ label: S.t(l, 'play'), lang: l });
    pausePlate.set({ label: S.t(l, 'pause'), lang: l });
    closePlate.set({ label: S.t(l, 'close'), lang: l });
    badge.set(S.t(l, 'badge'));
    marks.forEach((m, i) => m.label.set(markLabel(win!.marks[i]!, l)));
  }

  const loadText = (l: ReturnType<typeof lang>) =>
    void loadFlightText(l).then((m) => {
      if (disposed || l !== lang()) return;
      flight = m;
      redraw();
    });
  loadText(lang());
  disposers.push(app.settings.lang.subscribe((l) => loadText(l)));

  /** A new crash: ring, card position and the timeline's marks. */
  function show(w: ReplayWindow): void {
    win = w;
    why = false;
    cardShown = false;
    const f = w.frames[w.at]!;
    map.toRoom(f.x, f.y, f.z, out);
    const [x, y, z] = out;
    ring.position.set(x, y, z);
    ring.lookAt(head.x, head.y, head.z);
    ring.visible = true;
    ringMat.opacity = 0;
    motionOf(app.world).tween({
      key: ring,
      ms: 260,
      onUpdate: (k) => {
        ring.scale.setScalar(0.4 + 0.6 * k);
        ringMat.opacity = 0.9 * k;
      },
    });
    // 0.4 m above the crash point; a crash far from the person (the net) brings the card in to CARD_REACH_M so it reads
    const dist = Math.hypot(head.x - x, head.z - z);
    const pull = dist > CARD_REACH_M ? CARD_REACH_M / dist : 1;
    const cx = head.x + (x - head.x) * pull, cz = head.z + (z - head.z) * pull;
    card.position.set(cx, Math.max(y + CARD_ABOVE_M, CARD_MIN_Y), cz);
    card.rotation.y = Math.atan2(head.x - cx, head.z - cz);
    card.scale.setScalar(Math.min(1.5, Math.max(1, Math.hypot(head.x - cx, head.z - cz))));
    // the timeline's marks
    clearMarks();
    const xs = w.marks.map((m) => timelineX(m.t, w.duration, TRACK_W));
    const rows = labelRows(xs, 0.1, 2);
    marks = w.marks.map((m, i) => {
      const tick = slab(0.005, 0.034, 0.006, INK);
      tick.group.position.set(xs[i]!, TRACK_Y, 0.004);
      tl.add(tick.group);
      const lab = textLabel(0.1, 0.022, { role: 'caption', maxLines: 1 });
      lab.mesh.position.set(Math.min(TRACK_W / 2 - 0.05, Math.max(-TRACK_W / 2 + 0.05, xs[i]!)), TRACK_Y + (rows[i] === 0 ? 0.05 : -0.05), 0.004);
      tl.add(lab.mesh);
      return { tick, label: lab };
    });
    // the dotted path of the replay, in the one preallocated buffer
    const stride = Math.max(1, Math.ceil(w.frames.length / MAX_DOTS));
    let dots = 0;
    for (let i = 0; i < w.frames.length && dots < MAX_DOTS; i += stride) {
      const g = w.frames[i]!;
      map.toRoom(g.x, g.y, g.z, out);
      trailPos[dots * 3] = out[0];
      trailPos[dots * 3 + 1] = out[1];
      trailPos[dots * 3 + 2] = out[2];
      dots++;
    }
    trailGeo.setDrawRange(0, dots);
    trailAttr.needsUpdate = true;
    redraw();
  }

  function hideAll(): void {
    if (ghost) ghost.object.visible = false;
    trail.visible = false;
    tl.visible = false;
    card.visible = false;
    ring.visible = false;
    group.visible = false;
    motionOf(app.world).cancel(ring);
    clock = null;
    win = null;
    cardShown = false;
  }

  function startReplay(): void {
    if (!win) return;
    if (runner.phase === 'crashed' && runner.openReplay()) clock = new ReplayClock(win);
    else if (clock) {
      clock.scrub(0);
      clock.play();
    }
  }
  function closeReplay(): void {
    if (runner.phase === 'replay') runner.closeReplay();
    clock = null;
  }

  // ---- the frame ----
  const pose = newPose();
  const scratch = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 } as RunnerFrame;
  const xButton = app.input.button('left', 'lower');
  disposers.push(
    onLookFrame(app.world, (dt) => {
      const phase = runner.phase;
      const w = runner.crash;
      // Only in the Range, and not once closed: a crash card never follows the person to the bench or a lab.
      const away = app.shell.place.value !== 'range';
      if (!w || w === dismissed || away || (phase !== 'frozen' && phase !== 'crashed' && phase !== 'replay')) {
        if (win) hideAll();
        return;
      }
      if (w !== win) {
        group.visible = true;
        show(w);
      }
      if (phase !== 'frozen' && !cardShown) {
        cardShown = true;
        panelOpen(app.world, card, (a) => (labelMat.opacity = a));
      }
      if (xButton.down && cardShown) startReplay();
      const replaying = phase === 'replay';
      if (replaying && !clock) clock = new ReplayClock(w);
      if (!replaying && clock) clock = null;
      tl.visible = replaying;
      trail.visible = replaying;
      if (ghost) ghost.object.visible = replaying;
      if (!replaying || !clock) return;
      const s = clock.tick(dt);
      const a = w.frames[s.index]!;
      const b = w.frames[Math.min(w.frames.length - 1, s.index + 1)]!;
      const k = s.frac;
      scratch.x = a.x + (b.x - a.x) * k;
      scratch.y = a.y + (b.y - a.y) * k;
      scratch.z = a.z + (b.z - a.z) * k;
      scratch.yaw = a.yaw + ((((b.yaw - a.yaw + 540) % 360) - 180) * k);
      scratch.pitch = a.pitch + (b.pitch - a.pitch) * k;
      scratch.roll = a.roll + (b.roll - a.roll) * k;
      head3.group.position.x = timelineX(s.t, clock.duration, TRACK_W);
      if (ghost) {
        craftPose(map, scratch, span, pose);
        const g: Object3D = ghost.object;
        g.position.set(pose.x, pose.y, pose.z);
        g.rotation.set(pose.rx, pose.ry, pose.rz, 'YXZ');
        g.scale.setScalar(pose.scale);
        const rpm = propRpm(a.thr, true);
        for (let i = 0; i < PROPS.length; i++) ghost.set(PROPS[i]!, rpm);
        ghost.update(dt * clock.speed);
      }
    }),
  );

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const d of disposers.splice(0).reverse()) d();
    },
  };
}

export const crashModule: FeatureModule = {
  id: 'range/flight/crash',
  mount(app) {
    const slot = flightSceneOf(app);
    let session: { dispose(): void } | null = null;
    const sync = () => {
      session?.dispose();
      session = null;
      const scene = slot.value;
      if (scene) session = openCrash(app, scene);
    };
    const off = slot.subscribe(sync);
    sync();
    return () => {
      off();
      session?.dispose();
      session = null;
    };
  },
};
