/**
 * The ghost (design 3.4.5): a copy of the held part in the seat the fit found, its ink outline at full strength and its
 * bands at 45 % opacity, with a mark on every target hole: an accent dot for a free hole, a bad-coloured cross for a
 * taken one (named), a warn triangle for two legs in one strip. The ghost jumps from fit to fit; marks and ghost are
 * rewritten only when the fit or the leg statuses change (`GhostState` hands a new `legs` array when it looks again).
 * Pure drawing: the decision is `core/fit.ts`.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Vector3,
  type Material,
  type Mesh,
} from '@iwsdk/core';
import type { PartAsset } from '../../contracts/assets';
import { createCallout, type Callout } from '../../look/callout';
import { ACCENT, STATE, hexNum } from '../../look/palette';
import type { Fit, GhostState } from '../core/fit';
import type { BenchInternals } from '../space';

/** The bands' share of opacity on the ghost (design 3.4.5). */
export const GHOST_OPACITY = 0.45;
const CAPACITY = 64;
const MARK_LIFT = 0.0004;
const DOT_R = 0.00085;
const CROSS_R = 0.0012;
const TRI_R = 0.0014;

const Y = new Vector3(0, 1, 0);
const _a = new Vector3();
const _b = new Vector3();
const _m = new Matrix4();

/** Where a part with its legs in `legs` (pin to hole) stands in the board frame, as `space.ts` lays a seated part out. */
export function seatPose(
  asset: Pick<PartAsset, 'anchors'>,
  legs: Readonly<Record<string, string>>,
  holeAt: (hole: string, out: Vector3) => Vector3 | null,
  out: { position: Vector3; yaw: number },
): boolean {
  const entries = Object.entries(legs);
  const first = entries[0];
  if (!first) return false;
  const a1 = asset.anchors.get(first[0]);
  const h1 = holeAt(first[1], _a);
  if (!a1 || !h1) return false;
  let yaw = 0;
  const second = entries[1];
  const a2 = second ? asset.anchors.get(second[0]) : undefined;
  const h2 = second ? holeAt(second[1], _b) : null;
  if (a2 && h2) {
    const want = Math.atan2(h2.z - h1.z, h2.x - h1.x);
    const have = Math.atan2(a2.position[2] - a1.position[2], a2.position[0] - a1.position[0]);
    yaw = -(want - have);
  }
  out.yaw = yaw;
  out.position.set(a1.position[0], a1.position[1], a1.position[2]).applyAxisAngle(Y, yaw).multiplyScalar(-1).add(h1);
  return true;
}

function markGeometry(kind: 'dot' | 'cross' | 'tri'): BufferGeometry {
  if (kind === 'dot') {
    const g = new CircleGeometry(DOT_R, 20);
    g.rotateX(-Math.PI / 2);
    return g;
  }
  const g = new BufferGeometry();
  const v: number[] = [];
  const quad = (cx: number, cz: number, hx: number, hz: number, ang: number) => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const p = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([x, z]) => [cx + x! * c - z! * s, cz + x! * s + z! * c] as const);
    for (const k of [0, 1, 2, 0, 2, 3]) v.push(p[k]![0], 0, p[k]![1]);
  };
  if (kind === 'cross') {
    quad(0, 0, CROSS_R, CROSS_R * 0.28, Math.PI / 4);
    quad(0, 0, CROSS_R, CROSS_R * 0.28, -Math.PI / 4);
  } else {
    for (const [x, z] of [[0, -TRI_R], [TRI_R * 0.9, TRI_R * 0.7], [-TRI_R * 0.9, TRI_R * 0.7]] as const) v.push(x, 0, z);
  }
  g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
  return g;
}

interface Marks {
  readonly mesh: InstancedMesh;
  n: number;
}

export interface GhostView {
  /** The ghost's body, in the board frame (hidden without a fit). */
  readonly object: Object3D;
  /** Where the ghost stands now, or null when it shows no fit. */
  readonly pose: { position: Vector3; yaw: number } | null;
  /** Redraws what changed since the last call; hides everything when the ghost is not shown. */
  update(state: Readonly<GhostState>): void;
  hide(): void;
  dispose(): void;
}

/** `scale` is read through a function, so the tag's size follows the bench's scale. */
export function createGhostView(parent: Object3D, asset: PartAsset, bi: Pick<BenchInternals, 'anchorBoard'>, surface: string, scale: () => number): GhostView {
  const object = asset.instantiate();
  object.name = 'bench:ghost';
  object.visible = false;
  delete object.userData.partId;
  const owned: Material[] = [];
  const ghostify = (m: Material): Material => {
    const role = (m.userData as { inkRole?: string }).inkRole;
    if (role === 'line' || role === 'outline' || role === 'text') return m;
    const c = m.clone();
    const u = (c as { uniforms?: { uOpacity?: { value: number } } }).uniforms;
    if (u?.uOpacity) u.uOpacity.value = GHOST_OPACITY;
    else (c as Material & { opacity: number }).opacity = GHOST_OPACITY;
    c.transparent = true;
    c.depthWrite = false;
    owned.push(c);
    return c;
  };
  object.traverse((o) => {
    o.raycast = () => undefined;
    const mesh = o as Mesh;
    const m = mesh.material;
    if (!m) return;
    const role = (Array.isArray(m) ? m[0] : m)?.userData?.inkRole as string | undefined;
    if (role === 'shadow' || role === 'glow') {
      o.visible = false;
      return;
    }
    mesh.material = Array.isArray(m) ? m.map(ghostify) : ghostify(m);
  });
  parent.add(object);

  const markMaterial = (hex: string) => new MeshBasicMaterial({ color: hexNum(hex), side: DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const mk = (kind: 'dot' | 'cross' | 'tri', hex: string): Marks => {
    const mesh = new InstancedMesh(markGeometry(kind), markMaterial(hex), CAPACITY);
    mesh.name = `bench:ghost-${kind}`;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.raycast = () => undefined;
    parent.add(mesh);
    return { mesh, n: 0 };
  };
  const dots = mk('dot', ACCENT);
  const crosses = mk('cross', STATE.bad);
  const tris = mk('tri', STATE.warn);
  const kinds = [dots, crosses, tris];
  let tag: Callout | null = null;
  let tagName = '';

  const holePos = (hole: string, out: Vector3) => bi.anchorBoard(surface, hole, out);
  const push = (m: Marks, hole: string) => {
    if (m.n >= CAPACITY || !holePos(hole, _a)) return;
    m.mesh.setMatrixAt(m.n++, _m.makeTranslation(_a.x, _a.y + MARK_LIFT, _a.z));
  };
  const poseOut = { position: new Vector3(), yaw: 0 };
  let posed = false;
  let lastFit: Fit | null = null;
  let lastLegs: unknown = null;
  let lastShown = false;

  const clear = () => {
    for (const m of kinds) {
      m.n = 0;
      m.mesh.count = 0;
    }
    object.visible = false;
    posed = false;
    if (tag) tag.group.visible = false;
  };

  return {
    object,
    get pose() {
      return posed ? poseOut : null;
    },
    update(state) {
      if (!state.shown) {
        if (lastShown || lastFit !== null) clear();
        lastShown = false;
        lastFit = null;
        lastLegs = null;
        return;
      }
      if (lastShown && state.fit === lastFit && state.legs === lastLegs) return;
      lastShown = true;
      lastFit = state.fit;
      lastLegs = state.legs;
      clear();
      if (state.fit) {
        posed = seatPose(asset, state.fit.legs, holePos, poseOut);
        if (posed) {
          object.position.copy(poseOut.position);
          object.rotation.set(0, poseOut.yaw, 0);
          object.visible = true;
        }
        for (const hole of Object.values(state.fit.legs)) push(dots, hole);
      } else {
        for (const leg of state.legs) {
          if (!leg.hole) continue;
          push(leg.state === 'free' ? dots : leg.state === 'taken' ? crosses : tris, leg.hole);
        }
        const p = state.problem;
        if (p?.hole && holePos(p.hole, _a)) {
          tag ??= createCallout(p.hole, { bare: true, shape: 'tag', distance: 0.65, tone: 'fail' });
          if (tagName !== p.hole) {
            tagName = p.hole;
            tag.set(p.hole);
          }
          if (!tag.group.parent) parent.add(tag.group);
          const s = scale();
          tag.group.scale.setScalar(1 / s);
          tag.group.position.set(_a.x, _a.y + 0.014 / s + 0.004, _a.z);
          tag.group.visible = true;
        }
      }
      for (const m of kinds) {
        m.mesh.count = m.n;
        m.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    hide() {
      clear();
      lastShown = false;
      lastFit = null;
      lastLegs = null;
    },
    dispose() {
      clear();
      object.removeFromParent();
      for (const m of owned) m.dispose();
      for (const m of kinds) {
        m.mesh.removeFromParent();
        m.mesh.geometry.dispose();
        (m.mesh.material as Material).dispose();
        m.mesh.dispose();
      }
      tag?.dispose();
    },
  };
}
