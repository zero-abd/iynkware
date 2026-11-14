/**
 * A part that overheats and burns, shown where it sits (docs/XR_DESIGN.md section 4): wavy inked heat lines rising over
 * a hot part with a sizzle at it, and on burning a pop and three short inked smoke puffs that stay over the part and
 * fade in about 1.5 s. Everything is eased in and out, and reduced motion keeps the fades and drops the drift.
 *
 * Draw calls: one per hot part (all its lines are one mesh) and one for all the smoke. The effects are swappable: the
 * Art lead's shared effects (heat shimmer, smoke, spark) can replace `createHeatLines` and `createSmoke` behind the
 * same two functions.
 */
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type Object3D,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Vec3 } from '../../contracts/common';
import { ACCENT, CHAR, hexNum, INK, PAPER, PAPER_DIM, SHADOW } from '../../look/palette';
import { easeIynk } from '../../look/motion';
import { reducedMotionOf } from '../../look/index';
import { faceViewer } from '../kit/chip';
import { runFeedback, type LoopHandle } from '../kit/feedback';
import { onTick } from '../kit/ticker';

/** Where a part is: the top centre of its box in the world, and how wide it is. */
export interface Spot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The larger of its width and depth, metres. */
  readonly size: number;
}

const box = new Box3();
const part = new Box3();
const centre = new Vector3();
const extent = new Vector3();

/**
 * The world box of a part's solid meshes. The converted figures' fat-line meshes carry a bounding box far larger than
 * what they draw, so they (and anything outline-only) are left out.
 */
function boxOfSolids(object: Object3D, into: Box3): Box3 {
  into.makeEmpty();
  object.updateWorldMatrix(true, true);
  object.traverseVisible((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || /fat|outline|halo/i.test(o.name)) return;
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox) return;
    part.copy(g.boundingBox).applyMatrix4(mesh.matrixWorld);
    into.union(part);
  });
  return into;
}

/** The world spot of a part's object (its top centre), or null when it is not on the bench. */
export function spotOf(app: Pick<XrApp, 'bench'>, partId: string): Spot | null {
  const object = app.bench.objectOf(partId);
  if (!object) return null;
  boxOfSolids(object, box);
  if (box.isEmpty()) return null;
  box.getCenter(centre);
  box.getSize(extent);
  return { x: centre.x, y: box.max.y, z: centre.z, size: Math.max(extent.x, extent.z) };
}

/* ---------- heat lines ---------- */

const RIBBONS = 5;
const SEGMENTS = 9;
const FADE_RATE = 7;

const HEAT_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmount;
  uniform float uWidth;
  uniform float uHeight;
  uniform float uLine;
  attribute vec3 aRib;
  attribute vec2 aSeed;
  varying float vAlpha;
  varying float vHot;
  void main() {
    float life = fract(uTime * 0.42 + aSeed.x);
    float run = 0.5;
    float t = aRib.y;
    float y = (life * (1.0 - run) + t * run) * uHeight;
    float wave = sin(y / uHeight * 9.0 + uTime * 3.0 + aSeed.x * 6.28) * 0.1 * uWidth;
    float x = aRib.x * uWidth + wave + aRib.z * uLine * 0.5;
    vAlpha = sin(3.14159 * t) * sin(3.14159 * life) * uAmount;
    vHot = aSeed.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(x, y, 0.0, 1.0);
  }
`;

const HEAT_FRAG = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uHot;
  varying float vAlpha;
  varying float vHot;
  void main() {
    if (vAlpha < 0.02) discard;
    gl_FragColor = vec4(mix(uInk, uHot, vHot), min(1.0, vAlpha * 1.6));
    #include <colorspace_fragment>
  }
`;

let sharedRibbons: BufferGeometry | null = null;

/** Wavy ribbons across a unit width, rising from y 0; the vertex shader moves and fades them. */
function ribbonGeometry(): BufferGeometry {
  if (sharedRibbons) return sharedRibbons;
  const vertices = RIBBONS * (SEGMENTS + 1) * 2;
  const rib = new Float32Array(vertices * 3);
  const seed = new Float32Array(vertices * 2);
  const index: number[] = [];
  let v = 0;
  for (let r = 0; r < RIBBONS; r++) {
    const x = (r + 0.5) / RIBBONS - 0.5;
    const phase = (r * 0.37) % 1;
    // The middle ribbons are the accent: they are the hottest.
    const hot = r === 2 || r === 1 ? 1 : 0;
    for (let s = 0; s <= SEGMENTS; s++) {
      for (const side of [-1, 1]) {
        rib.set([x, s / SEGMENTS, side], v * 3);
        seed.set([phase, hot], v * 2);
        v++;
      }
      if (s < SEGMENTS) {
        const a = v - 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(vertices * 3), 3));
  g.setAttribute('aRib', new BufferAttribute(rib, 3));
  g.setAttribute('aSeed', new BufferAttribute(seed, 2));
  g.setIndex(index);
  g.boundingSphere = null;
  sharedRibbons = g;
  return g;
}

const color = (hex: string): Color => new Color().setHex(hexNum(hex));

function heatMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: HEAT_VERT,
    fragmentShader: HEAT_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uAmount: { value: 0 },
      uWidth: { value: 0.05 },
      uHeight: { value: 0.06 },
      uLine: { value: 0.003 },
      uInk: { value: color(INK) },
      uHot: { value: color(ACCENT) },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

export interface HeatLines {
  readonly object: Mesh;
  /** 0 to 1: how strong the lines are. */
  setAmount(a: number): void;
  place(spot: Spot): void;
  tick(time: number): void;
  dispose(): void;
}

/** Heat lines over a part: one mesh, one draw call. */
export function createHeatLines(): HeatLines {
  const mat = heatMaterial();
  const mesh = new Mesh(ribbonGeometry(), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.raycast = () => undefined;
  mesh.name = 'findings:heat';
  return {
    object: mesh,
    setAmount(a) {
      mat.uniforms.uAmount!.value = a;
      mesh.visible = a > 0.005;
    },
    place(spot) {
      mesh.position.set(spot.x, spot.y + spot.size * 0.04, spot.z);
      mat.uniforms.uWidth!.value = Math.min(0.2, Math.max(0.03, spot.size * 0.8));
      mat.uniforms.uHeight!.value = Math.min(0.2, Math.max(0.04, spot.size * 1.1));
      mat.uniforms.uLine!.value = Math.max(0.002, spot.size * 0.07);
    },
    tick(time) {
      mat.uniforms.uTime!.value = time;
    },
    dispose() {
      mesh.removeFromParent();
      mat.dispose();
    },
  };
}

/* ---------- smoke ---------- */

/** The most puffs alive at once; a new one takes the oldest slot. */
export const SMOKE_CAP = 18;
export const PUFFS_PER_BURN = 3;
/** One puff, seconds; the three start 0.2 s apart, so a burn is over in 1.5 s. */
export const PUFF_LIFE = 1.1;
export const PUFF_GAP = 0.2;

const SMOKE_VERT = /* glsl */ `
  attribute vec3 aAt;
  attribute vec2 aLife;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float t = clamp(aLife.x, 0.0, 1.0);
    float live = step(0.0, aLife.x) * step(aLife.x, 1.0);
    float grow = 0.55 + 0.7 * (1.0 - pow(1.0 - t, 3.0));
    vec4 mv = modelViewMatrix * vec4(aAt, 1.0);
    mv.xy += position.xy * aLife.y * grow * live;
    vUv = uv;
    vAlpha = live * smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.55, 1.0, t));
    gl_Position = projectionMatrix * mv;
  }
`;

const SMOKE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vec4 c = texture2D(uMap, vUv);
    if (c.a * vAlpha < 0.02) discard;
    gl_FragColor = vec4(c.rgb, c.a * vAlpha);
    #include <colorspace_fragment>
  }
`;

/** An inked puff: a scalloped cloud outline in ink, paper in three bands, a flat blue shadow on its lower right. */
function puffTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) {
    const lobes = [
      [0.5, 0.58, 0.26],
      [0.3, 0.62, 0.17],
      [0.7, 0.62, 0.17],
      [0.38, 0.4, 0.17],
      [0.62, 0.4, 0.17],
    ] as const;
    const cloud = (dx: number, dy: number, grow: number) => {
      g.beginPath();
      for (const [x, y, r] of lobes) {
        g.moveTo((x + dx) * size + (r + grow) * size, (y + dy) * size);
        g.arc((x + dx) * size, (y + dy) * size, (r + grow) * size, 0, Math.PI * 2);
      }
    };
    cloud(0.035, 0.035, 0);
    g.fillStyle = SHADOW;
    g.fill();
    cloud(0, 0, 0.018);
    g.fillStyle = INK;
    g.fill();
    cloud(0, 0, 0);
    g.fillStyle = PAPER_DIM;
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = PAPER;
    g.beginPath();
    g.ellipse(size * 0.42, size * 0.4, size * 0.2, size * 0.14, -0.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = CHAR;
    g.globalAlpha = 0.22;
    g.beginPath();
    g.ellipse(size * 0.6, size * 0.72, size * 0.28, size * 0.16, 0.2, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

export interface Smoke {
  readonly object: Mesh;
  /** Starts `PUFFS_PER_BURN` puffs over `spot`. */
  puff(spot: Spot, reduced: boolean): void;
  /** Ages the puffs; true while any is alive. */
  tick(dt: number): boolean;
  clear(): void;
  dispose(): void;
}

/** All the smoke of the bench: one instanced mesh of billboards, one draw call. */
export function createSmoke(): Smoke {
  const quad = new PlaneGeometry(1, 1);
  const geo = new InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  const at = new InstancedBufferAttribute(new Float32Array(SMOKE_CAP * 3), 3);
  const life = new InstancedBufferAttribute(new Float32Array(SMOKE_CAP * 2), 2);
  geo.setAttribute('aAt', at);
  geo.setAttribute('aLife', life);
  geo.instanceCount = SMOKE_CAP;
  const tex = puffTexture();
  const mat = new ShaderMaterial({
    vertexShader: SMOKE_VERT,
    fragmentShader: SMOKE_FRAG,
    uniforms: { uMap: { value: tex } },
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.raycast = () => undefined;
  mesh.name = 'findings:smoke';
  mesh.visible = false;
  // age in seconds per slot (negative: waiting to start), its length, whether it drifts
  const age = new Float32Array(SMOKE_CAP).fill(Infinity);
  const span = new Float32Array(SMOKE_CAP).fill(PUFF_LIFE);
  const home = new Float32Array(SMOKE_CAP * 3);
  const rise = new Float32Array(SMOKE_CAP);
  const size = new Float32Array(SMOKE_CAP);
  let next = 0;
  let alive = 0;

  const write = () => {
    for (let i = 0; i < SMOKE_CAP; i++) {
      const t = age[i]! / span[i]!;
      const ok = age[i]! >= 0 && t <= 1;
      life.setXY(i, ok ? t : -1, size[i]!);
      at.setXYZ(i, home[i * 3]!, home[i * 3 + 1]! + easeIynk(Math.min(1, Math.max(0, t))) * rise[i]!, home[i * 3 + 2]!);
    }
    at.needsUpdate = true;
    life.needsUpdate = true;
  };

  return {
    object: mesh,
    puff(spot, reduced) {
      for (let n = 0; n < PUFFS_PER_BURN; n++) {
        const i = next;
        next = (next + 1) % SMOKE_CAP;
        const side = (n - 1) * 0.28 * spot.size;
        age[i] = reduced ? 0 : -n * PUFF_GAP;
        span[i] = reduced ? 0.6 : PUFF_LIFE;
        home[i * 3] = spot.x + side;
        home[i * 3 + 1] = spot.y + spot.size * 0.25;
        home[i * 3 + 2] = spot.z + (n % 2 === 0 ? 0.004 : -0.004);
        rise[i] = reduced ? 0 : spot.size * (0.9 + 0.15 * n);
        size[i] = Math.max(0.03, spot.size * 0.9);
      }
      alive = 1;
      mesh.visible = true;
      write();
    },
    tick(dt) {
      if (!alive) return false;
      let any = false;
      for (let i = 0; i < SMOKE_CAP; i++) {
        if (age[i]! === Infinity) continue;
        age[i] = age[i]! + dt;
        if (age[i]! > span[i]!) age[i] = Infinity;
        else any = true;
      }
      write();
      if (!any) {
        alive = 0;
        mesh.visible = false;
      }
      return any;
    },
    clear() {
      age.fill(Infinity);
      alive = 0;
      mesh.visible = false;
      write();
    },
    dispose() {
      mesh.removeFromParent();
      geo.dispose();
      quad.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}

/* ---------- the two together ---------- */

export interface Heat {
  /** The part is hot (true) or has cooled (false). Idempotent. */
  hot(part: string, on: boolean): void;
  /** The part burnt: stops its heat, pops, and puffs smoke once. */
  burn(part: string): void;
  /** Mutes (true) or restores (false) the sizzle: a paused run is quiet. */
  silence(on: boolean): void;
  /** Reset: all heat, sizzle and smoke gone. */
  clear(): void;
  /** The bench laid out again: move the effects with their parts. */
  relayout(): void;
  /** Draw calls of the effects now. */
  readonly drawCalls: number;
  dispose(): void;
}

interface HotPart {
  lines: HeatLines;
  target: number;
  amount: number;
  loop: LoopHandle | null;
  at: Vec3;
}

/** Eases the sizzle of a loop in or out through its gain node (the kit's loop handle carries it). */
function ramp(handle: LoopHandle | null, to: number, seconds: number): void {
  const gain = (handle as unknown as { gain?: GainNode | null } | null)?.gain;
  if (!gain) return;
  const now = gain.context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(to, now + seconds);
}

const SIZZLE_GAIN = 0.12;

export function createHeat(app: XrApp): Heat {
  const root = new Group();
  root.name = 'findings:heat-root';
  app.world.scene.add(root);
  const fb = runFeedback(app);
  const parts = new Map<string, HotPart>();
  const smoke = createSmoke();
  root.add(smoke.object);
  let time = 0;
  let silenced = false;

  const stopSizzle = (p: HotPart) => {
    const handle = p.loop;
    p.loop = null;
    if (!handle) return;
    ramp(handle, 0, 0.15);
    setTimeout(() => handle.stop(), 200);
  };

  const drop = (part: string) => {
    const p = parts.get(part);
    if (!p) return;
    stopSizzle(p);
    p.lines.dispose();
    parts.delete(part);
  };

  const off = onTick(app.world, (dt, now) => {
    time = reducedMotionOf(app) ? 0 : now;
    const rate = 1 - Math.exp(-dt * FADE_RATE);
    for (const [part, p] of parts) {
      p.amount += (p.target - p.amount) * rate;
      if (p.target === 0 && p.amount < 0.01) {
        drop(part);
        continue;
      }
      p.lines.setAmount(p.amount);
      p.lines.tick(time);
      faceViewer(p.lines.object, app.world.camera, 0);
    }
    smoke.tick(dt);
  });

  return {
    hot(part, on) {
      let p = parts.get(part);
      if (!on) {
        if (p) {
          p.target = 0;
          stopSizzle(p);
        }
        return;
      }
      const spot = spotOf(app, part);
      if (!spot) return;
      if (!p) {
        const lines = createHeatLines();
        lines.place(spot);
        root.add(lines.object);
        p = { lines, target: 1, amount: 0, loop: null, at: [spot.x, spot.y, spot.z] };
        parts.set(part, p);
      }
      p.target = 1;
      if (!p.loop) {
        p.loop = fb.loop('hot', p.at);
        ramp(p.loop, silenced ? 0 : SIZZLE_GAIN, 0.3);
      }
    },
    silence(on) {
      silenced = on;
      for (const p of parts.values()) if (p.target > 0) ramp(p.loop, on ? 0 : SIZZLE_GAIN, 0.15);
    },
    burn(part) {
      drop(part);
      const spot = spotOf(app, part);
      if (!spot) return;
      fb.play('burnt', [spot.x, spot.y, spot.z]);
      smoke.puff(spot, reducedMotionOf(app));
    },
    clear() {
      for (const part of [...parts.keys()]) drop(part);
      smoke.clear();
    },
    relayout() {
      for (const [part, p] of parts) {
        const spot = spotOf(app, part);
        if (!spot) continue;
        p.lines.place(spot);
        p.at = [spot.x, spot.y, spot.z];
        p.loop?.move(p.at);
      }
    },
    get drawCalls() {
      return parts.size + (smoke.object.visible ? 1 : 0);
    },
    dispose() {
      off();
      for (const part of [...parts.keys()]) drop(part);
      smoke.dispose();
      root.removeFromParent();
    },
  };
}
