/**
 * The course drawn in the room at the map's scale `k`, in the look kit: a ground slab, the pad, the gates (the next one
 * in the accent), the scenery merged into one inked mesh, and the net's ink grids. Everything is built once, in course
 * metres under one group whose matrix is the course-to-room mapping, so nothing here runs per frame except
 * `setNext` and `showNet`, which flip a few values.
 */
import { BackSide, BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from '@iwsdk/core';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildSolids, type Course } from '@/lib/flight';

type Solid = ReturnType<typeof buildSolids>[number];
import { hullOf } from '../../../run/kit/ink';
import { ACCENT, BANDS, INK, paintBands } from '../../shared';
import { FIELD_MARGIN_M, type CourseMap, type NetFace, type Out3 } from '../core';

/** Outline width in room metres (about 4 mm: it reads at two metres). */
const OUTLINE_ROOM_M = 0.004;
const NET_STEP_M = 0.5;
const NET_OPACITY = 0.1;
const GATE_HEX = '#ece6d6';

const NET_FACES: readonly NetFace[] = ['left', 'right', 'near', 'far', 'top'];

export interface CourseDrawing {
  /** Course metres inside; its matrix is the course-to-room mapping. */
  readonly group: Group;
  /** Marks gate `index` as the next one (accent); null clears. */
  setNext(index: number | null): void;
  /** Shows the net grid of one face, or none. */
  showNet(face: NetFace | null): void;
  /** Draws every material at `a` (0..1) for the fade-in; transparent only while it is below 1. */
  setOpacity(a: number): void;
  dispose(): void;
}

const angle = (s: { c: number; s: number }) => Math.atan2(s.s, s.c);

/** One solid as a non-indexed, uv-less geometry in course metres, painted in three bands. */
function solidGeometry(s: Solid, hex: string): BufferGeometry {
  let g: BufferGeometry;
  if (s.k === 'box') {
    g = new BoxGeometry(2 * s.hw, 2 * s.hd, s.z1 - s.z0);
    g = g.toNonIndexed();
    g.rotateZ(angle(s));
    g.translate(s.x, s.y, (s.z0 + s.z1) / 2);
  } else {
    g = new CylinderGeometry(s.r1, s.r0, s.z1 - s.z0, Math.max(3, s.n), 1);
    g = g.toNonIndexed();
    g.rotateX(Math.PI / 2);
    g.rotateZ(angle(s));
    g.translate(s.x, s.y, (s.z0 + s.z1) / 2);
  }
  g.deleteAttribute('uv');
  return paintBands(g, hex);
}

const colourOf = (s: Solid) => (/^#[0-9a-f]{6}$/i.test(s.col) ? s.col : GATE_HEX);

/** Course x, y, z to world, as the group's matrix: x to the right, y ahead, z up, all at `k`. */
function courseMatrix(map: CourseMap): Matrix4 {
  const { rx, rz, fx, fz } = map.volume;
  const o: Out3 = [0, 0, 0];
  map.toRoom(0, 0, 0, o);
  const m = new Matrix4().makeBasis(new Vector3(rx * map.k, 0, rz * map.k), new Vector3(fx * map.k, 0, fz * map.k), new Vector3(0, map.k, 0));
  m.setPosition(o[0], o[1], o[2]);
  return m;
}

function gridSegments(a0: number, a1: number, b0: number, b1: number, step: number, at: (a: number, b: number) => [number, number, number]): Float32Array {
  const out: number[] = [];
  const first = (v: number) => Math.ceil(v / step) * step;
  for (let a = first(a0); a <= a1 + 1e-6; a += step) out.push(...at(a, b0), ...at(a, b1));
  for (let b = first(b0); b <= b1 + 1e-6; b += step) out.push(...at(a0, b), ...at(a1, b));
  // the border, so the net reads as a plane even where the grid does not land on its edge
  out.push(...at(a0, b0), ...at(a1, b0), ...at(a1, b0), ...at(a1, b1), ...at(a1, b1), ...at(a0, b1), ...at(a0, b1), ...at(a0, b0));
  return new Float32Array(out);
}

export function drawCourse(map: CourseMap, course: Course): CourseDrawing {
  const k = map.k;
  const group = new Group();
  group.name = 'range-course';
  group.matrixAutoUpdate = false;
  group.matrix.copy(courseMatrix(map));
  group.matrixWorldNeedsUpdate = true;

  const bodyMat = new MeshBasicMaterial({ vertexColors: true });
  const outlineMat = new MeshBasicMaterial({ color: INK, side: BackSide });
  const netMat = new LineBasicMaterial({ color: INK, transparent: true, opacity: NET_OPACITY, depthWrite: false });
  const hullWidth = OUTLINE_ROOM_M / k;
  const owned: BufferGeometry[] = [];
  const inked = (g: BufferGeometry, name: string) => {
    const outline = new Mesh(hullOf(g, hullWidth), outlineMat);
    const body = new Mesh(g, bodyMat);
    body.name = name;
    body.renderOrder = 1;
    group.add(outline, body);
    owned.push(g, outline.geometry);
    return body;
  };

  // the ground: a slab the size of the field, its top at course z = 0
  const slabH = 0.006 / k;
  const ground = new BoxGeometry(map.field, map.field, slabH).toNonIndexed();
  ground.deleteAttribute('uv');
  ground.translate(map.field / 2, map.field / 2, -slabH / 2);
  inked(paintBands(ground, /^#[0-9a-f]{6}$/i.test(course.ground) ? course.ground : '#dde3cc'), 'range-ground');

  // the pad
  const padR = Math.max(0.8, 0.09 / k);
  const pad = new CylinderGeometry(padR, padR, slabH, 28, 1).toNonIndexed();
  pad.rotateX(Math.PI / 2);
  pad.deleteAttribute('uv');
  pad.translate(course.pad[0], course.pad[1], slabH / 2);
  inked(paintBands(pad, BANDS.mustard.l), 'range-pad');

  // the scenery: every solid that is not a gate, one mesh
  const solids = buildSolids(course);
  const scenery = solids.filter((s) => (s as { gate?: number }).gate === undefined).map((s) => solidGeometry(s, colourOf(s)));
  if (scenery.length) {
    const merged = mergeGeometries(scenery, false);
    scenery.forEach((g) => g.dispose());
    if (merged) inked(merged, 'range-scenery');
  }

  // the gates: one mesh, the colours of the next gate swapped for the accent
  const gateParts: BufferGeometry[][] = course.gates.map(() => []);
  for (const s of solids) if (s.k === 'box' && s.gate !== undefined) gateParts[s.gate]!.push(solidGeometry(s, colourOf(s)));
  const paper: Float32Array[] = [];
  const accent: Float32Array[] = [];
  const gateGeoms = gateParts.map((parts) => {
    if (!parts.length) return null;
    const colours = (hex: string) => {
      const c = parts.map((p) => paintBands(p.clone(), hex));
      const merged = mergeGeometries(c, false)!;
      c.forEach((x) => x.dispose());
      const arr = (merged.getAttribute('color') as Float32BufferAttribute).array as Float32Array;
      merged.dispose();
      return arr.slice();
    };
    paper.push(colours(GATE_HEX));
    accent.push(colours(ACCENT));
    const merged = mergeGeometries(parts, false)!;
    parts.forEach((p) => p.dispose());
    return merged;
  });
  const gateList = gateGeoms.filter((g): g is BufferGeometry => g !== null);
  let gateBody: Mesh | null = null;
  const offsets: number[] = [];
  if (gateList.length) {
    let at = 0;
    for (const g of gateList) {
      offsets.push(at);
      at += g.getAttribute('position').count * 3;
    }
    const all = mergeGeometries(gateList, false)!;
    gateList.forEach((g) => g.dispose());
    // paint every gate in paper, then the accent where it is the next one
    const colour = all.getAttribute('color') as Float32BufferAttribute;
    paper.forEach((p, i) => colour.array.set(p, offsets[i]!));
    gateBody = inked(all, 'range-gates');
  }
  let next: number | null = null;
  const paintGate = (i: number, hot: boolean) => {
    if (!gateBody) return;
    const colour = gateBody.geometry.getAttribute('color') as Float32BufferAttribute;
    colour.array.set((hot ? accent : paper)[i]!, offsets[i]!);
    colour.needsUpdate = true;
  };

  // the net: an ink grid on each face, each its own tiny line mesh; only the near one shows
  const lo = -FIELD_MARGIN_M, hi = map.field + FIELD_MARGIN_M, step = NET_STEP_M / k;
  const planes: Record<NetFace, Float32Array> = {
    left: gridSegments(lo, hi, 0, map.ceiling, step, (a, b) => [lo, a, b]),
    right: gridSegments(lo, hi, 0, map.ceiling, step, (a, b) => [hi, a, b]),
    near: gridSegments(lo, hi, 0, map.ceiling, step, (a, b) => [a, lo, b]),
    far: gridSegments(lo, hi, 0, map.ceiling, step, (a, b) => [a, hi, b]),
    top: gridSegments(lo, hi, lo, hi, step, (a, b) => [a, b, map.ceiling]),
  };
  const nets = new Map<NetFace, LineSegments>();
  for (const face of NET_FACES) {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(planes[face], 3));
    const lines = new LineSegments(g, netMat);
    lines.visible = false;
    lines.name = `range-net-${face}`;
    lines.frustumCulled = false;
    nets.set(face, lines);
    group.add(lines);
    owned.push(g);
  }
  let shown: NetFace | null = null;

  const mats = [bodyMat, outlineMat];
  return {
    group,
    setNext(index) {
      if (index === next) return;
      if (next !== null) paintGate(next, false);
      next = index !== null && index >= 0 && index < paper.length ? index : null;
      if (next !== null) paintGate(next, true);
    },
    showNet(face) {
      if (face === shown) return;
      if (shown) nets.get(shown)!.visible = false;
      shown = face;
      if (face) nets.get(face)!.visible = true;
    },
    setOpacity(a) {
      for (const m of mats) {
        m.transparent = a < 1;
        m.opacity = a;
        m.needsUpdate = true;
      }
    },
    dispose() {
      for (const g of owned) g.dispose();
      bodyMat.dispose();
      outlineMat.dispose();
      netMat.dispose();
      group.removeFromParent();
    },
  };
}
