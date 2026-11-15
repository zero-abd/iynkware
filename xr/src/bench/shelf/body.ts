/**
 * The shelf's own body, drawn as the mat is: three risers (one per tier, rising 0.04 m each), the walls of twelve trays,
 * and the standing board behind the top tier that carries the group tabs. One merged mesh in the ink material (three
 * tone bands, the heavy ink silhouette, the flat cobalt shadow on the mat), in the shelf's own frame (x right, z towards
 * the person, y up from the mat), so it is one draw for the body, one for the silhouette and one for the shadow.
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, type Material, type Object3D } from '@iwsdk/core';
import { inkKit, paintBands, smoothOutlineNormals, type InkJs } from '../../look/ink';
import { BANDS, type Bands } from '../../look/palette';
import { BASE, TIER_RISE, TIERS, type ShelfLayout } from './layout';

/** The standing header board behind the far tier: where it stands, and how tall it is. */
export const HEADER = { gap: 0.012, thick: 0.008, bottom: 0.125, height: 0.161, rowH: 0.048, rowGap: 0.004, margin: 0.0045 } as const;

/** Centre height of header row `r` (0 the top row). */
export const headerRowY = (r: number): number => HEADER.bottom + HEADER.height - HEADER.margin - HEADER.rowH / 2 - r * (HEADER.rowH + HEADER.rowGap);
/** z of the header board's front face, in the shelf's frame. */
export const headerFrontZ = (l: Pick<ShelfLayout, 'd'>): number => -l.d / 2 - HEADER.gap;

const WALL = { thick: 0.003, high: 0.007 } as const;

interface Piece {
  readonly geometry: BufferGeometry;
  readonly bands: Bands;
}

function box(w: number, h: number, d: number, cx: number, cy: number, cz: number, bands: Bands): Piece {
  const g = new BoxGeometry(w, h, d).toNonIndexed();
  g.translate(cx, cy, cz);
  return { geometry: g, bands };
}

/** Concatenates non-indexed geometries (position, normal, uv) into one. */
function merge(pieces: readonly Piece[]): BufferGeometry {
  let n = 0;
  for (const p of pieces) n += p.geometry.attributes.position!.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const p of pieces) {
    const a = p.geometry.attributes;
    pos.set(a.position!.array as Float32Array, o * 3);
    nor.set(a.normal!.array as Float32Array, o * 3);
    uv.set(a.uv!.array as Float32Array, o * 2);
    o += a.position!.count;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  return g;
}

export interface ShelfBody {
  readonly group: Group;
  dispose(): void;
}

/** The shelf body in `layout`; `ink` null draws it in plain vertex colours (the ink material is not in the tree). */
export function createShelfBody(ink: InkJs | null, root: Object3D, parent: Object3D, layout: ShelfLayout): ShelfBody {
  const pieces: Piece[] = [];
  for (let t = 0; t < TIERS; t++) {
    const top = BASE + t * TIER_RISE;
    pieces.push(box(layout.w, top, layout.tierD, 0, top / 2, layout.d / 2 - (t + 0.5) * layout.tierD, BANDS.cobalt));
  }
  const { thick, high } = WALL;
  for (const b of layout.bins) {
    const w = b.w, d = b.d, y = b.y + high / 2;
    pieces.push(box(thick, high, d, b.x - w / 2 + thick / 2, y, b.z, BANDS.mustard));
    pieces.push(box(thick, high, d, b.x + w / 2 - thick / 2, y, b.z, BANDS.mustard));
    pieces.push(box(w - 2 * thick, high, thick, b.x, y, b.z - d / 2 + thick / 2, BANDS.mustard));
    pieces.push(box(w - 2 * thick, high * 0.6, thick, b.x, b.y + (high * 0.6) / 2, b.z + d / 2 - thick / 2, BANDS.mustard));
  }
  // the header board stands behind the far tier
  pieces.push(box(layout.w, HEADER.height, HEADER.thick, 0, HEADER.bottom + HEADER.height / 2, headerFrontZ(layout) - HEADER.thick / 2, BANDS.board));

  const geometry = merge(pieces);
  const perVertex: Bands[] = [];
  for (const p of pieces) for (let i = 0, c = p.geometry.attributes.position!.count; i < c; i++) perVertex.push(p.bands);
  paintBands(geometry, (i) => perVertex[i]!);
  smoothOutlineNormals(geometry, 1e-4);
  for (const p of pieces) p.geometry.dispose();

  const group = new Group();
  group.name = 'bench:shelf';

  const owned: Array<{ dispose(): void }> = [geometry];
  let material: Material;
  let mesh: Mesh;
  let shadow: Mesh | null = null;
  if (ink) {
    const kit = inkKit(ink, root);
    material = kit.body(geometry, 'fixed');
    mesh = new Mesh(geometry, material);
    group.add(mesh);
    const rim = kit.outline(mesh, 2.4);
    owned.push(rim.material as Material);
    mesh.updateWorldMatrix(true, false);
    // the shadow lives in the table (it reads its source's pose relative to it)
    parent.add(group);
    shadow = kit.shadow(mesh, 0);
    shadow.raycast = () => undefined;
    owned.push(shadow.material as Material);
  } else {
    material = new MeshBasicMaterial({ vertexColors: true });
    mesh = new Mesh(geometry, material);
    group.add(mesh);
  }
  owned.push(material);
  mesh.name = 'bench:shelf-body';
  mesh.raycast = () => undefined;
  group.traverse((o) => {
    o.raycast = () => undefined;
  });
  if (!group.parent) parent.add(group);

  return {
    group,
    dispose() {
      shadow?.removeFromParent();
      group.removeFromParent();
      for (const x of owned) x.dispose();
    },
  };
}
