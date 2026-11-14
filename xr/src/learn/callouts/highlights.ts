/**
 * The viewed step's highlights on the bench (design 7.1): a ring with its name on each pin or hole target (the ring
 * through `app.overlay` as owner `guide`, the name as a paper tag), a ring round a part target sized to the part, and
 * for a wire step a dashed accent arc between its two anchors. Entering a step and Show me pulse them (1.2 s, three
 * times, then steady; static under reduced motion). Without a lesson, the project's own callouts as readable tags.
 *
 * What the overlay cannot draw yet (arcs, part-sized rings, caption-size labels, pulses) is drawn here, under
 * `app.bench.table`, in its frame, so moving the bench carries it. Geometry is built when the step or the layout
 * changes; a frame only sets opacity, scales and turns the tags to the head.
 */
import { Box3, BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry, Shape, ShapeGeometry, Vector3, type Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Lang, Unsubscribe } from '../../contracts/common';
import type { BoardTarget } from '../../contracts/space';
import { tokens, type Tokens } from '../kit/tokens';
import type { Highlight } from '../types';
import { arcControl, bezier, dashes, pulse, type P3 } from './geometry';
import { createTag, type Tag } from './tag';

interface Item {
  readonly target: BoardTarget;
  readonly label: string;
  readonly at: Vector3;
  tag?: Tag;
  /** Lift of the tag above `at`, metres. */
  lift: number;
  ring?: Mesh;
  off?: Unsubscribe;
}

const PIN_RING = new RingGeometry(0.011, 0.0145, 40).rotateX(-Math.PI / 2);
const RING_W = 0.003;
const RING_MARGIN = 0.008;
const ARC_R = 0.0016;

/** The name a point target is known by on the bench: its pin, hole or anchor id. */
export function targetName(t: BoardTarget): string {
  return t.kind === 'pin' ? t.pin : t.kind === 'hole' ? t.hole : t.kind === 'anchor' ? t.anchor : '';
}

function roundedRing(w: number, d: number, r: number, stroke: number): ShapeGeometry {
  const rect = (x: number, z: number, ww: number, dd: number, rr: number, s: Shape | null) => {
    const sh = s ?? new Shape();
    sh.moveTo(x + rr, z);
    sh.lineTo(x + ww - rr, z);
    sh.quadraticCurveTo(x + ww, z, x + ww, z + rr);
    sh.lineTo(x + ww, z + dd - rr);
    sh.quadraticCurveTo(x + ww, z + dd, x + ww - rr, z + dd);
    sh.lineTo(x + rr, z + dd);
    sh.quadraticCurveTo(x, z + dd, x, z + dd - rr);
    sh.lineTo(x, z + rr);
    sh.quadraticCurveTo(x, z, x + rr, z);
    return sh;
  };
  const outer = rect(-w / 2 - stroke, -d / 2 - stroke, w + 2 * stroke, d + 2 * stroke, r + stroke, null);
  outer.holes.push(rect(-w / 2, -d / 2, w, d, r, null));
  // Shape x, y -> bench x, -z after the turn; the ring is symmetric, so only flatness matters.
  return new ShapeGeometry(outer, 6).rotateX(-Math.PI / 2);
}

/** One geometry of tubes along the dashes of the arc from `a` to `b` (table frame). */
export function arcGeometry(a: P3, b: P3): BufferGeometry {
  const c = arcControl(a, b);
  const parts = dashes(a, c, b, 0.012, 0.008);
  const RAD = 6;
  const SEG = 3;
  const pos: number[] = [];
  const idx: number[] = [];
  const t = new Vector3();
  const n = new Vector3();
  const bn = new Vector3();
  const up = new Vector3(0, 1, 0);
  for (const [t0, t1] of parts) {
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const u = t0 + ((t1 - t0) * i) / SEG;
      const p = bezier(a, c, b, u);
      const q = bezier(a, c, b, Math.min(1, u + 0.001));
      const p0 = bezier(a, c, b, Math.max(0, u - 0.001));
      t.set(q[0] - p0[0], q[1] - p0[1], q[2] - p0[2]).normalize();
      n.crossVectors(t, up);
      if (n.lengthSq() < 1e-8) n.set(1, 0, 0);
      n.normalize();
      bn.crossVectors(t, n).normalize();
      for (let j = 0; j < RAD; j++) {
        const ang = (j / RAD) * Math.PI * 2;
        const cx = Math.cos(ang) * ARC_R;
        const cy = Math.sin(ang) * ARC_R;
        pos.push(p[0] + n.x * cx + bn.x * cy, p[1] + n.y * cx + bn.y * cy, p[2] + n.z * cx + bn.z * cy);
      }
    }
    for (let i = 0; i < SEG; i++) {
      for (let j = 0; j < RAD; j++) {
        const a0 = base + i * RAD + j;
        const a1 = base + i * RAD + ((j + 1) % RAD);
        const b0 = a0 + RAD;
        const b1 = a1 + RAD;
        idx.push(a0, b0, a1, a1, b0, b1);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

export interface Highlights {
  /** The viewed step's targets; `wire` draws the arc between the first two point targets. `fresh` pulses them. */
  showStep(items: readonly Highlight[], wire: boolean, fresh: boolean): void;
  /** The project's own callouts, as tags on their parts. */
  showCallouts(items: ReadonlyArray<{ target: BoardTarget; text: string }>): void;
  /** Positions again after the bench laid itself out. */
  layout(): void;
  pulse(): void;
  setLook(k: Tokens, lang: Lang, textScale: number, reducedMotion: boolean): void;
  tick(dt: number, head: Vector3): void;
  dispose(): void;
}

export function createHighlights(app: XrApp): Highlights {
  const root = new Group();
  root.name = 'guide:highlights';
  app.bench.table.add(root);
  let k = tokens();
  let lang: Lang = app.settings.lang.value;
  let textScale = 1;
  let reduced = false;
  const accent = new MeshBasicMaterial({ color: k.accent, transparent: true, depthWrite: false });
  let items: Item[] = [];
  let arc: Mesh | null = null;
  let wireStep = false;
  let mode: 'step' | 'callouts' = 'step';
  let since = Infinity;
  let distClock = 1;
  const tmp = new Vector3();
  const box = new Box3();
  const corner = new Vector3();

  const clear = () => {
    for (const it of items) {
      it.off?.();
      it.tag?.dispose();
      if (it.ring) {
        it.ring.removeFromParent();
        if (it.ring.geometry !== PIN_RING) it.ring.geometry.dispose();
      }
    }
    items = [];
    if (arc) {
      arc.geometry.dispose();
      arc.removeFromParent();
      arc = null;
    }
  };

  /** The part's footprint in the table frame. */
  const partBox = (obj: Object3D): Box3 | null => {
    box.makeEmpty();
    app.bench.table.updateWorldMatrix(true, false);
    obj.updateWorldMatrix(true, true);
    obj.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !m.geometry) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox!;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
        corner.applyMatrix4(m.matrixWorld);
        app.bench.table.worldToLocal(corner);
        box.expandByPoint(corner);
      }
    });
    return box.isEmpty() ? null : box;
  };

  const position = () => {
    const table = app.bench.table;
    table.updateWorldMatrix(true, false);
    for (const it of items) {
      const w = app.bench.worldOf(it.target);
      const visible = !!w;
      if (w) it.at.copy(table.worldToLocal(tmp.set(w[0], w[1], w[2])));
      if (it.target.kind === 'part') {
        const obj = app.bench.objectOf(it.target.part);
        const b = obj ? partBox(obj) : null;
        if (b) {
          const size = b.getSize(tmp);
          const cx = (b.min.x + b.max.x) / 2;
          const cz = (b.min.z + b.max.z) / 2;
          if (mode === 'step') {
            const geo = roundedRing(size.x + 2 * RING_MARGIN, size.z + 2 * RING_MARGIN, 0.01, RING_W);
            if (!it.ring) {
              it.ring = new Mesh(geo, accent);
              it.ring.name = 'guide:ring';
              root.add(it.ring);
            } else {
              it.ring.geometry.dispose();
              it.ring.geometry = geo;
            }
            it.ring.position.set(cx, b.min.y + 0.002, cz);
          }
          it.at.set(cx, b.max.y, cz);
        }
      } else if (mode === 'step') {
        if (!it.ring) {
          it.ring = new Mesh(PIN_RING, accent);
          it.ring.name = 'guide:pin-ring';
          root.add(it.ring);
        }
        it.ring.position.set(it.at.x, it.at.y + 0.001, it.at.z);
      }
      if (it.ring) it.ring.visible = visible;
      if (it.tag) {
        it.tag.s.mesh.position.set(it.at.x, it.at.y + it.lift, it.at.z);
        it.tag.s.mesh.visible = visible;
      }
    }
    // Tags of callouts that would overlap stack upwards.
    if (mode === 'callouts') {
      const sorted = [...items].filter((i) => i.tag).sort((a, b) => a.at.x - b.at.x);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1]!;
        const b = sorted[i]!;
        const near = Math.abs(a.at.x - b.at.x) < 0.14 && Math.abs(a.at.z - b.at.z) < 0.14;
        if (near) {
          b.lift = a.lift + ((a.tag!.h * 0.7) / 1000) + 0.01;
          b.tag!.s.mesh.position.y = b.at.y + b.lift;
        }
      }
    }
    if (arc) {
      arc.geometry.dispose();
      arc.removeFromParent();
      arc = null;
    }
    if (mode === 'step' && wireStep) {
      const ends = items.filter((i) => i.target.kind !== 'part').slice(0, 2);
      if (ends.length === 2) {
        arc = new Mesh(arcGeometry([ends[0]!.at.x, ends[0]!.at.y, ends[0]!.at.z], [ends[1]!.at.x, ends[1]!.at.y, ends[1]!.at.z]), accent);
        arc.name = 'guide:arc';
        root.add(arc);
      }
    }
    distClock = 1;
  };

  const tagFor = (text: string, maxLines: number) => (text ? createTag(text, k, lang, { maxLines, textScale }) : undefined);

  return {
    showStep(list, wire, fresh) {
      clear();
      mode = 'step';
      wireStep = wire;
      for (const h of list) {
        const point = h.target.kind !== 'part';
        const label = h.label ?? targetName(h.target);
        const it: Item = { target: h.target, label, at: new Vector3(), lift: point ? 0.03 : 0.035, tag: tagFor(label, 1) };
        if (it.tag) root.add(it.tag.s.mesh);
        if (point) it.off = app.overlay.show({ owner: 'guide', target: h.target, tone: h.tone, style: 'glow' });
        items.push(it);
      }
      position();
      if (fresh) since = 0;
    },
    showCallouts(list) {
      clear();
      mode = 'callouts';
      wireStep = false;
      for (const c of list) {
        const it: Item = { target: c.target, label: c.text, at: new Vector3(), lift: 0.05, tag: tagFor(c.text, 3) };
        if (it.tag) root.add(it.tag.s.mesh);
        items.push(it);
      }
      position();
    },
    layout: position,
    pulse() {
      since = 0;
    },
    setLook(next, l, scale, rm) {
      k = next;
      lang = l;
      textScale = scale;
      reduced = rm;
      accent.color.set(k.accent);
    },
    tick(dt, head) {
      since += dt;
      const e = pulse(since, reduced);
      accent.opacity = 0.3 + 0.7 * e;
      const pulsing = !reduced && since < 3.6;
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        if (it.ring && it.target.kind === 'part') {
          const s = 1 + (pulsing ? 0.06 * (1 - e) : 0);
          it.ring.scale.set(s, 1, s);
        } else if (it.ring) {
          const s = 1 + (pulsing ? 0.5 * (1 - e) : 0);
          it.ring.scale.set(s, 1, s);
        }
        if (it.tag && it.tag.s.mesh.visible) it.tag.s.mesh.lookAt(head);
      }
      distClock += dt;
      if (distClock < 0.5) return;
      distClock = 0;
      const table = app.bench.table;
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        if (!it.tag) continue;
        tmp.set(it.at.x, it.at.y + it.lift, it.at.z);
        table.localToWorld(tmp);
        it.tag.setDistance(Math.max(0.3, tmp.distanceTo(head)));
      }
    },
    dispose() {
      clear();
      accent.dispose();
      root.removeFromParent();
    },
  };
}
