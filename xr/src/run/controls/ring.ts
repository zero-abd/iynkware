/**
 * The run ring (section 4): a dashed accent ring round each running board on the mat, crawling at 20 mm/s while the
 * run runs, ink and still while it is paused, gone when it stops. Under reduced motion it never crawls. One mesh (one
 * draw call) per board, one shared material and dash texture; the crawl moves the texture offset, so a frame
 * allocates nothing. Lives in the board frame (`bench.root`), so it follows the board and the work scale.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Box3,
  CanvasTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
} from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import { drawnBox } from '../../look/ink';
import { INK } from '../kit/tokens';
import { uploadNow } from '../../look/upload';

/** Board frame metres (real size; at the default 4x a 3 mm margin is 12 mm on the bench). */
const MARGIN = 0.003;
const WIDTH = 0.0006;
const RADIUS = 0.0025;
const LIFT = 0.0008;
/** One dash and its gap. */
const PERIOD = 0.003;
const DASH = 0.6;
/** Crawl speed as seen on the bench, m/s (section 4: 20 mm/s). */
const CRAWL = 0.02;
const ARC = 6;

/** A flat ribbon round the rounded rectangle x0..x1, z0..z1 at height y; u runs along it in dashes. */
export function ringGeometry(x0: number, z0: number, x1: number, z1: number): BufferGeometry {
  const r = Math.min(RADIUS, (x1 - x0) / 2, (z1 - z0) / 2);
  const corners: Array<[number, number, number]> = [
    [x1 - r, z0 + r, -Math.PI / 2],
    [x1 - r, z1 - r, 0],
    [x0 + r, z1 - r, Math.PI / 2],
    [x0 + r, z0 + r, Math.PI],
  ];
  const pts: Array<[number, number, number, number]> = [];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= ARC; i++) {
      const a = a0 + (i / ARC) * (Math.PI / 2);
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      pts.push([cx + nx * r, cz + nz * r, nx, nz]);
    }
  }
  pts.push(pts[0]!);
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const total = lengths[lengths.length - 1]!;
  // A whole number of dashes, so the seam does not show.
  const period = total / Math.max(1, Math.round(total / PERIOD));
  const pos = new Float32Array(pts.length * 2 * 3);
  const uv = new Float32Array(pts.length * 2 * 2);
  const index: number[] = [];
  pts.forEach(([px, pz, nx, nz], i) => {
    for (let side = 0; side < 2; side++) {
      const o = (side === 0 ? -WIDTH : WIDTH) / 2;
      const k = i * 2 + side;
      pos.set([px + nx * o, LIFT, pz + nz * o], k * 3);
      uv.set([lengths[i]! / period, side], k * 2);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

export interface BoardRings {
  set(mode: 'crawl' | 'still' | 'none'): void;
  /** Moves the dashes; call every frame. */
  tick(dt: number): void;
  /** Rebuilds the rings from the boards' current bounds. */
  rebuild(): void;
  dispose(): void;
}

export function createBoardRings(app: XrApp, reduced: () => boolean): BoardRings {
  const group = new Group();
  group.name = 'run-rings';
  group.visible = false;
  app.bench.root.add(group);

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 4;
  const g = canvas.getContext('2d');
  if (g) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, Math.round(64 * DASH), 4);
  }
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.generateMipmaps = false;
  tex.minFilter = LinearFilter;
  uploadNow(tex);
  const mat = new MeshBasicMaterial({ color: INK.accent, map: tex, alphaTest: 0.5, side: DoubleSide });

  const meshes: Mesh[] = [];
  const box = new Box3();
  const inv = new Matrix4();
  let mode: 'crawl' | 'still' | 'none' = 'none';

  const clear = () => {
    for (const m of meshes) {
      m.geometry.dispose();
      m.removeFromParent();
    }
    meshes.length = 0;
  };

  const rebuild = () => {
    clear();
    const doc = app.project.doc;
    // The boards that run code; a document whose boards carry none rings them all.
    const coded = doc.boards.filter((b) => b.firmware);
    app.bench.root.updateMatrixWorld(true);
    inv.copy(app.bench.root.matrixWorld).invert();
    for (const b of coded.length ? coded : doc.boards) {
      const object = app.bench.objectOf(b.id);
      if (!object) continue;
      // Bodies only: the ink's fat lines and halos are screen quads whose geometry would make the box metres wide.
      drawnBox(object, box).applyMatrix4(inv);
      if (box.isEmpty()) continue;
      const mesh = new Mesh(ringGeometry(box.min.x - MARGIN, box.min.z - MARGIN, box.max.x + MARGIN, box.max.z + MARGIN), mat);
      mesh.name = `run-ring:${b.id}`;
      mesh.raycast = () => undefined;
      group.add(mesh);
      meshes.push(mesh);
    }
  };

  return {
    set(next) {
      mode = next;
      group.visible = next !== 'none';
      mat.color.set(next === 'crawl' ? INK.accent : INK.ink);
    },
    tick(dt) {
      if (mode !== 'crawl' || reduced()) return;
      const scale = app.bench.scale.value || 1;
      tex.offset.x = (tex.offset.x - (dt * CRAWL) / scale / PERIOD) % 1;
    },
    rebuild,
    dispose() {
      clear();
      tex.dispose();
      mat.dispose();
      group.removeFromParent();
    },
  };
}
