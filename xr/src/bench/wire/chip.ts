/**
 * The wire chip (design 5, "Colour"): a small panel of inked plates that opens by a selected wire, the ten project
 * colours in two rows of five, each with its name, and Remove. It stands facing the head, in the world (not scaled with
 * the board). It closes on a pick, on B or Y, on a select elsewhere and after `IDLE_MS` without hover. The module
 * decides what a pick does; this file only draws the chip and reports the pick.
 */
import { CircleGeometry, Euler, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe, Vec3 } from '../../contracts/common';
import type { Hand } from '../../contracts/input';
import { onLookFrame } from '../../look/runner';
import { hexNum, INK, WIRE } from '../../look/palette';
import { WIRE_COLOURS } from '../core/actions';
import { onLang, say } from '../core/text';
import { benchPlate, bindPlate, type Plate } from '../core/ui';
import { removeBound } from './entities';
import { WIRE_STRINGS, type WireStringKey } from './strings';
import type { WireColor } from '@/project/generated/types';

export const IDLE_MS = 8000;
const COLS = 5;
const CELL = 0.048;
const GAP = 0.006;
const PLATE_H = 0.008;
const ID_PREFIX = 'bench/wire/chip/';
/** How far above the wire's middle the chip's centre stands, metres. */
const LIFT_M = 0.075;
const SWATCH_R = 0.0105;
const SWATCH_DY = 0.0075;

const swatchGeometry = new CircleGeometry(1, 24);
const inkMaterial = new MeshBasicMaterial({ color: hexNum(INK), toneMapped: false });
const colourMaterials = new Map<string, MeshBasicMaterial>();
const colourMaterial = (hex: string): MeshBasicMaterial => {
  let m = colourMaterials.get(hex);
  if (!m) colourMaterials.set(hex, (m = new MeshBasicMaterial({ color: hexNum(hex), toneMapped: false })));
  return m;
};

export interface ChipHandlers {
  onColour(colour: WireColor): void;
  onRemove(): void;
  /** The chip closed itself (B or Y, a select elsewhere, idle). */
  onClose(): void;
}

export interface Chip {
  readonly wire: string;
  close(): void;
}

const _cam = new Vector3();
const _q = new Quaternion();
const _tq = new Quaternion();
const _w = new Vector3();

/** Whether a bound target is part of the chip itself. */
export const isChipTarget = (target: string): boolean => target.startsWith(ID_PREFIX);

export function openChip(app: XrApp, wire: string, at: Vec3, handlers: ChipHandlers): Chip {
  const group = new Group();
  group.name = 'bench:wire-chip';
  const plates: Plate[] = [];
  const offs: Unsubscribe[] = [];
  const meshes: Mesh[] = [];
  const names: Array<{ plate: Plate; key: WireStringKey }> = [];
  let closed = false;

  const rowW = COLS * CELL + (COLS - 1) * GAP;
  const rows = 2;
  const colourH = rows * CELL + (rows - 1) * GAP;
  const removeH = 0.036;
  const totalH = colourH + GAP + removeH;

  WIRE_COLOURS.forEach((colour, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = -rowW / 2 + CELL / 2 + col * (CELL + GAP);
    const y = totalH / 2 - CELL / 2 - row * (CELL + GAP);
    const key = `wire.colour.${colour}` as WireStringKey;
    const plate = benchPlate(app, { w: CELL, d: CELL, standing: true }, { icon: 'circle', label: say(app, WIRE_STRINGS, key) });
    plate.group.position.set(x, y, 0);
    group.add(plate.group);
    plates.push(plate);
    names.push({ plate, key });
    offs.push(bindPlate(app, plate, `${ID_PREFIX}${colour}`, () => handlers.onColour(colour)));
    // the swatch inside the plate's circle icon, in front of the face and its hover lift
    const hex = WIRE[colour] ?? WIRE.orange!;
    const rim = new Mesh(swatchGeometry, inkMaterial);
    rim.scale.setScalar(SWATCH_R + 0.0012);
    rim.position.set(x, y + SWATCH_DY, PLATE_H + 0.0022);
    const disc = new Mesh(swatchGeometry, colourMaterial(hex));
    disc.scale.setScalar(SWATCH_R);
    disc.position.set(x, y + SWATCH_DY, PLATE_H + 0.0024);
    for (const m of [rim, disc]) {
      m.raycast = () => undefined;
      group.add(m);
      meshes.push(m);
    }
  });

  const remove = benchPlate(app, { w: rowW, d: removeH, standing: true, row: true }, { icon: 'trash', label: say(app, WIRE_STRINGS, 'wire.remove') });
  remove.group.position.set(0, -totalH / 2 + removeH / 2, 0);
  group.add(remove.group);
  plates.push(remove);
  names.push({ plate: remove, key: 'wire.remove' });
  offs.push(bindPlate(app, remove, `${ID_PREFIX}remove`, () => handlers.onRemove()));
  offs.push(onLang(app, () => names.forEach((n) => n.plate.set({ label: say(app, WIRE_STRINGS, n.key) }))));

  // stands above the wire's middle, turned to the head and leaning back a little
  // (it hangs in the bench table, which is in metres and not scaled with the board; the table is a plain object, so
  // taking it down is `removeFromParent`)
  const table = app.bench.table;
  _w.set(at[0], at[1] + LIFT_M, at[2]);
  app.world.camera.getWorldPosition(_cam);
  const yaw = Math.atan2(_cam.x - _w.x, _cam.z - _w.z);
  table.updateWorldMatrix(true, false);
  group.position.copy(table.worldToLocal(_w));
  table.getWorldQuaternion(_tq).invert();
  group.quaternion.copy(_tq.multiply(_q.setFromEuler(new Euler(-0.3, yaw, 0, 'YXZ'))));
  table.add(group);

  // closing: B or Y, a select elsewhere, idle
  let hovers = 0;
  let lastHover = performance.now();
  const upHeld: Record<Hand, boolean> = { left: true, right: true };
  offs.push(
    app.input.onAny((e) => {
      if (isChipTarget(e.target)) {
        if (e.type === 'hover-start') hovers++;
        else if (e.type === 'hover-end') hovers = Math.max(0, hovers - 1);
        return;
      }
      if ((e.type === 'select-start' || e.type === 'grab-start') && e.target !== `bench/wire:${wire}`) close(true);
    }),
  );
  offs.push(
    onLookFrame(app.world, () => {
      const now = performance.now();
      if (hovers > 0) lastHover = now;
      else if (now - lastHover > IDLE_MS) return close(true);
      for (const hand of ['left', 'right'] as Hand[]) {
        const up = app.input.button(hand, 'upper').pressed;
        const edge = up && !upHeld[hand];
        upHeld[hand] = up;
        if (edge) return close(true);
      }
    }),
  );
  // the wire is gone (undone, removed elsewhere): so is its chip
  offs.push(
    app.bench.onLayout(() => {
      if (!app.bench.wirePath(wire)) close(true);
    }),
  );

  function close(report = false) {
    if (closed) return;
    closed = true;
    for (const off of offs) off();
    removeBound(app, group);
    for (const p of plates) p.dispose();
    for (const m of meshes) m.removeFromParent();
    group.removeFromParent();
    if (report) handlers.onClose();
  }

  return { wire, close: () => close(false) };
}
