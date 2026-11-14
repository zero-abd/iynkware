/**
 * Jumper wires as the bench figures draw them: a round wire banded by the sun in its colour (WIRE), the ink silhouette
 * round it and its flat cobalt shadow on the mat, drawing itself on from its first end when it arrives. Same arch and
 * the same `pointOf` as the bench's default tubes (bench/space.ts), so `worldOf({ kind: 'wire' })` does not move.
 * Three draw calls a wire (body, silhouette, shadow); one body material per colour.
 *
 *   benchInternals(app.bench)?.setWireRenderer(inkWires(app.world, app.bench.root, kit));
 */
import { Mesh, QuadraticBezierCurve3, TubeGeometry, Vector3, type Material, type Object3D, type World } from '@iwsdk/core';
import type { WireRenderer } from '../bench/space';
import { paintBands, type InkKit } from './ink';
import { drawOn } from './moves';
import { DURATION } from './motion';
import { bandsOf, WIRE, WIRE_FALLBACK } from './palette';

/** Board frame metres (real size): a 22 AWG jumper's insulation is about 1.8 mm across. */
const RADIUS = 0.0009;
const SEGMENTS = 32;
const RADIAL = 8;
/** The figure's wires carry a slightly lighter silhouette than bodies. */
const RIM = 2.2;

interface Drawn {
  readonly body: Mesh;
  readonly rim: Mesh;
  readonly shadow: Mesh;
  readonly mid: Vector3;
}

export interface InkWireOptions {
  /** Milliseconds to wait before the first wires draw on (the parts landing first, on the bench's arrival). */
  introDelay?: number;
}

export function inkWires(world: World, root: Object3D, kit: InkKit, opts: InkWireOptions = {}): WireRenderer {
  const drawn = new Map<string, Drawn>();
  const bodies = new Map<string, Material>();
  const introUntil = performance.now() + (opts.introDelay ?? 0);
  let introIndex = 0;

  const erase = (id: string) => {
    const d = drawn.get(id);
    if (!d) return;
    d.body.removeFromParent();
    d.shadow.removeFromParent();
    (d.rim.material as Material).dispose();
    (d.shadow.material as Material).dispose();
    d.body.geometry.dispose();
    drawn.delete(id);
  };

  return {
    draw(w, from, to) {
      const fresh = !drawn.has(w.id);
      erase(w.id);
      if (!from || !to) return;
      const a = from.clone();
      const b = to.clone();
      const ctrl = a.clone().add(b).multiplyScalar(0.5);
      ctrl.y = Math.max(a.y, b.y) + 0.007 + a.distanceTo(b) * 0.18;
      const curve = new QuadraticBezierCurve3(a, ctrl, b);
      const hex = WIRE[w.color ?? ''] ?? WIRE_FALLBACK;
      const geometry = paintBands(new TubeGeometry(curve, SEGMENTS, RADIUS, RADIAL, false), bandsOf(hex));
      let material = bodies.get(hex);
      if (!material) bodies.set(hex, (material = kit.body(geometry, 'sun')));
      const body = new Mesh(geometry, material);
      body.name = w.id;
      body.userData.wireId = w.id;
      root.add(body);
      const rim = kit.outline(body, RIM);
      rim.raycast = () => undefined;
      const shadow = kit.shadow(body, 0);
      shadow.raycast = () => undefined;
      drawn.set(w.id, { body, rim, shadow, mid: curve.getPoint(0.5) });
      if (fresh) {
        // The body, its silhouette and its shadow share the geometry, so one draw range draws all three on.
        const wait = Math.max(0, introUntil - performance.now());
        drawOn(world, body, { ms: DURATION.drawOn, step: RADIAL * 6, delay: wait > 0 ? wait + 90 * introIndex++ : 0 });
      }
    },
    erase,
    pointOf(id, out) {
      const d = drawn.get(id);
      return d ? out.copy(d.mid) : null;
    },
    dispose() {
      for (const id of [...drawn.keys()]) erase(id);
      for (const m of bodies.values()) m.dispose();
      bodies.clear();
    },
  };
}
