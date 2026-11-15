/**
 * What a ray or a pinch can select of a wire: a few invisible thin boxes along its drawn path (`app.bench.wirePath`),
 * at least 20 mm thick in the world, leaving the first and last fifth of the path free so the cells at its ends stay
 * reachable. Rebuilt on `onLayout` and when the work scale changes, never per frame. A tap (a `select`, or a grab that
 * ends within `TAP_MOVE_M` of where it began: a wire has nothing to hold, so how long it was held does not matter) calls `onSelect`.
 */
import { BoxGeometry, Mesh, MeshBasicMaterial, Quaternion, Vector3, type Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe, Vec3 } from '../../contracts/common';
import type { InteractionEvent } from '../../contracts/input';
import { removeBound } from './entities';
import { breadboardViewOf } from '../core/actions';
import { TAP_MOVE_M } from '../core/gesture';
import { POINTER_EVENTS_ORDER } from '../core/priority';
import { PROXY_ORDER_BASE } from '../core/router';

/** The free ends of a path, as a fraction of its length on each side. */
export const END_FREE = 0.2;
/** The boxes a wire is covered with between its free ends. */
export const BOXES = 4;
/** The least thickness of a hit box in the world, metres. */
export const MIN_THICK_M = 0.02;

/** One hit box: its centre, its length along the path and the direction (unit), board frame. */
export interface HitBox {
  readonly centre: Vec3;
  readonly length: number;
  readonly dir: Vec3;
}

/**
 * Boxes along `path` between its free ends: the points from `END_FREE` to `1 - END_FREE` of the way (by index), cut
 * into at most `BOXES` runs; each box is the chord of its run. Pure.
 */
export function boxesAlong(path: readonly Vec3[], boxes = BOXES): HitBox[] {
  const n = path.length;
  if (n < 2) return [];
  const first = Math.ceil((n - 1) * END_FREE);
  const last = Math.floor((n - 1) * (1 - END_FREE));
  if (last <= first) return [];
  const runs = Math.min(boxes, last - first);
  const out: HitBox[] = [];
  for (let k = 0; k < runs; k++) {
    const i0 = first + Math.round(((last - first) * k) / runs);
    const i1 = first + Math.round(((last - first) * (k + 1)) / runs);
    const a = path[i0]!;
    const b = path[i1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-6) continue;
    out.push({ centre: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], length, dir: [dx / length, dy / length, dz / length] });
  }
  return out;
}

const boxGeometry = new BoxGeometry(1, 1, 1);
const boxMaterial = new MeshBasicMaterial({ visible: false });
const X = new Vector3(1, 0, 0);
const _d = new Vector3();
const _q = new Quaternion();

interface Rec {
  mesh: Mesh;
  unbind: Unsubscribe;
}

export function createWireHits(
  app: XrApp,
  root: Object3D,
  onSelect: (wire: string, e: InteractionEvent) => void,
  onHover?: (wire: string, on: boolean) => void,
): Unsubscribe {
  let recs: Rec[] = [];
  const offs: Unsubscribe[] = [];

  const clear = () => {
    for (const r of recs) {
      r.unbind();
      removeBound(app, r.mesh);
    }
    recs = [];
  };

  const make = (wire: string, box: HitBox, thick: number, index: number) => {
    const mesh = new Mesh(boxGeometry, boxMaterial);
    mesh.name = `bench:wire-hit:${wire}:${index}`;
    mesh.pointerEventsOrder = PROXY_ORDER_BASE + POINTER_EVENTS_ORDER['wire-end'];
    const restore = () => {
      mesh.position.set(box.centre[0], box.centre[1], box.centre[2]);
      mesh.quaternion.copy(_q.setFromUnitVectors(X, _d.set(box.dir[0], box.dir[1], box.dir[2])));
      mesh.scale.set(box.length, thick, thick);
      mesh.updateMatrix();
    };
    restore();
    root.add(mesh);
    let down: { t: number; x: number; y: number; z: number } | null = null;
    const unbind = app.input.bind(mesh, { id: `bench/wire:${wire}`, ray: true, grab: 'both' }, (e) => {
      if (e.type === 'hover-start' || e.type === 'hover-end') {
        onHover?.(wire, e.type === 'hover-start');
        return;
      }
      if (e.type === 'select') {
        onSelect(wire, e);
        return;
      }
      if (e.type === 'grab-start') {
        down = { t: performance.now(), x: e.pointer.origin[0], y: e.pointer.origin[1], z: e.pointer.origin[2] };
        return;
      }
      if (e.type === 'grab-end') {
        // IWSDK's grab moves the bound box; it goes back where it was
        restore();
        const d = down;
        down = null;
        if (!d) return;
        const moved = Math.hypot(e.pointer.origin[0] - d.x, e.pointer.origin[1] - d.y, e.pointer.origin[2] - d.z);
        if (moved <= TAP_MOVE_M) onSelect(wire, e);
      }
    });
    recs.push({ mesh, unbind });
  };

  const rebuild = () => {
    clear();
    const view = breadboardViewOf(app.project.doc);
    const thick = MIN_THICK_M / app.bench.scale.value;
    for (const w of view?.wires ?? []) {
      const path = app.bench.wirePath(w.id);
      if (!path) continue;
      boxesAlong(path).forEach((box, i) => make(w.id, box, thick, i));
    }
  };

  rebuild();
  offs.push(app.bench.onLayout(rebuild));
  offs.push(app.bench.scale.subscribe(rebuild));
  return () => {
    for (const off of offs) off();
    clear();
  };
}
