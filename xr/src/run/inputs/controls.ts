/**
 * The three controls a hand works while the run is live: a button (held down while a fingertip or ray holds it), a slide
 * switch (a select flips it) and a pot (pinch or grip it and roll the wrist, or drag a ray sideways). Each binds a hit
 * block at the part's `control:` anchor, sends the input through the host, and moves the sidecar's `press:` or `turn:`
 * node with eased motion when the asset has one.
 */
import { BoxGeometry, Mesh, MeshBasicMaterial, Quaternion, Vector3, type BufferGeometry } from '@iwsdk/core';
import type { Hand, InteractionEvent } from '../../contracts/input';
import { runFeedback } from '../kit/feedback';
import { clamp01, crossedTenth, knobPos, limiter, twistAbout } from './map';
import { mover, PRESS_MS, RELEASE_MS, STATE_MS, type Host, type LivePart, type Piece } from './shared';
import { inputStrings as S } from './strings';

let blockGeometry: BufferGeometry | null = null;
let hiddenMaterial: MeshBasicMaterial | null = null;

/**
 * A hit block at the control: not drawn (its material is off), so it costs no draw call, but rays and fingertips find it.
 * Never at the size of a real 6 mm cap: a block under 12 mm is too small to poke.
 */
function hitBlock(part: LivePart): Mesh {
  blockGeometry ??= new BoxGeometry(1, 1, 1);
  hiddenMaterial ??= new MeshBasicMaterial({ visible: false });
  const mesh = new Mesh(blockGeometry, hiddenMaterial);
  const w = Math.max(0.012, Math.min(part.size[0], 0.03));
  const d = Math.max(0.012, Math.min(part.size[1], 0.03));
  mesh.scale.set(w, 0.014, d);
  mesh.position.set(part.controlAt[0], part.controlAt[1] - 0.003, part.controlAt[2]);
  mesh.name = 'input-hit';
  part.object.add(mesh);
  return mesh;
}

function dropBlock(mesh: Mesh): void {
  mesh.removeFromParent();
}

export function buttonPiece(host: Host, part: LivePart): Piece {
  const { app } = host;
  const fb = runFeedback(app);
  const node = mover(app, part, 'press:');
  const hit = hitBlock(part);
  const down = new Set<number>();
  let pressed = false;
  const set = (on: boolean, e: InteractionEvent | null) => {
    if (on === pressed) return;
    pressed = on;
    host.send(part.id, 'pressed', on);
    node?.to(on ? 1 : 0, on ? PRESS_MS : RELEASE_MS);
    if (on) fb.play('ui-press', e?.point, e);
    else fb.play('ui-hover', e?.point, e);
  };
  const off = app.input.bind(hit, { id: `input:${part.id}`, ray: true, poke: true }, (e) => {
    if (!host.live()) return;
    switch (e.type) {
      case 'hover-start':
        host.hover(part, true);
        break;
      case 'hover-end':
        host.hover(part, false);
        down.delete(e.pointer.id);
        if (down.size === 0) set(false, e);
        break;
      case 'select-start':
        down.add(e.pointer.id);
        set(true, e);
        break;
      case 'select-end':
        down.delete(e.pointer.id);
        if (down.size === 0) set(false, e);
        break;
      default:
        break;
    }
  });
  return {
    reset() {
      down.clear();
      pressed = false;
      node?.set(0);
    },
    dispose() {
      off();
      node?.dispose();
      dropBlock(hit);
    },
  };
}

export function switchPiece(host: Host, part: LivePart, rest: number): Piece {
  const { app } = host;
  const fb = runFeedback(app);
  const node = mover(app, part, 'press:', rest) ?? mover(app, part, 'turn:', rest);
  const hit = hitBlock(part);
  let closed = rest > 0 ? 1 : 0;
  const off = app.input.bind(hit, { id: `input:${part.id}`, ray: true, poke: true }, (e) => {
    if (!host.live()) return;
    if (e.type === 'hover-start') host.hover(part, true);
    else if (e.type === 'hover-end') host.hover(part, false);
    else if (e.type === 'select') {
      closed = closed ? 0 : 1;
      host.send(part.id, 'closed', closed);
      node?.to(closed, STATE_MS);
      fb.play('ui-press', e.point, e);
      host.chip(part, S.t(app.settings.lang.value, closed ? 'switchOn' : 'switchOff'));
    }
  });
  node?.set(closed);
  return {
    reset() {
      closed = rest > 0 ? 1 : 0;
      node?.set(closed);
    },
    dispose() {
      off();
      node?.dispose();
      dropBlock(hit);
    },
  };
}

/** One knob turn in flight. Reused: nothing is allocated per frame. */
interface Turn {
  active: boolean;
  id: number;
  hand: Hand | null;
  start: number;
  /** The grip's orientation and roll axis when the turn began. */
  q0: Quaternion;
  inv0: Quaternion;
  axis: Vector3;
  point0: Vector3;
  point: Vector3;
  hasPoint: boolean;
  right: Vector3;
}

const dq = new Quaternion();
const q = new Quaternion();
const fwd = new Vector3();

export function potPiece(host: Host, part: LivePart, rest: number): Piece {
  const { app } = host;
  const node = mover(app, part, 'turn:', rest);
  const hit = hitBlock(part);
  const lim = limiter(0.005, undefined, rest);
  const turn: Turn = {
    active: false,
    id: -1,
    hand: null,
    start: rest,
    q0: new Quaternion(),
    inv0: new Quaternion(),
    axis: new Vector3(0, 0, -1),
    point0: new Vector3(),
    point: new Vector3(),
    hasPoint: false,
    right: new Vector3(1, 0, 0),
  };
  let pos = rest;
  let sent = rest;

  const gripOf = (hand: Hand | null) => (hand ? app.world.player?.gripSpaces?.[hand] : undefined);

  const begin = (e: InteractionEvent) => {
    if (turn.active) return;
    turn.active = true;
    turn.id = e.pointer.id;
    turn.hand = e.pointer.hand;
    turn.start = pos;
    turn.hasPoint = false;
    const grip = gripOf(turn.hand);
    if (grip) {
      grip.getWorldQuaternion(turn.q0);
      turn.inv0.copy(turn.q0).invert();
      turn.axis.set(0, 0, -1).applyQuaternion(turn.q0);
    }
    if (e.point) {
      turn.point0.set(e.point[0], e.point[1], e.point[2]);
      turn.point.copy(turn.point0);
      turn.hasPoint = true;
    }
    app.world.camera.getWorldDirection(fwd);
    turn.right.set(-fwd.z, 0, fwd.x);
    if (turn.right.lengthSq() < 1e-6) turn.right.set(1, 0, 0);
    turn.right.normalize();
    host.hover(part, true);
  };

  const end = () => {
    if (!turn.active) return;
    turn.active = false;
    host.hover(part, false);
    if (sent !== pos) {
      sent = pos;
      lim.force(pos, performance.now());
      host.send(part.id, 'pos', pos);
    }
  };

  const off = app.input.bind(hit, { id: `input:${part.id}`, ray: true, poke: false, grab: 'near' }, (e) => {
    if (!host.live()) return;
    switch (e.type) {
      case 'hover-start':
        if (!turn.active) host.hover(part, true);
        break;
      case 'hover-end':
        if (!turn.active) host.hover(part, false);
        break;
      case 'select-start':
      case 'grab-start':
        begin(e);
        break;
      case 'drag-move':
        if (turn.active && e.pointer.id === turn.id && e.point) {
          turn.point.set(e.point[0], e.point[1], e.point[2]);
          turn.hasPoint = true;
        }
        break;
      case 'select-end':
      case 'grab-end':
        if (turn.active && e.pointer.id === turn.id) end();
        break;
      default:
        break;
    }
  });

  // IWSDK moves a grabbed object with the hand; the knob stays where it is, so the hit block is put back each frame.
  const homeX = hit.position.x;
  const homeY = hit.position.y;
  const homeZ = hit.position.z;
  node?.set(pos);

  const apply = (next: number, nowMs: number) => {
    const prev = pos;
    pos = next;
    node?.set(pos);
    if (crossedTenth(prev, pos) && turn.hand) app.input.pulse(turn.hand, 0.2, 8);
    host.chip(part, S.t(app.settings.lang.value, 'knob', { v: Math.round(pos * 100) }));
    if (lim.take(pos, nowMs)) {
      sent = pos;
      host.send(part.id, 'pos', pos);
    }
  };

  return {
    tick(_dt, nowMs) {
      hit.position.set(homeX, homeY, homeZ);
      hit.quaternion.identity();
      if (!turn.active) {
        // A value held back by the rate limit goes out as soon as the window opens.
        if (sent !== pos && lim.settle(pos, nowMs)) {
          sent = pos;
          host.send(part.id, 'pos', pos);
        }
        return;
      }
      let roll = 0;
      const grip = gripOf(turn.hand);
      if (grip) {
        grip.getWorldQuaternion(q);
        dq.multiplyQuaternions(q, turn.inv0);
        roll = twistAbout(dq.x, dq.y, dq.z, dq.w, turn.axis.x, turn.axis.y, turn.axis.z);
      }
      let drag = 0;
      if (turn.hasPoint) {
        fwd.copy(turn.point).sub(turn.point0);
        drag = fwd.dot(turn.right);
      }
      const next = clamp01(knobPos(turn.start, roll, drag));
      if (Math.abs(next - pos) > 0.0005) apply(next, nowMs);
      else if (sent !== pos && lim.settle(pos, nowMs)) {
        sent = pos;
        host.send(part.id, 'pos', pos);
      }
    },
    reset() {
      turn.active = false;
      pos = rest;
      sent = rest;
      lim.reset();
      node?.set(rest);
    },
    dispose() {
      off();
      node?.dispose();
      dropBlock(hit);
    },
  };
}
