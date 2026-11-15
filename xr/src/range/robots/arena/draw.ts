/**
 * The arena drawn in the look kit: the floor plate, the walls and the line track as inked, banded solids; the robot's
 * bodies as inked solids sized from the document's shapes; the dashed ink trail. Everything is built once, in arena
 * metres (x right, y ahead, z up) under one group whose matrix is the arena-to-room mapping; only the bodies' poses and
 * the trail's buffer change per frame.
 */
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hullOf } from '../../../run/kit/ink';
import { ACCENT, BANDS, INK, paintBands } from '../../shared';
import { toRoom, type ArenaSpec, type BodySpec, type Placement, type Trail } from './model';

const OUTLINE_FLOOR_M = 0.004;
const OUTLINE_WALL_M = 0.002;
const OUTLINE_BODY_M = 0.0015;
const FLOOR_THICK_M = 0.012;
const TRACK_HEIGHT_M = 0.002;

export interface ArenaDrawing {
  /** Arena metres inside; its matrix is the arena-to-room mapping. */
  readonly group: Group;
  /** One group per body, in `spec.bodies` order; position and rotation.z are in arena metres. */
  readonly bodies: readonly Group[];
  readonly trailAttr: BufferAttribute;
  setOpacity(a: number): void;
  dispose(): void;
}

const plain = (g: BufferGeometry): BufferGeometry => {
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  return out;
};

function shapeGeometry(b: BodySpec): BufferGeometry {
  const s = b.shape;
  if (s.kind === 'box') return plain(new BoxGeometry(s.size[0], s.size[1], s.size[2]));
  // the wheel's axle is local y (the robot's lateral axis), where three's cylinder already has its axis
  if (s.kind === 'cylinder') return plain(new CylinderGeometry(s.radius, s.radius, s.height, 24, 1));
  return plain(new SphereGeometry(s.radius, 14, 10));
}

const colourOf = (b: BodySpec, chassis: string): string => (b.id === chassis ? BANDS.mustard.l : b.shape.kind === 'cylinder' ? BANDS.dark.l : BANDS.metal.l);

/** Course-like mapping: arena x, y, z to world, as the group's matrix. */
function arenaMatrix(p: Placement): Matrix4 {
  const o: [number, number, number] = [0, 0, 0];
  toRoom(p, 0, 0, 0, o);
  const m = new Matrix4().makeBasis(new Vector3(p.rx, 0, p.rz), new Vector3(p.fx, 0, p.fz), new Vector3(0, 1, 0));
  m.setPosition(o[0], o[1], o[2]);
  return m;
}

export function drawArena(spec: ArenaSpec, place: Placement, trail: Trail): ArenaDrawing {
  const group = new Group();
  group.name = 'range-arena';
  group.matrixAutoUpdate = false;
  group.matrix.copy(arenaMatrix(place));
  group.matrixWorldNeedsUpdate = true;

  const bodyMat = new MeshBasicMaterial({ vertexColors: true });
  const outlineMat = new MeshBasicMaterial({ color: INK, side: BackSide });
  const trailMat = new LineBasicMaterial({ color: INK, transparent: true, opacity: 0.8 });
  const owned: BufferGeometry[] = [];
  const inked = (g: BufferGeometry, width: number, name: string, parent: Group = group): Mesh => {
    const outline = new Mesh(hullOf(g, width), outlineMat);
    const body = new Mesh(g, bodyMat);
    body.name = name;
    body.renderOrder = 1;
    parent.add(outline, body);
    owned.push(g, outline.geometry);
    return body;
  };

  // the floor plate, its top at z = 0
  const floor = plain(new BoxGeometry(spec.width, spec.depth, FLOOR_THICK_M));
  floor.translate(0, 0, -FLOOR_THICK_M / 2);
  inked(paintBands(floor, BANDS.mat.l), OUTLINE_FLOOR_M, 'range-arena-floor');

  // the walls, one mesh
  const walls = spec.walls.map((w) => {
    const g = plain(new BoxGeometry(w.w, w.d, w.h));
    g.rotateZ(w.yaw);
    g.translate(w.x, w.y, w.z);
    return paintBands(g, BANDS.tan.l);
  });
  if (walls.length) {
    const merged = mergeGeometries(walls, false);
    walls.forEach((g) => g.dispose());
    if (merged) inked(merged, OUTLINE_WALL_M, 'range-arena-walls');
  }

  // the line: one ink ribbon per segment, flat on the floor, merged
  const ribbon: BufferGeometry[] = [];
  for (const t of spec.tracks) {
    const n = t.points.length / 2;
    for (let i = 0; i < (t.closed ? n : n - 1); i++) {
      const j = (i + 1) % n;
      const x0 = t.points[i * 2]!, y0 = t.points[i * 2 + 1]!, x1 = t.points[j * 2]!, y1 = t.points[j * 2 + 1]!;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1e-6) continue;
      const g = plain(new BoxGeometry(len + t.widthM * 0.9, t.widthM, TRACK_HEIGHT_M));
      g.rotateZ(Math.atan2(y1 - y0, x1 - x0));
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, TRACK_HEIGHT_M / 2);
      ribbon.push(paintBands(g, INK));
    }
  }
  if (ribbon.length) {
    const merged = mergeGeometries(ribbon, false);
    ribbon.forEach((g) => g.dispose());
    if (merged) {
      const mesh = new Mesh(merged, bodyMat);
      mesh.name = 'range-arena-line';
      mesh.renderOrder = 2;
      group.add(mesh);
      owned.push(merged);
    }
  }

  // the robot's bodies: each its own inked solid, posed per frame
  const bodies = spec.bodies.map((b) => {
    const g = new Group();
    g.name = `range-body-${b.id}`;
    inked(paintBands(shapeGeometry(b), colourOf(b, spec.chassis)), OUTLINE_BODY_M, `range-body-${b.id}-solid`, g);
    if (b.id === spec.chassis && b.shape.kind === 'box') {
      // a nose, so the heading reads from across the room
      const [sx, sy, sz] = b.shape.size;
      const nose = plain(new BoxGeometry(sx * 0.18, sy * 0.4, sz * 0.5));
      nose.translate(sx / 2 - sx * 0.09, 0, sz / 2 + sz * 0.25);
      inked(paintBands(nose, ACCENT), OUTLINE_BODY_M, 'range-body-nose', g);
    }
    group.add(g);
    return g;
  });

  // the dashed trail of the chassis path
  const trailGeometry = new BufferGeometry();
  const trailAttr = new BufferAttribute(trail.dashes, 3);
  trailGeometry.setAttribute('position', trailAttr);
  const trailLine = new LineSegments(trailGeometry, trailMat);
  trailLine.frustumCulled = false;
  trailLine.name = 'range-arena-trail';
  group.add(trailLine);
  owned.push(trailGeometry);

  const mats = [bodyMat, outlineMat];
  return {
    group,
    bodies,
    trailAttr,
    setOpacity(a) {
      for (const m of mats) {
        m.opacity = a;
        // a new program only when transparency flips, not every frame of the fade
        if (m.transparent !== a < 1) {
          m.transparent = a < 1;
          m.needsUpdate = true;
        }
      }
      trailMat.opacity = 0.8 * a;
    },
    dispose() {
      for (const g of owned) g.dispose();
      bodyMat.dispose();
      outlineMat.dispose();
      trailMat.dispose();
      group.removeFromParent();
    },
  };
}
