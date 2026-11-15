/**
 * A probe: an inked pen on a lead, shared by the multimeter's two probes and the scope's clip probe. It has the design's
 * four tool states (6.3): `racked` (lying in its slot), `held` (in a hand, near or far grab, with the nearest pin or
 * hole under the tip marked by a small ring and a snap cue), `parked` (let go over the bench: it settles onto the mat)
 * and `clipped` (let go on an anchor: it stands there, tip exactly on the pin or hole). Grabbing a clipped probe lifts
 * it. A far drop, or `putBack`, returns it to the rack.
 *
 * The group's origin is the tip and its +y is the barrel, so the tip is always where `group.position` says. The group is
 * a child of the bench table, so its position is in the table frame. Nothing allocates per frame.
 */
import { BufferAttribute, DoubleSide, Euler, Group, LatheGeometry, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, CylinderGeometry, Vector2, Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../../contracts/app';
import type { Hand, InteractionEvent } from '../../../contracts/input';
import type { Unsubscribe } from '../../../contracts/common';
import { ACCENT, BANDS, INK } from '../../../look/palette';
import { animated, MOTION, onTick, paintBands, inkSolid, runFeedback, type InkSolid, type RunLayout } from '../../kit';
import { createLead, type Lead } from './lead';
import { sameTarget, type ClipTarget } from './nets';
import type { AnchorIndex } from './anchors';
import { dropOutcome } from './snap';

export type ProbeState = 'racked' | 'held' | 'parked' | 'clipped';

/** Barrel length: the design's 0.12 m pen, tip included. */
const LENGTH = 0.12;
const RADIUS = 0.0062;
const TIP = 0.016;
/** Lying on the mat, the axis is a barrel radius above it. */
const LYING_Y = RADIUS + 0.0004;
/** A clipped probe leans this far from upright, towards the person. */
const CLIP_TILT = 0.45;

export interface ProbeOptions {
  /** Entity id for input events and the node name. */
  id: string;
  /** Body colour (three bands are derived). */
  hex: string;
  /** Lead colour. */
  leadHex: string;
  /** Where it lies on the rack, table frame (metres) and the yaw of the barrel. */
  rest(layout: RunLayout): { x: number; z: number; yaw: number };
  /** Where the lead leaves the meter or the scope, table frame: written into `out`. */
  jack(layout: RunLayout, out: Vector3): Vector3;
  /** Called when the state or the clipped target changed. */
  onChange(probe: Probe): void;
}

export interface Probe {
  readonly id: string;
  readonly group: Group;
  readonly state: ProbeState;
  /** What it is clipped on; null unless `clipped`. */
  readonly target: ClipTarget | null;
  /** The tip in the table frame (the group's position), written into `out`. */
  tipLocal(out: Vector3): Vector3;
  /** The tip in the world, written into `out`. */
  tipWorld(out: Vector3): Vector3;
  /** Back to its slot, eased. */
  putBack(): void;
  /** The rack moved (posture or hand changed): a racked probe follows. */
  setLayout(layout: RunLayout): void;
  dispose(): void;
}

/** The pen as one lathe: needle tip, a collar, the barrel, a rounded end. Origin at the tip, axis +y. */
function penGeometry(): LatheGeometry {
  const profile = [
    new Vector2(0, 0),
    new Vector2(0.0016, 0.006),
    new Vector2(0.0034, TIP),
    new Vector2(RADIUS * 0.8, TIP),
    new Vector2(RADIUS, TIP + 0.004),
    new Vector2(RADIUS, LENGTH - 0.006),
    new Vector2(RADIUS * 0.7, LENGTH - 0.001),
    new Vector2(0, LENGTH),
  ];
  return new LatheGeometry(profile, 12);
}

/** Paints the metal tip over the band colours of a pen: the vertices below `TIP` take the steel's bands. */
function steelTip(solid: InkSolid): void {
  const geo = solid.body.geometry;
  const steel = paintBands(geo.clone(), BANDS.steel.l);
  const from = steel.getAttribute('color') as BufferAttribute;
  const to = geo.getAttribute('color') as BufferAttribute;
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) <= TIP - 0.0005) to.setXYZ(i, from.getX(i), from.getY(i), from.getZ(i));
  }
  to.needsUpdate = true;
  steel.dispose();
}

const lyingQuat = (yaw: number, out: Quaternion): Quaternion => out.setFromEuler(new Euler(-Math.PI / 2, yaw, 0, 'YXZ'));
const clipQuat = new Quaternion().setFromEuler(new Euler(CLIP_TILT, 0, 0, 'YXZ'));

export function createProbe(app: XrApp, anchors: AnchorIndex, opts: ProbeOptions, initial: RunLayout): Probe {
  const fb = runFeedback(app);
  const group = new Group();
  group.name = opts.id;
  const solid = inkSolid(penGeometry(), opts.hex);
  steelTip(solid);
  solid.body.raycast = () => undefined;
  solid.outline.raycast = () => undefined;
  group.add(solid.group);
  // A fatter invisible hit volume: a 12 mm pen is hard to pinch, and a pin or hole wins over a part body anyway.
  const hitMaterial = new MeshBasicMaterial({ visible: false });
  const hit = new Mesh(new CylinderGeometry(0.011, 0.011, LENGTH * 0.9, 8, 1), hitMaterial);
  hit.position.y = LENGTH * 0.5;
  group.add(hit);

  const lead: Lead = createLead(opts.leadHex);
  const table = app.bench.table;
  table.add(group);
  table.add(lead.mesh);

  const ringMaterial = new MeshBasicMaterial({ color: ACCENT, side: DoubleSide, depthTest: false, transparent: true });
  const ringGeometry = new RingGeometry(0.0042, 0.0062, 20);
  ringGeometry.rotateX(-Math.PI / 2);
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.renderOrder = 6;
  ring.visible = false;
  ring.raycast = () => undefined;
  table.add(ring);

  let layout = initial;
  let state: ProbeState = 'racked';
  let target: ClipTarget | null = null;
  let heldBy: Hand | null = null;
  let candidate: ClipTarget | null = null;
  let follow = true;

  // The move from where it was to where it goes.
  const fromPos = new Vector3();
  const toPos = new Vector3();
  const fromQuat = new Quaternion();
  const toQuat = new Quaternion();
  const move = animated(app, 0, (t) => {
    group.position.lerpVectors(fromPos, toPos, t);
    group.quaternion.slerpQuaternions(fromQuat, toQuat, t);
  });
  const goTo = (position: Vector3, quaternion: Quaternion, ms: number = MOTION.settle) => {
    move.dispose();
    fromPos.copy(group.position);
    fromQuat.copy(group.quaternion);
    toPos.copy(position);
    toQuat.copy(quaternion);
    move.set(0);
    move.to(1, ms);
  };

  const scratch = new Vector3();
  const scratch2 = new Vector3();
  const jack = new Vector3();
  const end = new Vector3();
  const quat = new Quaternion();

  const restPose = () => {
    const r = opts.rest(layout);
    return { position: scratch2.set(r.x, LYING_Y, r.z), quaternion: lyingQuat(r.yaw, quat) };
  };

  const emit = () => opts.onChange(api);

  function toRack(animate: boolean) {
    const { position, quaternion } = restPose();
    state = 'racked';
    target = null;
    ring.visible = false;
    if (animate) goTo(position, quaternion);
    else {
      move.dispose();
      group.position.copy(position);
      group.quaternion.copy(quaternion);
    }
    emit();
  }

  /** Stands the probe on its anchor, eased (`animate`) or at once. */
  function clipTo(t: ClipTarget, animate: boolean): boolean {
    const w = anchors.worldOf(t);
    if (!w) return false;
    scratch.set(w[0], w[1], w[2]);
    table.worldToLocal(scratch);
    if (animate) goTo(scratch, clipQuat);
    else {
      move.dispose();
      group.position.copy(scratch);
      group.quaternion.copy(clipQuat);
    }
    return true;
  }

  const handler = (e: InteractionEvent) => {
    switch (e.type) {
      case 'hover-start':
        solid.setOutline(ACCENT);
        break;
      case 'hover-end':
        solid.setOutline(INK);
        break;
      case 'grab-start':
        move.dispose();
        if (state === 'clipped') fb.play('unclip', undefined, e);
        state = 'held';
        target = null;
        candidate = null;
        heldBy = e.pointer.hand;
        emit();
        break;
      case 'grab-end': {
        if (state !== 'held') break;
        ring.visible = false;
        const snapped = candidate;
        candidate = null;
        const p = group.position;
        const outcome = dropOutcome(snapped !== null, layout.top, p.x, p.y, p.z);
        if (outcome === 'clip' && snapped && clipTo(snapped, true)) {
          state = 'clipped';
          target = snapped;
          fb.play('clip', anchors.worldOf(snapped) ?? undefined, e);
        } else if (outcome === 'park') {
          state = 'parked';
          const r = opts.rest(layout);
          scratch2.set(clampTo(p.x, layout.top.w), LYING_Y, clampTo(p.z, layout.top.d));
          goTo(scratch2, lyingQuat(r.yaw, quat));
        } else {
          toRack(true);
          break;
        }
        heldBy = null;
        emit();
        break;
      }
      default:
        break;
    }
  };

  const unbind: Unsubscribe = app.input.bind(group, { id: opts.id, ray: true, poke: false, grab: 'both' }, handler);

  const offs: Unsubscribe[] = [
    // A clipped probe stays on its anchor when the layout, the board scale or the bench top changes.
    app.bench.onLayout(() => (follow = true)),
    app.bench.scale.subscribe(() => (follow = true)),
    app.bench.benchTop.subscribe(() => (follow = true)),
    onTick(app.world, () => {
      if (state === 'held') {
        group.updateWorldMatrix(true, false);
        group.getWorldPosition(scratch);
        const found = anchors.nearest(scratch.x, scratch.y, scratch.z);
        if (found === null) {
          if (candidate !== null) ring.visible = false;
          candidate = null;
        } else if (!sameTarget(found.target, candidate)) {
          candidate = { ...found.target };
          scratch.set(found.world[0], found.world[1] + 0.0015, found.world[2]);
          table.worldToLocal(scratch);
          ring.position.copy(scratch);
          ring.visible = true;
          fb.play('snap', found.world, heldBy);
        }
      } else if (state === 'clipped' && follow && target && move.value >= 1) {
        if (!clipTo(target, false)) toRack(true);
      }
      follow = false;
      group.updateMatrix();
      end.set(0, LENGTH, 0).applyMatrix4(group.matrix);
      lead.update(opts.jack(layout, jack), end);
    }),
  ];

  const api: Probe = {
    id: opts.id,
    group,
    get state() {
      return state;
    },
    get target() {
      return target;
    },
    tipLocal: (out) => out.copy(group.position),
    tipWorld(out) {
      group.updateWorldMatrix(true, false);
      return group.getWorldPosition(out);
    },
    putBack() {
      if (state === 'racked') return;
      toRack(true);
    },
    setLayout(next) {
      layout = next;
      if (state === 'racked') toRack(false);
    },
    dispose() {
      unbind();
      for (const off of offs) off();
      move.dispose();
      group.removeFromParent();
      lead.mesh.removeFromParent();
      ring.removeFromParent();
      solid.dispose();
      hit.geometry.dispose();
      hitMaterial.dispose();
      lead.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
    },
  };
  toRack(false);
  return api;
}

/** Keeps a parked probe on the bench top: within the edge, 2 cm in. */
function clampTo(v: number, size: number): number {
  const half = size / 2 - 0.02;
  return Math.max(-half, Math.min(half, v));
}
