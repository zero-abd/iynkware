/**
 * The work mat and the front rail (XR_DESIGN.md 2.1 and 2.4), drawn as the figures draw their bench: a sage cutting mat
 * with a quiet grid and ruler ticks, a banded edge and the heavy ink silhouette, and an inked rail along its front edge
 * for the run cluster and the bench's own controls, casting its flat cobalt shadow on the mat. In passthrough it lies on
 * the real table (no slab, no backdrop); on the flat page it is the figure's stage.
 *
 * Table frame (`app.bench.table`): metres, origin at the bench top centre, +x right, +z towards the person, y up; the
 * mat's top is a hair under y = 0, where the parts stand. Three draw calls for the mat (top, edge, silhouette) and three
 * for the rail (body, silhouette, shadow).
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ExtrudeGeometry,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  Shape,
  SRGBColorSpace,
  Vector3,
  type Material,
} from '@iwsdk/core';
import { paintBands, smoothOutlineNormals, type InkKit } from './ink';
import { makeCanvas } from './paint';
import { BANDS, MAT_GRID, MUTED, type Bands } from './palette';
import { FONT_MONO, onFontsReady } from './type';

/** XR_DESIGN.md 2.4: the rail is the first 0.04 m of depth, raised 0.03 m and tilted 30 degrees up towards the person. */
export const RAIL = { depth: 0.04, raise: 0.03, tiltRad: (30 * Math.PI) / 180 } as const;
/** The mat's thickness, its corner radius, and how far its top sits under y = 0 (so a part's base never fights it). */
export const MAT = { thickness: 0.004, radius: 0.018, sink: 0.0004 } as const;
/**
 * The grid pitch on the bench: the figures' 10 mm grid at the default board scale (4x), so a part covers as many cells
 * as in its figure. Ticks along the edges every 10 mm, numbered every 100 mm, as a real cutting mat's ruler.
 */
const GRID = 0.04;
const TICK = 0.01;
/** Canvas pixels per millimetre of mat. */
const PX_PER_MM = 2;

export interface WorkMat {
  readonly group: Group;
  dispose(): void;
}

function roundedRect(w: number, d: number, r: number): Shape {
  const s = new Shape();
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r);
  s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

/** The mat's printed top: the light band, the grid, the ruler ticks and their numbers (canvas top = the mat's back). */
function paintMatTop(canvas: HTMLCanvasElement, w: number, d: number, bands: Bands) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const W = canvas.width, H = canvas.height;
  const px = W / (w * 1000); // canvas px per mm
  g.fillStyle = bands.l;
  g.fillRect(0, 0, W, H);
  // The grid, centred on the mat so the bench's middle line is a grid line.
  g.strokeStyle = MAT_GRID;
  g.globalAlpha = 0.7;
  g.lineWidth = Math.max(1, 0.6 * px);
  const margin = 0.03;
  const gx0 = -w / 2 + margin, gx1 = w / 2 - margin, gz0 = -d / 2 + margin, gz1 = d / 2 - margin;
  const toX = (x: number) => (x + w / 2) * 1000 * px;
  const toY = (z: number) => (z + d / 2) * 1000 * px;
  g.beginPath();
  for (let x = Math.ceil(gx0 / GRID) * GRID; x <= gx1 + 1e-9; x += GRID) {
    g.moveTo(toX(x), toY(gz0));
    g.lineTo(toX(x), toY(gz1));
  }
  for (let z = Math.ceil(gz0 / GRID) * GRID; z <= gz1 + 1e-9; z += GRID) {
    g.moveTo(toX(gx0), toY(z));
    g.lineTo(toX(gx1), toY(z));
  }
  g.stroke();
  // The ruler border: one darker line round the grid, ticks outside it along the back and left edges.
  g.globalAlpha = 1;
  g.strokeStyle = bands.d;
  g.lineWidth = Math.max(1, 0.8 * px);
  g.strokeRect(toX(gx0), toY(gz0), toX(gx1) - toX(gx0), toY(gz1) - toY(gz0));
  g.beginPath();
  const n = Math.floor((gx1 - gx0) / TICK + 1e-6);
  for (let i = 0; i <= n; i++) {
    const x = toX(gx0 + i * TICK);
    const len = (i % 10 === 0 ? 9 : i % 5 === 0 ? 6 : 3.5) * px;
    g.moveTo(x, toY(gz0));
    g.lineTo(x, toY(gz0) - len);
  }
  const m = Math.floor((gz1 - gz0) / TICK + 1e-6);
  for (let i = 0; i <= m; i++) {
    const y = toY(gz0 + i * TICK);
    const len = (i % 10 === 0 ? 9 : i % 5 === 0 ? 6 : 3.5) * px;
    g.moveTo(toX(gx0), y);
    g.lineTo(toX(gx0) - len, y);
  }
  g.stroke();
  g.fillStyle = MUTED;
  g.font = `600 ${Math.round(6.5 * px)}px ${FONT_MONO}`;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  for (let i = 10; i < n; i += 10) g.fillText(String(i), toX(gx0 + i * TICK) + 1.5 * px, toY(gz0) - 3.5 * px);
}

/**
 * A straight prism along x from a convex (z, y) profile (clockwise seen from +x), flat-shaded, non-indexed, outward
 * normals, with its own `_outline_normal`: the long faces push the ink rim out along the profile's corner normals only,
 * so a long edge gets the full stroke (averaging in the end caps' sideways normals would halve it), and the end caps
 * push out along their own axis plus the profile's.
 */
function prism(profile: ReadonlyArray<readonly [number, number]>, x0: number, x1: number): BufferGeometry {
  const pos: number[] = [];
  const out: number[] = [];
  const k = profile.length;
  // The outward normal of each profile corner, (nz, ny): the mean of its two edges' outward normals.
  const corner = profile.map((_, i) => {
    const [za, ya] = profile[(i + k - 1) % k]!;
    const [zb, yb] = profile[i]!;
    const [zc, yc] = profile[(i + 1) % k]!;
    // Counter-clockwise in (z, y) (z across, y up), so an edge (dz, dy) has the outward normal (dy, -dz).
    const n1 = Math.hypot(zb - za, yb - ya) || 1;
    const n2 = Math.hypot(zc - zb, yc - yb) || 1;
    const nz = (yb - ya) / n1 + (yc - yb) / n2;
    const ny = -(zb - za) / n1 - (zc - zb) / n2;
    const n = Math.hypot(nz, ny) || 1;
    return [nz / n, ny / n] as const;
  });
  const v = (x: number, i: number, cap: number) => {
    pos.push(x, profile[i]![1], profile[i]![0]);
    const [nz, ny] = corner[i]!;
    const l = Math.hypot(cap, ny, nz) || 1;
    out.push(cap / l, ny / l, nz / l);
  };
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    v(x0, i, 0), v(x1, i, 0), v(x1, j, 0);
    v(x0, i, 0), v(x1, j, 0), v(x0, j, 0);
  }
  for (let i = 1; i < k - 1; i++) {
    v(x1, 0, 1), v(x1, i + 1, 1), v(x1, i, 1);
    v(x0, 0, -1), v(x0, i, -1), v(x0, i + 1, -1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  g.setAttribute('_outline_normal', new BufferAttribute(new Float32Array(out), 3));
  return g;
}

/**
 * The mat `size` wide and deep, with the rail on its front edge, in `kit`'s frame (the table). `anisotropy` is the
 * renderer's, so the grid stays crisp at the shallow angle a seated person sees the back of the mat at.
 */
export function createWorkMat(kit: InkKit, size: { w: number; d: number }, opts: { anisotropy?: number; rail?: boolean } = {}): WorkMat {
  const group = new Group();
  group.name = 'look:mat';
  const { w, d } = size;
  const bands = BANDS.mat;
  const owned: Array<{ dispose(): void }> = [];

  // The mat: a rounded slab, its top printed, its edge banded by the sun, outlined in ink.
  const slab = new ExtrudeGeometry(roundedRect(w, d, MAT.radius), { depth: MAT.thickness, bevelEnabled: false, curveSegments: 4 });
  slab.rotateX(-Math.PI / 2);
  slab.translate(0, -MAT.thickness - MAT.sink, 0);
  paintBands(slab, bands);
  smoothOutlineNormals(slab, 1e-4);
  const canvas = makeCanvas(Math.round(w * 1000 * PX_PER_MM), Math.round(d * 1000 * PX_PER_MM));
  const paint = () => {
    paintMatTop(canvas, w, d, bands);
    texture.needsUpdate = true;
  };
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = opts.anisotropy ?? 8;
  // Cap uvs are the shape's own metres: map them onto the canvas (its top row is the mat's back, y = +d/2 in the shape).
  texture.repeat.set(1 / w, 1 / d);
  texture.offset.set(0.5, 0.5);
  paint();
  const offFonts = onFontsReady(paint);
  const top = new MeshBasicMaterial({ map: texture, toneMapped: false });
  const edge = kit.body(slab, 'fixed');
  const mat = new Mesh(slab, [top, edge] as Material[]);
  mat.name = 'look:mat:slab';
  mat.renderOrder = -1;
  group.add(mat);
  // The silhouette shares the slab; one material for every group, so it draws whole.
  const rim = kit.outline(mat, 2.8);
  owned.push(slab, texture, top, edge, rim.material as Material, { dispose: offFonts });

  if (opts.rail !== false) {
    // The rail: a wedge whose top passes through (front - depth/2, raise) at 30 degrees, high at the back.
    const front = d / 2;
    const zf = front - 0.004, zb = front - RAIL.depth;
    const zc = front - RAIL.depth / 2;
    const yAt = (z: number) => RAIL.raise + (zc - z) * Math.tan(RAIL.tiltRad);
    const inset = MAT.radius + 0.004;
    const body = prism(
      [
        [zf, 0],
        [zf, yAt(zf)],
        [zb, yAt(zb)],
        [zb, 0],
      ],
      -w / 2 + inset,
      w / 2 - inset,
    );
    paintBands(body, BANDS.mustard);
    const railMat = kit.body(body, 'fixed');
    const rail = new Mesh(body, railMat);
    rail.name = 'look:rail';
    group.add(rail);
    const railRim = kit.outline(rail, 2.8);
    const railShadow = kit.shadow(rail, 0);
    railShadow.raycast = () => undefined;
    // The shadow lives in the kit's root (it reads its source's pose relative to it), not in the group.
    owned.push(body, railMat, railRim.material as Material, railShadow.material as Material, { dispose: () => railShadow.removeFromParent() });
  }

  // Scenery: rays pass through to the parts and the plates.
  group.traverse((o) => {
    o.raycast = () => undefined;
  });
  return {
    group,
    dispose() {
      group.removeFromParent();
      for (const x of owned) x.dispose();
    },
  };
}
