/**
 * The companion: a small inked bunny (a white body in three bands, tall ears, ink eyes and nose, an ink silhouette and
 * the flat blue shadow on the mat), in the bench's table frame (metres, +z toward the person). It
 * hovers at the bench edge, points its nib and an ink leader at an anchor, and flies along eased arcs. Under reduced
 * motion a flight is a short fade out and in at the far end, and nothing bobs or wobbles (XR_DESIGN.md 11.2).
 *
 * Three draws: the body (one merged geometry), its silhouette and its shadow; the leader is a fourth while pointing.
 * Nothing allocates per frame.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type World,
} from '@iwsdk/core';
import type { Unsubscribe } from '../../contracts/common';
import { shadowOffset } from '../../look/light';
import { easeIynk } from '../../look/motion';
import type { MotionRunner } from '../../look/motion';
import { FIGURE_ACCENT, hexNum, INK, SHADOW } from '../../look/palette';
import { motionOf, onLookFrame } from '../../look/runner';
import { bodyMaterial, hullOf, merge, outlineMaterial, paintBands, paintFlat } from './ink';
import { arcLift, arcPoint, flightMs, turnTo, yawTowards } from './pose';

export type Mood = 'idle' | 'thinking' | 'busy' | 'done';

export interface FlightOptions {
  ms?: number;
  /** How high the arc rises above the higher end, metres. */
  lift?: number;
  /** Called with the eased progress each frame (a carried part follows it). */
  onUpdate?(k: number): void;
}

export interface Companion {
  /** In the table frame. */
  readonly group: Group;
  /** Where it is now (its body centre), table frame. Live: copy what you keep. */
  readonly position: Vector3;
  /** Flies to `to` (table frame) along an eased arc. A newer flight replaces this one, which then resolves where it was. */
  flyTo(to: Vector3, opts?: FlightOptions): Promise<void>;
  /**
   * Travels along `path` (k 0..1 to a table-frame point, written into `out`) over `ms`, eased: drawing a wire follows
   * the wire. Replaces any running flight, like `flyTo`.
   */
  travel(path: (k: number, out: Vector3) => void, opts: { ms: number; onUpdate?(k: number): void }): Promise<void>;
  /** Points the nib and the leader at a table-frame point, or stops pointing. */
  point(at: Vector3 | null): void;
  mood(m: Mood): void;
  /** Build mode's outfit: sunglasses and a hi-vis worker vest; off is the plain bunny. */
  outfit(on: boolean): void;
  dispose(): void;
}

/** Body radius, metres: the bunny stands about 15 cm tall, big enough to read as company beside the work. */
export const BODY_R = 0.042;
const OUTLINE = 0.0011;

/** The bunny's white, a touch warmer than the paper so it reads against the mat. */
const FUR = '#fbf8f1';

/** A sphere of radius `BODY_R`, squashed to `sx, sy, sz`, tipped by `tilt` about z, at `x, y, z` (all in BODY_R). */
function blob(sx: number, sy: number, sz: number, x: number, y: number, z: number, tilt = 0, seg = 16): BufferGeometry {
  const g = new SphereGeometry(BODY_R, seg + 4, seg);
  g.scale(sx, sy, sz);
  if (tilt) g.rotateZ(tilt);
  g.translate(x * BODY_R, y * BODY_R, z * BODY_R);
  return g;
}

/**
 * The companion as an inked bunny (sitting, facing +z): a pear body, a round head, two tall ears leaning apart, little
 * feet, two ink eyes and a nose. One merged geometry in the look kit's bands, so the hull outline makes the thick ink
 * line. The body centre stays at the origin, so flights and pointing are unchanged.
 */
function figureGeometry(): BufferGeometry {
  const fur = (g: BufferGeometry) => paintBands(g, FUR);
  const ink = (g: BufferGeometry) => paintFlat(g, INK);
  return merge([
    fur(blob(0.82, 0.95, 0.78, 0, -0.1, 0)), // body
    fur(blob(0.34, 0.2, 0.42, -0.42, -0.95, 0.42, 0, 10)), // feet
    fur(blob(0.34, 0.2, 0.42, 0.42, -0.95, 0.42, 0, 10)),
    fur(blob(0.66, 0.6, 0.62, 0, 1.05, 0.1)), // head
    fur(blob(0.2, 0.72, 0.14, -0.26, 2.05, -0.02, 0.16, 12)), // ears
    fur(blob(0.2, 0.72, 0.14, 0.3, 2.05, -0.02, -0.2, 12)),
    ink(blob(0.075, 0.1, 0.05, -0.24, 1.12, 0.66, 0, 8)), // eyes
    ink(blob(0.075, 0.1, 0.05, 0.24, 1.12, 0.66, 0, 8)),
    ink(blob(0.08, 0.05, 0.05, 0, 0.96, 0.7, 0, 8)), // nose
  ]);
}

/** The vest's reflective stripes: pale silver against the hi-vis yellow. */
const REFLECT = '#d9dde3';

/**
 * Build mode's outfit, in the same frame and bands: a hi-vis vest just outside the body (open at the front, so the
 * fur shows down the middle) with two reflective stripes, and wraparound sunglasses over the eyes with a bridge.
 */
function outfitGeometry(): BufferGeometry {
  const vest = (g: BufferGeometry) => paintBands(g, FIGURE_ACCENT);
  const flat = (hex: string) => (g: BufferGeometry) => paintFlat(g, hex);
  const side = (x: number) => [
    vest(blob(0.5, 0.74, 0.82, x * 0.4, -0.18, -0.02)), // a vest panel over each side and the back
    flat(REFLECT)(blob(0.52, 0.06, 0.84, x * 0.4, -0.02, -0.02, 0, 10)), // reflective stripes
    flat(REFLECT)(blob(0.52, 0.06, 0.84, x * 0.4, -0.42, -0.02, 0, 10)),
  ];
  return merge([
    ...side(-1),
    ...side(1),
    vest(blob(0.84, 0.74, 0.6, 0, -0.18, -0.22)), // the back, joining the panels
    flat(INK)(blob(0.21, 0.16, 0.06, -0.25, 1.14, 0.67, 0, 10)), // lenses
    flat(INK)(blob(0.21, 0.16, 0.06, 0.25, 1.14, 0.67, 0, 10)),
    flat(INK)(blob(0.14, 0.03, 0.04, 0, 1.18, 0.7, 0, 8)), // bridge
    flat(INK)(blob(0.04, 0.03, 0.34, -0.5, 1.16, 0.38, 0, 8)), // arms back to the ears
    flat(INK)(blob(0.04, 0.03, 0.34, 0.5, 1.16, 0.38, 0, 8)),
  ]);
}

export function createCompanion(world: World, opts: { home: Vector3; top: () => { halfW: number; halfD: number } }): Companion {
  const motion: MotionRunner = motionOf(world);
  const group = new Group();
  group.name = 'assistant:companion';

  const figure = new Group();
  const geometry = figureGeometry();
  const bodyMat = bodyMaterial();
  const lineMat = outlineMaterial();
  const body = new Mesh(geometry, bodyMat);
  const hull = new Mesh(hullOf(geometry, OUTLINE), lineMat);
  hull.renderOrder = 1;
  body.renderOrder = 2;
  figure.add(hull, body);
  group.add(figure);

  const outfitGeo = outfitGeometry();
  const outfit = new Group();
  outfit.name = 'assistant:outfit';
  const outfitBody = new Mesh(outfitGeo, bodyMat);
  const outfitHull = new Mesh(hullOf(outfitGeo, OUTLINE), lineMat);
  outfitHull.renderOrder = 1;
  outfitBody.renderOrder = 3;
  outfit.add(outfitHull, outfitBody);
  outfit.visible = false;
  figure.add(outfit);

  const shadowMat = new MeshBasicMaterial({ color: hexNum(SHADOW), transparent: true, toneMapped: false, depthWrite: false });
  const shadow = new Mesh(new CircleGeometry(BODY_R * 0.9, 20), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.name = 'assistant:shadow';

  const leaderGeo = new BufferGeometry();
  const leaderPos = new BufferAttribute(new Float32Array(6), 3);
  leaderGeo.setAttribute('position', leaderPos);
  const leaderMat = new LineBasicMaterial({ color: hexNum(INK), transparent: true, toneMapped: false });
  const leader = new LineSegments(leaderGeo, leaderMat);
  leader.frustumCulled = false;
  leader.visible = false;
  leader.name = 'assistant:leader';

  // The shadow and leader are siblings of the figure in the table frame, so they never bob or turn with it.
  const parts = new Group();
  parts.add(group, shadow, leader);

  const pos = group.position.copy(opts.home);
  const pointAt = new Vector3();
  let pointing = false;
  let yaw = 0;
  let mood: Mood = 'idle';
  let clock = 0;
  let opacity = 1;
  let hop = 0;
  let flight: { cancel(): void; resolve(): void } | null = null;
  let travelYaw: number | null = null;
  const from = new Vector3();
  const [sdx, sdz] = shadowOffset();

  const setOpacity = (a: number) => {
    opacity = a;
    bodyMat.opacity = a;
    lineMat.opacity = a;
    shadowMat.opacity = a;
    leaderMat.opacity = a;
    group.visible = a > 0.01;
  };

  const endFlight = () => {
    const f = flight;
    flight = null;
    travelYaw = null;
    f?.cancel();
    f?.resolve();
  };

  const tick = (dt: number) => {
    clock += dt;
    const still = motion.reducedMotion;
    // Facing: where it travels, else what it points at, else the person (+z).
    let want = 0;
    if (travelYaw !== null) want = travelYaw;
    else if (pointing) want = yawTowards(pointAt.x - pos.x, pointAt.z - pos.z);
    yaw = still ? want : yaw + turnTo(yaw, want) * Math.min(1, dt * 9);
    figure.rotation.y = yaw;
    const busy = flight !== null;
    figure.position.y = hop + (still || busy ? 0 : Math.sin(clock * 2.1) * 0.0025);
    figure.rotation.z = !still && mood === 'thinking' ? Math.sin(clock * 3.2) * 0.14 : 0;
    figure.rotation.x = !still && mood === 'thinking' ? -0.12 : 0;

    // The flat shadow falls on the mat, so only over the bench top.
    const h = Math.max(0, pos.y);
    const sx = pos.x + sdx * h, sz = pos.z + sdz * h;
    const top = opts.top();
    shadow.position.set(sx, 0.0016, sz);
    shadow.visible = opacity > 0.01 && Math.abs(sx) <= top.halfW && Math.abs(sz) <= top.halfD;
    const s = 1 / (1 + h * 4);
    shadow.scale.set(s, s, s);

    leader.visible = pointing && opacity > 0.01;
    if (leader.visible) {
      const a = leaderPos.array as Float32Array;
      // from the nose
      a[0] = pos.x + Math.sin(yaw) * BODY_R * 0.75;
      a[1] = pos.y + figure.position.y + BODY_R * 0.96;
      a[2] = pos.z + Math.cos(yaw) * BODY_R * 0.75;
      a[3] = pointAt.x;
      a[4] = pointAt.y;
      a[5] = pointAt.z;
      leaderPos.needsUpdate = true;
    }
  };
  const offFrame: Unsubscribe = onLookFrame(world, tick);

  const _prev = new Vector3();
  const _end = new Vector3();
  function travel(path: (k: number, out: Vector3) => void, o: { ms: number; onUpdate?(k: number): void }): Promise<void> {
    endFlight();
    return new Promise<void>((resolve) => {
      if (motion.reducedMotion) {
        // A short fade out, then in at the far end: no travel to follow (XR_DESIGN.md 11.2).
        path(1, _end);
        const m = motion.tween({
          key: group,
          ms: 150,
          onUpdate: (k) => {
            setOpacity(k < 0.5 ? 1 - k * 2 : (k - 0.5) * 2);
            if (k >= 0.5) pos.copy(_end);
            o.onUpdate?.(k < 0.5 ? 0 : 1);
          },
          onDone: () => {
            setOpacity(1);
            flight = null;
            resolve();
          },
        });
        flight = { cancel: () => m.cancel(), resolve };
        return;
      }
      const m = motion.tween({
        key: group,
        ms: o.ms,
        ease: easeIynk,
        onUpdate: (k) => {
          _prev.copy(pos);
          path(k, pos);
          const dx = pos.x - _prev.x, dz = pos.z - _prev.z;
          if (dx * dx + dz * dz > 1e-10) travelYaw = yawTowards(dx, dz);
          o.onUpdate?.(k);
        },
        onDone: () => {
          flight = null;
          travelYaw = null;
          resolve();
        },
      });
      flight = { cancel: () => m.cancel(), resolve };
    });
  }

  return {
    group: parts,
    position: pos,
    flyTo(to, o = {}) {
      from.copy(pos);
      const target = to.clone();
      const distance = from.distanceTo(target);
      if (distance < 1e-4) {
        endFlight();
        o.onUpdate?.(1);
        return Promise.resolve();
      }
      const lift = o.lift ?? arcLift(from, target);
      const start = from.clone();
      return travel((k, out) => arcPoint(start, target, lift, k, out), { ms: o.ms ?? flightMs(distance), onUpdate: o.onUpdate });
    },
    travel,
    point(at) {
      pointing = at !== null;
      if (at) pointAt.copy(at);
    },
    outfit(on) {
      outfit.visible = on;
    },
    mood(m) {
      mood = m;
      if (m === 'done' && !motion.reducedMotion) {
        // A small hop of joy.
        motion.tween({ key: figure, ms: 420, onUpdate: (k) => (hop = Math.sin(k * Math.PI) * 0.012) });
      }
    },
    dispose() {
      endFlight();
      offFrame();
      motion.cancel(group);
      motion.cancel(figure);
      parts.removeFromParent();
      geometry.dispose();
      hull.geometry.dispose();
      outfitGeo.dispose();
      outfitHull.geometry.dispose();
      shadow.geometry.dispose();
      leaderGeo.dispose();
      bodyMat.dispose();
      lineMat.dispose();
      shadowMat.dispose();
      leaderMat.dispose();
    },
  };
}
