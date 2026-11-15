/**
 * The paper studio (XR_DESIGN.md 2.5): the room drawn instead of passthrough when the person picks the plain VR studio
 * (`settings.xr.space === 'vr'`) or the browser only offers `immersive-vr`. A paper dome, an ink horizon ring at 25 m
 * level with the eyes, a 6 m floor disc with an ink grid every 0.5 m at 12 %, and an inked table under the mat whose
 * flat shadow falls on the floor. It crossfades in and out over 500 ms (never a cut) and costs nothing while hidden.
 * Room light `dim` draws the dome and the floor in the dim tokens; ink stays.
 *
 * World frame for the room (local-floor: y = 0 is the floor, centred under the bench); the table lives in the bench's
 * table frame, so it follows the bench when it is placed again.
 */
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  SRGBColorSpace,
  BoxGeometry,
  ExtrudeGeometry,
  Shape,
  type Material,
} from '@iwsdk/core';
import type { Unsubscribe } from '../contracts/common';
import type { XrApp } from '../contracts/app';
import { benchGeometry, ringPoint, type TableRing } from '../bench/core/geometry';
import { paintBands, smoothOutlineNormals, type InkKit } from './ink';
import { MAT } from './mat';
import { DURATION } from './motion';
import { makeCanvas } from './paint';
import { BANDS, INK, ROOM, hexNum, mixHex } from './palette';
import { motionOf } from './runner';
import { uploadNow } from './upload';

/** XR_DESIGN.md 2.5. */
const DOME_R = 30;
const HORIZON_R = 25;
const FLOOR_R = 6;
const GRID = 0.5;
/** The eyes above the bench top, seated (XR_DESIGN.md 2.1). */
const EYES_ABOVE_TOP = 0.47;
const TABLE = { overhang: 0.03, thickness: 0.03, leg: 0.045, inset: 0.06 } as const;

/** Whether the studio is the room now. */
export const studioWanted = (mode: XrApp['mode']['value'], space: 'mr' | 'vr'): boolean => mode === 'vr' || (mode === 'mr' && space === 'vr');

/** Geometries merged into one non-indexed geometry, positions and normals (the table: top and legs, one draw call). */
function merged(list: readonly BufferGeometry[]): BufferGeometry {
  const parts = list.map((g) => {
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    return flat;
  });
  const count = parts.reduce((n, g) => n + g.attributes.position!.count, 0);
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position!.array as Float32Array, o * 3);
    nor.set(g.attributes.normal!.array as Float32Array, o * 3);
    o += g.attributes.position!.count;
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  return out;
}

/**
 * The half-round table top (bench/core/geometry.ts `table`), `overhang` wider each way, lying with its top at y = 0:
 * an annular sector extruded `thickness` down. Shape y is -z (rotated flat below).
 */
function ringSlab(t: TableRing, overhang: number, thickness: number): BufferGeometry {
  const inner = t.inner - overhang, outer = t.outer + overhang;
  const half = t.halfSpanRad + overhang / t.inner;
  const shape = new Shape();
  const at = (r: number, a: number): [number, number] => [Math.sin(a) * r, Math.cos(a) * r - t.cz];
  shape.moveTo(...at(outer, -half));
  shape.absarc(0, -t.cz, outer, Math.PI / 2 + half, Math.PI / 2 - half, true);
  shape.lineTo(...at(inner, half));
  shape.absarc(0, -t.cz, inner, Math.PI / 2 - half, Math.PI / 2 + half, false);
  shape.closePath();
  const g = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 48 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -thickness, 0);
  return g;
}

function paintFloor(canvas: HTMLCanvasElement, paper: string) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const S = canvas.width;
  const px = S / (FLOOR_R * 2); // canvas px per metre
  g.fillStyle = paper;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = INK;
  g.globalAlpha = 0.12;
  g.lineWidth = Math.max(1.5, S / 1400);
  g.beginPath();
  for (let v = -FLOOR_R; v <= FLOOR_R + 1e-9; v += GRID) {
    const c = (v + FLOOR_R) * px;
    g.moveTo(c, 0);
    g.lineTo(c, S);
    g.moveTo(0, c);
    g.lineTo(S, c);
  }
  g.stroke();
  // The disc's own edge, in full ink.
  g.globalAlpha = 1;
  g.lineWidth = Math.max(3, S / 500);
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - g.lineWidth, 0, Math.PI * 2);
  g.stroke();
}

/** Mounts the studio; `kit` is ink in the bench's table frame. */
export function mountStudio(app: XrApp, kit: InkKit): Unsubscribe {
  const room = new Group();
  room.name = 'look:studio';
  room.visible = false;
  const fades: MeshBasicMaterial[] = [];
  const owned: Array<{ dispose(): void }> = [];
  const basic = (color: string, side = DoubleSide as typeof DoubleSide | typeof BackSide) => {
    const m = new MeshBasicMaterial({ color: hexNum(color), side, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    fades.push(m);
    owned.push(m);
    return m;
  };

  const dome = new Mesh(new SphereGeometry(DOME_R, 48, 24), basic(ROOM.bright.paper, BackSide));
  dome.renderOrder = -100;
  const horizon = new Mesh(new CylinderGeometry(HORIZON_R, HORIZON_R, 0.14, 160, 1, true), basic(INK));
  horizon.renderOrder = -99;
  const canvas = makeCanvas(2048, 2048);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  const floorMat = basic('#ffffff');
  floorMat.map = texture;
  const floor = new Mesh(new CircleGeometry(FLOOR_R, 96), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.renderOrder = -98;
  room.add(dome, horizon, floor);
  for (const o of [dome, horizon, floor]) {
    o.raycast = () => undefined;
    owned.push(o.geometry);
  }
  owned.push(texture);
  app.world.scene.add(room);

  // The table under the mat: in the table frame, so it follows the bench; its shadow falls on the floor.
  const table = new Group();
  table.name = 'look:studio:table';
  table.visible = false;
  app.bench.table.add(table);
  let tableParts: Array<{ dispose(): void }> = [];
  let shadow: Mesh | undefined;

  const paint = () => {
    const tokens = ROOM[app.settings.xr.value.roomLight === 'dim' ? 'dim' : 'bright'];
    (dome.material as MeshBasicMaterial).color.set(tokens.paper);
    paintFloor(canvas, mixHex(tokens.paper, INK, 0.06));
    texture.needsUpdate = true;
    uploadNow(texture);
  };

  const build = () => {
    for (const p of tableParts) p.dispose();
    tableParts = [];
    shadow?.removeFromParent();
    table.clear();
    const xr = app.settings.xr.value;
    const ring = benchGeometry(xr.posture, xr.dominantHand).table;
    const height = app.bench.benchTop.value.position[1];
    const y0 = -MAT.thickness - MAT.sink;
    const legH = Math.max(0.05, height + y0 - TABLE.thickness);
    // Five legs: inside and outside at each end of the horseshoe, and one at the middle of the back (none at the
    // middle of the inner edge, where the knees go).
    const endA = ring.halfSpanRad - TABLE.inset / ring.inner;
    const legs = [
      ringPoint(ring, -endA, ring.inner + TABLE.inset),
      ringPoint(ring, -endA, ring.outer - TABLE.inset),
      ringPoint(ring, 0, ring.outer - TABLE.inset),
      ringPoint(ring, endA, ring.outer - TABLE.inset),
      ringPoint(ring, endA, ring.inner + TABLE.inset),
    ];
    const slab = ringSlab(ring, TABLE.overhang, TABLE.thickness).translate(0, y0, 0);
    const g = merged([
      slab,
      ...legs.map((l) => new BoxGeometry(TABLE.leg, legH, TABLE.leg).translate(l.x, y0 - TABLE.thickness - legH / 2, l.z)),
    ]);
    paintBands(g, BANDS.white);
    smoothOutlineNormals(g, 1e-5);
    const body = kit.body(g, 'fixed');
    const mesh = new Mesh(g, body);
    mesh.name = 'look:studio:table-body';
    mesh.raycast = () => undefined;
    table.add(mesh);
    const rim = kit.outline(mesh, 2.8);
    shadow = kit.shadow(mesh, -height);
    shadow.raycast = () => undefined;
    // The shadow lives in the table frame's root (the kit's); it shows and hides with the table.
    shadow.visible = table.visible;
    tableParts = [g, body, rim.material as Material, shadow.material as Material];
    // The room is centred under the bench.
    const p = app.bench.benchTop.value.position;
    room.position.set(p[0], 0, p[2]);
    horizon.position.y = height + EYES_ABOVE_TOP;
  };

  let shown = 0;
  let wanted = false;
  const key = {};
  const apply = () => {
    const want = studioWanted(app.mode.value, app.settings.xr.value.space);
    if (want === wanted) return;
    wanted = want;
    const from = shown, to = want ? 1 : 0;
    room.visible = true;
    motionOf(app.world).tween({
      key,
      ms: DURATION.crossfade,
      onUpdate: (k) => {
        shown = from + (to - from) * k;
        for (const m of fades) m.opacity = shown;
        // The table is solid ink: it appears at the middle of the crossfade rather than fading.
        table.visible = shown > 0.5;
        if (shadow) shadow.visible = table.visible;
      },
      onDone: () => {
        room.visible = shown > 0;
      },
    });
  };

  paint();
  build();
  apply();
  let last = app.settings.xr.value;
  const offs: Unsubscribe[] = [
    app.mode.subscribe(apply),
    app.settings.xr.subscribe((xr) => {
      if (xr.roomLight !== last.roomLight) paint();
      if (xr.posture !== last.posture || xr.dominantHand !== last.dominantHand) build();
      last = xr;
      apply();
    }),
    app.bench.benchTop.subscribe(build),
  ];
  return () => {
    for (const off of offs) off();
    motionOf(app.world).cancel(key);
    room.removeFromParent();
    table.removeFromParent();
    shadow?.removeFromParent();
    for (const p of [...tableParts, ...owned]) p.dispose();
  };
}
