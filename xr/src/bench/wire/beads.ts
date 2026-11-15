/**
 * Wire end beads (design 5, "Edit and remove"; 3.1 target 3): every wire end carries a small inked bead, the Dupont
 * tip, sitting on the wire just above its pin or hole and above the cell's height band, so a pinch on the bead is the
 * bead and a pinch lower on the cell still starts a new wire. Grab one (pinch hold near or on the ray, grip near, trigger
 * hold on the ray) and that end lifts: the wire is drawn live from the kept end to the hand (the pending wire), the drawn
 * wire hides, and the router's ring shows the cell it would land on. Release on a ringed cell moves the end
 * (`moveWireEnd`, one undo), off any cell pulls the wire out (`removeWire`, one undo), B or Y cancels. Under
 * `BEADS_ALWAYS_MAX` wires every bead shows; above that only those of the hovered or selected wire.
 *
 * The beads and their colliders are rebuilt on `onLayout` and scale change, never per frame.
 */
import { BoxGeometry, CylinderGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3, type Material, type Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe, Vec3 } from '../../contracts/common';
import type { Hand, InteractionEvent } from '../../contracts/input';
import type { CalloutTone } from '../../look/callout';
import { inkKit, loadInk, paintBands, type InkKit } from '../../look/ink';
import { ACCENT, BANDS, hexNum } from '../../look/palette';
import { onLookFrame } from '../../look/runner';
import { endLabel } from '@/studio/rules/connect';
import type { WireEndRef } from '@/studio/rules/connect';
import type { Wire, WireEnd } from '@/project/generated/types';
import { breadboardViewOf, moveWireEnd, refusalText, removeWire } from '../core/actions';
import { CELL_BAND_WORK_M } from '../core/cells';
import { createPressTracker, createTrackingLoss, type PressTracker, type TrackingLoss } from '../core/gesture';
import { benchKit } from '../core/kit';
import { POINTER_EVENTS_ORDER } from '../core/priority';
import { PROXY_ORDER_BASE, type BenchRouter } from '../core/router';
import { say } from '../core/text';
import type { BenchInternals } from '../space';
import { aimFreeEnd } from './aim';
import { removeBound } from './entities';
import { MIN_THICK_M } from './hits';
import type { PendingWire } from './pending';
import { refOfCell } from './ends';
import { WIRE_STRINGS } from './strings';

/** Up to this many wires every bead shows; above it, only the hovered or selected wire's. */
export const BEADS_ALWAYS_MAX = 40;
/** The Dupont tip, metres of life: 2.5 mm across, 6 mm long. */
export const TIP_RADIUS_M = 0.00125;
export const TIP_LENGTH_M = 0.006;
/** A wire that stops being hovered keeps its beads this long, so a pointer moving from the wire onto a bead does not lose it. */
export const FOCUS_HOLD_MS = 250;

export type EndSide = 'from' | 'to';
export interface Cell {
  readonly part: string;
  readonly anchor: string;
}

/** One bead of a wire: which end, the end's reference, and the end that stays when this one is lifted. */
export interface BeadEnd {
  readonly side: EndSide;
  readonly ref: WireEndRef;
  readonly kept: WireEndRef;
}

const isRef = (e: WireEnd): e is WireEnd & WireEndRef => e.kind === 'pin' || e.kind === 'hole';

/** The beads a wire has: one per end, none when an end is a junction (a wire to a junction cannot have its other end moved). Pure. */
export function beadEnds(wire: Pick<Wire, 'from' | 'to'>): BeadEnd[] {
  const { from, to } = wire;
  if (!isRef(from) || !isRef(to)) return [];
  return [
    { side: 'from', ref: from, kept: to },
    { side: 'to', ref: to, kept: from },
  ];
}

/** Whether the beads of `wire` show: always for a small bench, else only for a wire in `focus` (hovered or selected). Pure. */
export function beadsShown(wires: number, wire: string, focus: ReadonlySet<string>): boolean {
  return wires <= BEADS_ALWAYS_MAX || focus.has(wire);
}

/** The cell a wire end is (the breadboard hole or the board pin). Pure. */
export const cellOfEnd = (ref: WireEndRef): Cell => (ref.kind === 'hole' ? { part: ref.surface, anchor: ref.hole } : { part: ref.c, anchor: ref.p });

export type Release = 'move' | 'remove' | 'keep';

/**
 * What releasing a lifted end does: onto another ringed cell it moves the end; onto its own cell, or after a tap (a
 * pinch released at once without moving: it never meant to pull anything), nothing changes; over no cell the wire comes
 * out, as a jumper pulled from the board. Pure.
 */
export function decideRelease(a: { ringed: Cell | null; own: Cell; tap: boolean }): Release {
  if (a.tap) return 'keep';
  if (!a.ringed) return 'remove';
  return a.ringed.part === a.own.part && a.ringed.anchor === a.own.anchor ? 'keep' : 'move';
}

/** Where a bead sits on a wire's drawn path (board frame, real size) and which way its tip points. */
export interface BeadSite {
  readonly at: Vec3;
  readonly dir: Vec3;
}

/**
 * The bead's place: the first point of the path from this end that is at least `minRise` above the end's anchor
 * (interpolated), pointing along the wire. A wire that never rises that high gets its bead lifted straight up to
 * `minRise` above the third point of its path, so the bead is always above the cell's band. Pure.
 */
export function beadSite(path: readonly Vec3[], side: EndSide, minRise: number): BeadSite | null {
  const n = path.length;
  if (n < 2) return null;
  const at = (k: number): Vec3 => path[side === 'from' ? k : n - 1 - k]!;
  const base = at(0)[1];
  for (let k = 1; k < n; k++) {
    const p = at(k);
    if (p[1] - base < minRise) continue;
    const q = at(k - 1);
    const span = p[1] - q[1];
    const t = span > 1e-9 ? Math.min(1, Math.max(0, (base + minRise - q[1]) / span)) : 1;
    const x = q[0] + (p[0] - q[0]) * t;
    const y = q[1] + (p[1] - q[1]) * t;
    const z = q[2] + (p[2] - q[2]) * t;
    const len = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) || 1;
    return { at: [x, y, z], dir: [(p[0] - q[0]) / len, (p[1] - q[1]) / len, (p[2] - q[2]) / len] };
  }
  const p = at(Math.min(2, n - 1));
  return { at: [p[0], base + minRise, p[2]], dir: [0, 1, 0] };
}

// ---------------------------------------------------------------------------------------------------------- the beads

export interface BeadDeps {
  readonly app: XrApp;
  readonly bi: BenchInternals;
  readonly router: BenchRouter;
  readonly root: Object3D;
  readonly pending: PendingWire;
  /** A wire is already being drawn from a cell: a bead cannot be lifted meanwhile. */
  busy(): boolean;
  /** The wire whose chip is open, if any. */
  selected(): string | null;
  /** A lifted bead closes the chip. */
  lifted(): void;
  callout(text: string, at: Vector3, tone: CalloutTone, shape: 'tag' | 'card'): void;
}

export interface WireBeads {
  /** A wire's own hit boxes are hovered (or not): its beads show above `BEADS_ALWAYS_MAX` wires. */
  hover(wire: string, on: boolean): void;
  /** The selection changed. */
  refocus(): void;
  /** A bead is lifted. */
  dragging(): boolean;
  dispose(): void;
}

interface Bead {
  readonly wire: string;
  readonly end: BeadEnd;
  readonly own: Cell;
  readonly site: Vector3;
  readonly mesh: Mesh;
  readonly box: Mesh;
  readonly line: LineSegments;
  readonly rimMaterial: Material | null;
  readonly base: { x: number; y: number; z: number; sx: number; sy: number; sz: number };
  unbind: Unsubscribe;
  hovered: boolean;
}

interface Drag {
  readonly bead: Bead;
  readonly hand: Hand;
  readonly near: boolean;
  readonly start: Vector3;
  readonly end: Vector3;
  readonly loss: TrackingLoss;
  readonly tracker: PressTracker;
  readonly hidden: Object3D[];
  ended: boolean;
  upper: boolean;
}

const Y = new Vector3(0, 1, 0);
const boxGeometry = new BoxGeometry(1, 1, 1);
const boxMaterial = new MeshBasicMaterial({ visible: false });
const _a = new Vector3();
const _q = new Quaternion();
const _p = new Vector3();

export function createWireBeads(deps: BeadDeps): WireBeads {
  const { app, bi, router, root, pending } = deps;
  const feedback = benchKit(app).feedback;
  const tipGeometry = new CylinderGeometry(TIP_RADIUS_M, TIP_RADIUS_M, TIP_LENGTH_M, 10);
  paintBands(tipGeometry, BANDS.blackPlastic);
  const edges = new EdgesGeometry(tipGeometry);
  const lineMaterial = new LineBasicMaterial({ color: hexNum(ACCENT), toneMapped: false });
  let kit: InkKit | null = null;
  let material: Material | null = null;
  let ready = false;
  let disposed = false;
  let beads: Bead[] = [];
  let drag: Drag | null = null;
  let builtKey = '';
  let wireCount = 0;
  const overWires = new Map<string, number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const offs: Unsubscribe[] = [];

  // ---- focus -------------------------------------------------------------------------------------------------------

  const focus = (): Set<string> => {
    const out = new Set<string>();
    for (const [w, n] of overWires) if (n > 0) out.add(w);
    for (const b of beads) if (b.hovered) out.add(b.wire);
    const sel = deps.selected();
    if (sel) out.add(sel);
    if (drag) out.add(drag.bead.wire);
    return out;
  };
  const keyOf = (): string => (wireCount > BEADS_ALWAYS_MAX ? [...focus()].sort().join(',') : '');
  const settle = () => {
    if (ready && keyOf() !== builtKey) rebuild();
  };

  // ---- the drawn wire ----------------------------------------------------------------------------------------------

  /** The meshes a wire is drawn with: its body (the ink rim is its child) and the shadow, which shares the geometry. */
  const drawnOf = (id: string): Object3D[] => {
    const body = root.getObjectByName(id) as Mesh | undefined;
    if (!body) return [];
    const out: Object3D[] = [body];
    for (const c of root.children) if (c !== body && (c as Mesh).geometry === body.geometry) out.push(c);
    return out;
  };

  // ---- build -------------------------------------------------------------------------------------------------------

  const restoreBox = (b: Bead) => {
    const r = b.base;
    b.box.position.set(r.x, r.y, r.z);
    b.box.quaternion.identity();
    b.box.scale.set(r.sx, r.sy, r.sz);
    b.box.updateMatrix();
  };

  const clear = () => {
    for (const b of beads) {
      b.unbind();
      removeBound(app, b.box);
      b.mesh.removeFromParent();
      b.rimMaterial?.dispose();
    }
    beads = [];
  };

  const make = (w: Wire, end: BeadEnd, path: readonly Vec3[], s: number) => {
    const band = CELL_BAND_WORK_M / s;
    const site = beadSite(path, end.side, band + TIP_LENGTH_M / 2);
    if (!site) return;
    const anchorY = (end.side === 'from' ? path[0]! : path[path.length - 1]!)[1];
    const mesh = new Mesh(tipGeometry, material!);
    mesh.name = `bench:wire-bead:${w.id}:${end.side}`;
    mesh.position.set(site.at[0], site.at[1], site.at[2]);
    mesh.quaternion.setFromUnitVectors(Y, _a.set(site.dir[0], site.dir[1], site.dir[2]));
    mesh.raycast = () => undefined;
    root.add(mesh);
    let rimMaterial: Material | null = null;
    if (kit) {
      const rim = kit.outline(mesh, 1.8);
      rim.raycast = () => undefined;
      rimMaterial = rim.material as Material;
    }
    const line = new LineSegments(edges, lineMaterial);
    line.scale.setScalar(1.7);
    line.visible = false;
    line.raycast = () => undefined;
    mesh.add(line);
    // the collider: at least 20 mm in the world, its underside on the cell's band so the cell below stays the cell
    const thick = Math.max(MIN_THICK_M / s, TIP_LENGTH_M);
    const box = new Mesh(boxGeometry, boxMaterial);
    box.name = `bench:wire-bead-hit:${w.id}:${end.side}`;
    box.pointerEventsOrder = PROXY_ORDER_BASE + POINTER_EVENTS_ORDER['wire-end'] + 0.5;
    const bead: Bead = {
      wire: w.id,
      end,
      own: cellOfEnd(end.ref),
      site: new Vector3(site.at[0], site.at[1], site.at[2]),
      mesh,
      box,
      line,
      rimMaterial,
      base: { x: site.at[0], y: Math.max(site.at[1], anchorY + band + thick / 2), z: site.at[2], sx: thick, sy: thick, sz: thick },
      unbind: () => undefined,
      hovered: false,
    };
    restoreBox(bead);
    root.add(box);
    bead.unbind = app.input.bind(box, { id: `bench/wire-end:${w.id}:${end.side}`, ray: true, grab: 'both' }, (e) => onEvent(bead, e));
    beads.push(bead);
  };

  const rebuild = () => {
    if (!ready || disposed) return;
    if (drag) stop();
    clear();
    const view = breadboardViewOf(app.project.doc);
    const s = app.bench.scale.value;
    const wires = view?.wires ?? [];
    wireCount = wires.length;
    const f = focus();
    for (const w of wires) {
      if (!beadsShown(wires.length, w.id, f)) continue;
      const ends = beadEnds(w);
      if (ends.length === 0) continue;
      const path = app.bench.wirePath(w.id);
      if (!path) continue;
      for (const end of ends) make(w, end, path, s);
    }
    kit?.relight();
    builtKey = keyOf();
  };

  // ---- hover -------------------------------------------------------------------------------------------------------

  const worldOf = (p: Vector3): Vec3 => {
    _p.copy(p);
    root.localToWorld(_p);
    return [_p.x, _p.y, _p.z];
  };

  const hoverBead = (b: Bead, on: boolean, hand: Hand | null) => {
    if (b.hovered === on) return;
    if (on && (drag || deps.busy())) return;
    b.hovered = on;
    b.line.visible = on && drag?.bead !== b;
    if (on) feedback.play('hover-grabbable', worldOf(b.site), hand);
    if (on) settle();
    else {
      const t = setTimeout(() => {
        timers.delete(t);
        settle();
      }, FOCUS_HOLD_MS);
      timers.add(t);
    }
  };

  // ---- lift --------------------------------------------------------------------------------------------------------

  const stop = () => {
    const d = drag;
    drag = null;
    pending.hide();
    if (!d) return;
    for (const o of d.hidden) o.visible = true;
    d.bead.mesh.visible = true;
  };

  const start = (b: Bead, e: InteractionEvent) => {
    const hand = e.pointer.hand;
    if (drag || deps.busy() || !hand) return;
    const k = b.end.kept;
    const keptCell = cellOfEnd(k);
    const start = new Vector3();
    if (!bi.anchorBoard(keptCell.part, keptCell.anchor, start)) return;
    const pose = app.input.pose(hand);
    const d: Drag = {
      bead: b,
      hand,
      near: e.pointer.mode === 'grab',
      start,
      end: b.site.clone(),
      loss: createTrackingLoss(),
      tracker: createPressTracker(),
      hidden: drawnOf(b.wire),
      ended: false,
      upper: app.input.button(hand, 'upper').pressed,
    };
    d.tracker.start(performance.now(), pose?.position[0] ?? 0, pose?.position[1] ?? 0, pose?.position[2] ?? 0);
    for (const o of d.hidden) o.visible = false;
    b.mesh.visible = false;
    b.line.visible = false;
    drag = d;
    deps.lifted();
    pending.set(d.start, d.end);
  };

  const finish = (d: Drag) => {
    const b = d.bead;
    const ring = router.ringed(d.hand);
    const tap = d.tracker.end(performance.now()) === 'tap';
    const what = decideRelease({ ringed: ring, own: b.own, tap });
    const lang = app.settings.lang.value;
    const at = d.end.clone();
    const world = worldOf(at);
    const doc = app.project.doc;
    if (what === 'keep') return stop();
    if (what === 'move' && ring) {
      const to = refOfCell(bi.surface, ring.part, ring.anchor);
      const r = moveWireEnd(doc, { wire: b.wire, end: b.end.side, to });
      if (r.ok && app.project.apply(r.ops, { label: r.label }).ok) {
        feedback.play('wire', world, d.hand);
        feedback.ticker(say(app, WIRE_STRINGS, 'wire.moved', { a: endLabel(doc, to) }));
        deps.callout(say(app, WIRE_STRINGS, 'wire.moved', { a: endLabel(doc, to) }), at, 'pass', 'tag');
        return stop();
      }
      feedback.play('invalid', world, d.hand);
      const reason = r.ok ? null : refusalText(lang, r);
      if (reason) deps.callout(reason, at, 'warn', 'card');
      return stop();
    }
    const r = removeWire(doc, { wire: b.wire });
    if (r.ok && app.project.apply(r.ops, { label: r.label }).ok) {
      feedback.play('pull', world, d.hand);
      feedback.ticker(say(app, WIRE_STRINGS, 'wire.pulled', { a: endLabel(doc, b.end.ref) }));
      return stop();
    }
    feedback.play('invalid', world, d.hand);
    stop();
  };

  const onEvent = (b: Bead, e: InteractionEvent) => {
    switch (e.type) {
      case 'hover-start':
        return hoverBead(b, true, e.pointer.hand);
      case 'hover-end':
        return hoverBead(b, false, e.pointer.hand);
      case 'grab-start':
        return start(b, e);
      case 'grab-end': {
        // IWSDK's grab moves the bound box; it goes back where it was
        restoreBox(b);
        const d = drag;
        if (!d || d.bead !== b) return;
        if (app.input.button(d.hand, 'upper').pressed) return stop();
        if (!app.input.pose(d.hand)) {
          d.ended = true;
          return;
        }
        return finish(d);
      }
      default:
        return;
    }
  };

  const frame = () => {
    const d = drag;
    if (!d) return;
    const now = performance.now();
    const pose = app.input.pose(d.hand);
    if (pose) d.loss.found();
    else d.loss.lost(now, 'wire');
    if (d.loss.update(now) === 'drop') return stop();
    if (pose && d.ended) return stop();
    const upper = app.input.button(d.hand, 'upper').pressed;
    const cancel = upper && !d.upper;
    d.upper = upper;
    if (cancel) return stop();
    if (!d.ended) {
      aimFreeEnd(app, bi, router, root, d.hand, d.near, d.bead.own, d.start.y, d.end);
      if (pose) d.tracker.move(now, pose.position[0], pose.position[1], pose.position[2]);
    }
    pending.set(d.start, d.end);
  };

  // ---- mount -------------------------------------------------------------------------------------------------------

  void loadInk().then((ink) => {
    if (disposed) return;
    if (ink) {
      kit = inkKit(ink, root);
      material = kit.body(tipGeometry, 'sun');
    } else material = new MeshStandardMaterial({ color: hexNum(BANDS.blackPlastic.m), roughness: 0.5 });
    ready = true;
    rebuild();
  });
  offs.push(app.bench.onLayout(rebuild));
  offs.push(app.bench.scale.subscribe(rebuild));
  offs.push(onLookFrame(app.world, frame));

  return {
    hover(wire, on) {
      overWires.set(wire, Math.max(0, (overWires.get(wire) ?? 0) + (on ? 1 : -1)));
      if (on) settle();
      else {
        const t = setTimeout(() => {
          timers.delete(t);
          settle();
        }, FOCUS_HOLD_MS);
        timers.add(t);
      }
    },
    refocus: settle,
    dragging: () => drag !== null,
    dispose() {
      disposed = true;
      stop();
      for (const off of offs) off();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      clear();
      tipGeometry.dispose();
      edges.dispose();
      lineMaterial.dispose();
      material?.dispose();
    },
  };
}
