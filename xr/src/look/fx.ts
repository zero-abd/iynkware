/**
 * The bench's inked effects (XR_DESIGN.md section 4): the pop ring at a committed contact, the snap ring, a spark, the
 * heat lines of a hot part and the smoke of a burnt one, drawn as iynk's figures draw marks: ink #231e16 lines, flat
 * fills, no gradients. Each kind is one instanced draw call with a hard cap (when full, the oldest instance is reused),
 * no post-processing and no textures. Every shape is shader maths on a camera-facing quad; the shaders read per-instance
 * attributes (start time, life, reduced motion, seed), so a one-shot uploads its instance once and then only the time
 * uniform changes. Heat and smoke follow their anchor: its world position is copied into the instance matrix each
 * frame, in place, and uploaded only when it moved. Nothing allocates per frame; an idle kind is not drawn at all.
 *
 *   const fx = createEffects(app.world);  fx.popRing(contact, surfaceNormal);  const hot = fx.heat(part);  hot.stop();
 *
 * Reduced motion is read from `motionOf(world).reducedMotion` when an effect starts: rings appear and fade without
 * growing, the spark is a static star for 150 ms, heat is three static wavy lines, smoke is one static wisp. Nothing
 * flashes: every mark fades in and out once (XR_DESIGN.md 11.1). Sizes are the spec's world sizes at `scale` 1. Ink
 * line weights are angular (dmm, docs/XR_DESIGN.md section 0), so a line reads the same at arm's length and across the
 * room. Pillars use the world's shared instance, `effectsOf(world)`, and never create their own.
 */
import {
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  type IUniform,
  type Object3D,
  Vector3,
  type World,
} from '@iwsdk/core';
import type { Unsubscribe } from '../contracts/common';
import { DURATION, easeIynk, REDUCED_MS } from './motion';
import { ACCENT, BANDS, INK } from './palette';
import { motionOf, onLookFrame } from './runner';

/* ---------- the instance pool, instance writes, scale ---------- */

/**
 * A fixed set of instance slots. A slot is live until its `until` time (seconds, the effects' clock; Infinity until
 * released). `acquire` takes the lowest free slot, or, when every slot is live, the one acquired longest ago.
 * Allocates nothing after creation.
 */
export interface InstancePool {
  readonly cap: number;
  acquire(now: number, until?: number): number;
  /** Frees a slot now (its holder's generation stops matching). */
  release(slot: number): void;
  /** Moves a live slot's end (a stopping effect that fades out first). */
  setUntil(slot: number, until: number): void;
  isLive(slot: number, now: number): boolean;
  /** Bumped every time the slot is acquired or released: a handle holds the generation it got. */
  generation(slot: number): number;
  /** Whether any slot is live at `now`. */
  anyLive(now: number): boolean;
}

export function createPool(cap: number): InstancePool {
  const n = Math.max(1, Math.floor(cap));
  const until = new Float64Array(n).fill(-Infinity);
  const order = new Float64Array(n);
  const gen = new Uint32Array(n);
  let seq = 0;
  return {
    cap: n,
    acquire(now, end = Infinity) {
      let pick = -1;
      let oldest = 0;
      for (let i = 0; i < n; i++) {
        if (until[i]! <= now) {
          pick = i;
          break;
        }
        if (order[i]! < order[oldest]!) oldest = i;
      }
      if (pick < 0) pick = oldest;
      until[pick] = end;
      order[pick] = ++seq;
      gen[pick] = gen[pick]! + 1;
      return pick;
    },
    release(slot) {
      if (slot < 0 || slot >= n) return;
      until[slot] = -Infinity;
      gen[slot] = gen[slot]! + 1;
    },
    setUntil(slot, end) {
      if (slot >= 0 && slot < n) until[slot] = end;
    },
    isLive: (slot, now) => slot >= 0 && slot < n && until[slot]! > now,
    generation: (slot) => gen[slot] ?? 0,
    anyLive(now) {
      for (let i = 0; i < n; i++) if (until[i]! > now) return true;
      return false;
    },
  };
}

/**
 * Writes a translation with a uniform scale into slot `i` of a mat4 array (column major, as three's instanceMatrix).
 * Scale 0 hides the instance (its quad collapses to a point). Returns whether anything changed.
 */
export function writeInstance(m: Float32Array, i: number, x: number, y: number, z: number, s: number): boolean {
  const o = i * 16;
  if (m[o] === s && m[o + 5] === s && m[o + 10] === s && m[o + 12] === x && m[o + 13] === y && m[o + 14] === z && m[o + 15] === 1)
    return false;
  m[o] = s;
  m[o + 1] = 0;
  m[o + 2] = 0;
  m[o + 3] = 0;
  m[o + 4] = 0;
  m[o + 5] = s;
  m[o + 6] = 0;
  m[o + 7] = 0;
  m[o + 8] = 0;
  m[o + 9] = 0;
  m[o + 10] = s;
  m[o + 11] = 0;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
  return true;
}

/** A size multiplier: a number, or a live value such as `app.bench.scale` (read when it is needed, never stored). */
export type ScaleOption = number | { readonly value: number };
export const readScale = (s: ScaleOption | undefined): number => {
  const v = typeof s === 'number' ? s : s?.value;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
};

/** Segments of the easing table the shaders read (`uEase`), so they move on the kit's own curve. */
export const EASE_STEPS = 32;
/** `easeIynk` sampled at EASE_STEPS + 1 points, for linear lookup in GLSL. */
export function easeTable(steps = EASE_STEPS): Float32Array {
  const t = new Float32Array(steps + 1);
  for (let i = 0; i <= steps; i++) t[i] = easeIynk(i / steps);
  return t;
}
/** What the shaders' `easeIynk` returns: the table, linearly interpolated. */
export function easeFromTable(table: ArrayLike<number>, k: number): number {
  const steps = table.length - 1;
  const x = Math.min(1, Math.max(0, k)) * steps;
  const i = Math.min(Math.floor(x), steps - 1);
  return table[i]! + (table[i + 1]! - table[i]!) * (x - i);
}

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** A float literal for GLSL. */
export const glsl = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/* ---------- the marks' maths (mirrored by the shaders below; tested in test/look/fx.test.ts) ---------- */

/** How long a stopped heat or smoke mark takes to fade out, ms. */
export const STOP_MS = REDUCED_MS;

/** Pop and snap rings: ink rings growing from 12 to 24 mm across while fading out (XR_DESIGN.md section 4). */
export const RING = {
  fromMm: 12,
  toMm: 24,
  /** Across, under reduced motion: one size, no growth. */
  reducedMm: 18,
  popMs: DURATION.popRing,
  snapMs: 120,
  /** Ink weight, dmm, and its limits on the mark, mm. */
  strokeDmm: 2.6,
  strokeMm: [0.8, 3] as const,
  /** Half the quad's side, mm. */
  boxMm: 14,
  /** Lifted off the surface when lying on it, mm; pulled toward the eye when facing it, mm. */
  liftMm: 0.6,
  pullMm: 8,
} as const;
export type RingKind = 'pop' | 'snap';

export const ringLife = (kind: RingKind, reduced: boolean): number => {
  const ms = kind === 'pop' ? RING.popMs : RING.snapMs;
  return reduced ? Math.min(ms, REDUCED_MS) : ms;
};

export interface RingFrame {
  radiusMm: number;
  opacity: number;
}
/** The ring `ageMs` into a life of `lifeMs`: it grows on the iynk curve and fades linearly; 0 opacity outside. */
export function ringAt(ageMs: number, lifeMs: number, reduced: boolean): RingFrame {
  const k = lifeMs > 0 ? ageMs / lifeMs : 1;
  const radiusMm = reduced ? RING.reducedMm / 2 : lerp(RING.fromMm / 2, RING.toMm / 2, easeIynk(clamp01(k)));
  return { radiusMm, opacity: k < 0 || k > 1 ? 0 : 1 - k };
}

/** The spark: 6 to 8 short ink strokes flying out of a mustard core that shrinks away, 250 ms. */
export const SPARK = {
  ms: 250,
  /** Strokes, picked per spark by its seed. */
  minStrokes: 6,
  maxStrokes: 8,
  /** Each stroke's inner and outer end from the centre, mm, at the start and the end. */
  innerMm: [2.5, 9] as const,
  outerMm: [5.5, 11] as const,
  coreMm: 3.2,
  /** Fully opaque until this share of its life, then fading. */
  holdK: 0.55,
  /** The static star under reduced motion. */
  reduced: { innerMm: 4, outerMm: 8.5, coreMm: 2.6 },
  strokeDmm: 2.3,
  strokeMm: [0.6, 2.2] as const,
  boxMm: 13,
  pullMm: 8,
} as const;

export const sparkLife = (reduced: boolean): number => (reduced ? REDUCED_MS : SPARK.ms);
export const sparkStrokes = (seed: number): number =>
  SPARK.minStrokes + Math.min(SPARK.maxStrokes - SPARK.minStrokes, Math.floor(clamp01(seed) * (SPARK.maxStrokes - SPARK.minStrokes + 1)));

export interface SparkFrame {
  innerMm: number;
  outerMm: number;
  coreMm: number;
  opacity: number;
}
export function sparkAt(ageMs: number, reduced: boolean): SparkFrame {
  const life = sparkLife(reduced);
  const k = ageMs / life;
  const on = k >= 0 && k <= 1;
  if (reduced) {
    const r = SPARK.reduced;
    return { innerMm: r.innerMm, outerMm: r.outerMm, coreMm: r.coreMm, opacity: on ? 1 - k : 0 };
  }
  const e = easeIynk(clamp01(k));
  return {
    innerMm: lerp(SPARK.innerMm[0], SPARK.innerMm[1], e),
    outerMm: lerp(SPARK.outerMm[0], SPARK.outerMm[1], e),
    coreMm: SPARK.coreMm * (1 - e),
    opacity: on ? (k < SPARK.holdK ? 1 : 1 - (k - SPARK.holdK) / (1 - SPARK.holdK)) : 0,
  };
}

/** Heat: three wavy ink lines rising above a hot part, a 1.2 s loop, each fading in low and out high. */
export const HEAT = {
  loopMs: 1200,
  /** Lines' x on the mark, mm (left, middle, right), and each line's wave phase. */
  xMm: [-5, 0, 5] as const,
  phase: [0, 2.1, 4.2] as const,
  /** A line's length, how far it rises in one loop, and where its bottom starts above the anchor, mm. */
  lengthMm: 12,
  travelMm: 16,
  baseMm: 3,
  ampMm: 1.2,
  waveMm: 8,
  /** Fades in over this share of its loop and out over the last `fadeOut`. */
  fadeIn: 0.2,
  fadeOut: 0.35,
  /** The whole mark fades in over this when it starts, ms. */
  startMs: 150,
  /** The static lines under reduced motion: bottom above the anchor, mm; the middle one sits higher. */
  reducedBaseMm: 6,
  reducedMiddleMm: 2,
  strokeDmm: 2.3,
  strokeMm: [0.6, 2.2] as const,
  boxMm: [-9, 0, 9, 34] as const,
  pullMm: 4,
} as const;

export interface LineFrame {
  xMm: number;
  bottomMm: number;
  topMm: number;
  opacity: number;
}
export function heatLineAt(i: number, ageMs: number, reduced: boolean): LineFrame {
  const xMm = HEAT.xMm[i] ?? 0;
  const start = clamp01(ageMs / (reduced ? REDUCED_MS : HEAT.startMs));
  if (reduced) {
    const bottomMm = HEAT.reducedBaseMm + (i === 1 ? HEAT.reducedMiddleMm : 0);
    return { xMm, bottomMm, topMm: bottomMm + HEAT.lengthMm, opacity: ageMs < 0 ? 0 : start };
  }
  const p = ageMs / HEAT.loopMs + i / 3;
  const phase = p - Math.floor(p);
  const bottomMm = HEAT.baseMm + HEAT.travelMm * phase;
  const opacity = ageMs < 0 ? 0 : start * clamp01(phase / HEAT.fadeIn) * clamp01((1 - phase) / HEAT.fadeOut);
  return { xMm, bottomMm, topMm: bottomMm + HEAT.lengthMm, opacity };
}

/** Smoke: three flat paper-grey puffs with ink outlines rising 0.06 m and fading over 1.5 s, once; then a wisp. */
export const SMOKE = {
  ms: 1500,
  puffs: 3,
  puffMs: 1000,
  staggerMs: 250,
  baseMm: 6,
  riseMm: 60,
  /** Puff radius at its start and end, mm, and its sideways drift by the end, mm. */
  radiusMm: [4, 9] as const,
  driftMm: [-4, 3, -1.5] as const,
  /** A puff fades in over this share of its life, and out over the second half. */
  fadeIn: 0.12,
  fadeFrom: 0.5,
  /** The static wisp: fades in at the end of the puffs (ms) and stays; a curl from 3 to 12 mm and a puff above. */
  wispFromMs: 1200,
  wisp: { bottomMm: 3, topMm: 12, ampMm: 1.4, waveMm: 9, puffMm: 3.2, puffAtMm: [1.4, 15] as const },
  strokeDmm: 2,
  strokeMm: [0.5, 1.8] as const,
  boxMm: [-16, -2, 16, 78] as const,
  pullMm: 6,
} as const;

export interface PuffFrame {
  xMm: number;
  yMm: number;
  rMm: number;
  opacity: number;
}
export function puffAt(i: number, ageMs: number, reduced: boolean): PuffFrame {
  const t = (ageMs - i * SMOKE.staggerMs) / SMOKE.puffMs;
  const tc = clamp01(t);
  const opacity =
    reduced || t < 0 || t > 1 ? 0 : clamp01(t / SMOKE.fadeIn) * (t < SMOKE.fadeFrom ? 1 : (1 - t) / (1 - SMOKE.fadeFrom));
  return {
    xMm: (SMOKE.driftMm[i] ?? 0) * tc,
    yMm: SMOKE.baseMm + SMOKE.riseMm * tc,
    rMm: lerp(SMOKE.radiusMm[0], SMOKE.radiusMm[1], tc),
    opacity,
  };
}
/** The wisp's opacity: after the puffs (static from then on), or at once under reduced motion. */
export const wispAt = (ageMs: number, reduced: boolean): number =>
  ageMs < 0 ? 0 : reduced ? clamp01(ageMs / REDUCED_MS) : clamp01((ageMs - SMOKE.wispFromMs) / (SMOKE.ms - SMOKE.wispFromMs));

/** A stopped heat or smoke mark's fade, `sinceMs` after `stop()`. */
export const stopFade = (sinceMs: number): number => (sinceMs < 0 ? 1 : clamp01(1 - sinceMs / STOP_MS));

/* ---------- shaders ---------- */

/** Every mark's vertex head: the time, the iynk curve as a table, the instance's centre and size, billboards. */
const VERTEX_HEAD = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uTime;
uniform float uEase[${EASE_STEPS + 1}];
varying vec2 vP; // where this fragment is on the mark, mm
float easeIynk(float k) {
  float x = clamp(k, 0.0, 1.0) * ${glsl(EASE_STEPS)};
  float i = min(floor(x), ${glsl(EASE_STEPS - 1)});
  int j = int(i);
  return mix(uEase[j], uEase[j + 1], x - i);
}
// The instance's centre (world) and its size: metres per mm of the mark. Size 0 hides it.
vec3 fxCentre() { return (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; }
float fxUnit() { return length((modelMatrix * instanceMatrix)[0].xyz); }
void fxHide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
// The quad (position.xy in -0.5..0.5) spread over the mark's box (min x, min y, max x, max y), mm.
vec2 fxLocal(vec4 box) { return mix(box.xy, box.zw, position.xy + 0.5); }
// Camera facing, per eye (viewMatrix is the eye's own in WebXR, multiview included): offset in the eye's right and up,
// pulled toward the eye by pull metres along its ray, scaled so it keeps its size on screen.
vec4 fxFacing(vec3 c, vec2 off, float pull) {
  vec4 mv = viewMatrix * vec4(c, 1.0);
  float d = length(mv.xyz);
  float f = d > 1e-5 ? max(0.1, 1.0 - pull / d) : 1.0;
  mv.xyz *= f;
  mv.xy += off * f;
  return mv;
}
// Upright: y along the world's up, x level and across the eye's ray (heat and smoke rise in the room, not on screen).
vec4 fxUpright(vec3 c, vec2 off, float pull) {
  vec4 mv = viewMatrix * vec4(c, 1.0);
  vec3 up = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
  float d = length(mv.xyz);
  vec3 side = cross(up, d > 1e-5 ? -mv.xyz / d : vec3(0.0, 0.0, 1.0));
  float l = length(side);
  side = l > 1e-4 ? side / l : vec3(1.0, 0.0, 0.0);
  float f = d > 1e-5 ? max(0.1, 1.0 - pull / d) : 1.0;
  mv.xyz *= f;
  mv.xyz += (side * off.x + up * off.y) * f;
  return mv;
}
// An ink line's width on the mark, mm, from its angular weight (dmm) at this eye's distance, within lo..hi.
float fxStroke(vec3 c, float dmm, float lo, float hi, float unit) {
  float d = length((viewMatrix * vec4(c, 1.0)).xyz);
  return clamp(dmm * d * 0.001 / max(unit, 1e-9), lo, hi);
}
`;

const FRAGMENT_HEAD = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uInk;
varying vec2 vP;
// Hard edges, antialiased over about a pixel (px: one pixel in mm on the mark). Flat ink, never a soft gradient.
float fxBand(float d, float w, float px) { return 1.0 - smoothstep(w * 0.5 - px * 0.6, w * 0.5 + px * 0.6, abs(d)); }
float fxFill(float sd, float px) { return 1.0 - smoothstep(-px * 0.6, px * 0.6, sd); }
`;

const FRAGMENT_TAIL = /* glsl */ `
  #include <colorspace_fragment>
`;

/**
 * A mark's material. Normal blending (not additive): additive light vanishes on iynk's near-white paper, while flat
 * translucent ink and colour read both on paper and over a dark passthrough room. Transparent, no depth writes, not tone
 * mapped, both sides (a ring lying on a surface may be seen from under it).
 */
export function inkMaterial(o: { vertex: string; fragment: string; uniforms?: Record<string, IUniform> }): ShaderMaterial {
  const m = new ShaderMaterial({
    uniforms: o.uniforms ?? {},
    vertexShader: VERTEX_HEAD + o.vertex,
    fragmentShader: FRAGMENT_HEAD + o.fragment.replace('#include <colorspace_fragment>', FRAGMENT_TAIL),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: NormalBlending,
    side: DoubleSide,
  });
  m.toneMapped = false;
  return m;
}

/**
 * One instanced quad per mark, `cap` of them, every instance hidden. Never raycast (a mark must not catch a pointer
 * meant for the part under it), never frustum culled (its quads are placed in the shader), placed at the scene root.
 */
export function inkInstances(name: string, cap: number, material: ShaderMaterial, attrs: Record<string, number>): InstancedMesh {
  const geo = new PlaneGeometry(1, 1);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  for (const [key, size] of Object.entries(attrs)) geo.setAttribute(key, new InstancedBufferAttribute(new Float32Array(cap * size), size));
  const mesh = new InstancedMesh(geo, material, cap);
  mesh.name = name;
  mesh.instanceMatrix.array.fill(0);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.raycast = () => {};
  mesh.visible = false;
  return mesh;
}

/** The shared time and ease uniforms, and the ink colour. */
function baseUniforms(time: IUniform<number>, ease: Float32Array): Record<string, IUniform> {
  return { uTime: time, uEase: { value: ease }, uInk: { value: new Color(INK) } };
}

const RING_VERTEX = /* glsl */ `
attribute vec4 aFx;     // start (s), life (s), reduced (0 or 1), seed
attribute vec3 aNormal; // the surface's normal, or 0 to face the eye
varying float vR;
varying float vW;
varying float vO;
varying vec3 vColour;
void main() {
  float unit = fxUnit();
  float k = (uTime - aFx.x) / max(aFx.y, 1e-4);
  if (unit <= 0.0 || k < 0.0 || k > 1.0) { fxHide(); return; }
  vR = aFx.z > 0.5 ? ${glsl(RING.reducedMm / 2)} : mix(${glsl(RING.fromMm / 2)}, ${glsl(RING.toMm / 2)}, easeIynk(k));
  vO = 1.0 - k;
  vColour = instanceColor;
  vec3 c = fxCentre();
  vW = fxStroke(c, ${glsl(RING.strokeDmm)}, ${glsl(RING.strokeMm[0])}, ${glsl(RING.strokeMm[1])}, unit);
  vP = position.xy * ${glsl(RING.boxMm * 2)};
  vec4 mv;
  if (dot(aNormal, aNormal) > 0.25) {
    vec3 n = normalize(aNormal);
    vec3 t = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 b = cross(n, t);
    mv = viewMatrix * vec4(c + (t * vP.x + b * vP.y + n * ${glsl(RING.liftMm)}) * unit, 1.0);
  } else {
    mv = fxFacing(c, vP * unit, ${glsl(RING.pullMm)} * unit);
  }
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const RING_FRAGMENT = /* glsl */ `
varying float vR;
varying float vW;
varying float vO;
varying vec3 vColour;
void main() {
  #include <logdepthbuf_fragment>
  float px = length(fwidth(vP));
  float a = fxBand(length(vP) - vR, vW, px) * vO;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColour, a);
  #include <colorspace_fragment>
}
`;

const SPARK_VERTEX = /* glsl */ `
attribute vec4 aFx; // start (s), life (s), reduced (0 or 1), seed
varying vec4 vStar; // inner, outer, core radius (mm), opacity
varying vec3 vSpin; // strokes, rotation, seed
varying float vW;
void main() {
  float unit = fxUnit();
  float k = (uTime - aFx.x) / max(aFx.y, 1e-4);
  if (unit <= 0.0 || k < 0.0 || k > 1.0) { fxHide(); return; }
  if (aFx.z > 0.5) {
    vStar = vec4(${glsl(SPARK.reduced.innerMm)}, ${glsl(SPARK.reduced.outerMm)}, ${glsl(SPARK.reduced.coreMm)}, 1.0 - k);
  } else {
    float e = easeIynk(k);
    vStar = vec4(
      mix(${glsl(SPARK.innerMm[0])}, ${glsl(SPARK.innerMm[1])}, e),
      mix(${glsl(SPARK.outerMm[0])}, ${glsl(SPARK.outerMm[1])}, e),
      ${glsl(SPARK.coreMm)} * (1.0 - e),
      k < ${glsl(SPARK.holdK)} ? 1.0 : 1.0 - (k - ${glsl(SPARK.holdK)}) / ${glsl(1 - SPARK.holdK)});
  }
  float spread = ${glsl(SPARK.maxStrokes - SPARK.minStrokes + 1)};
  vSpin = vec3(${glsl(SPARK.minStrokes)} + min(spread - 1.0, floor(aFx.w * spread)), aFx.w * 43.98, aFx.w);
  vec3 c = fxCentre();
  vW = fxStroke(c, ${glsl(SPARK.strokeDmm)}, ${glsl(SPARK.strokeMm[0])}, ${glsl(SPARK.strokeMm[1])}, unit);
  vP = position.xy * ${glsl(SPARK.boxMm * 2)};
  gl_Position = projectionMatrix * fxFacing(c, vP * unit, ${glsl(SPARK.pullMm)} * unit);
  #include <logdepthbuf_vertex>
}
`;

const SPARK_FRAGMENT = /* glsl */ `
uniform vec3 uCore;
varying vec4 vStar;
varying vec3 vSpin;
varying float vW;
float hash1(float x) { return fract(sin(x * 91.3458 + vSpin.z * 47.123) * 43758.5453); }
void main() {
  #include <logdepthbuf_fragment>
  float px = length(fwidth(vP));
  float n = vSpin.x;
  float sector = 6.28318530718 / n;
  float i = floor((atan(vP.y, vP.x) - vSpin.y) / sector + 0.5);
  float th = i * sector + vSpin.y;
  vec2 q = vec2(cos(th) * vP.x + sin(th) * vP.y, -sin(th) * vP.x + cos(th) * vP.y);
  float j = 0.82 + 0.36 * hash1(mod(i, n));
  float x0 = vStar.x * (0.5 + 0.5 * j);
  float x1 = vStar.y * j;
  float dx = max(max(x0 - q.x, q.x - x1), 0.0);
  float stroke = fxBand(length(vec2(dx, q.y)), vW, px);
  float dc = length(vP) - vStar.z;
  float core = vStar.z > 0.05 ? fxFill(dc - vW * 0.4, px) : 0.0;
  float rim = vStar.z > 0.05 ? fxBand(dc, vW * 0.8, px) : 0.0;
  stroke *= 1.0 - core;
  float ink = max(stroke, rim);
  float a = max(ink, core) * vStar.w;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uInk, uCore, core * (1.0 - ink)), a);
  #include <colorspace_fragment>
}
`;

const HEAT_VERTEX = /* glsl */ `
attribute vec4 aFx; // start (s), stopped at (s, below 0 while running), reduced (0 or 1), seed
varying vec3 vB;    // each line's bottom, mm
varying vec3 vA;    // each line's opacity
varying float vW;
void main() {
  float unit = fxUnit();
  if (unit <= 0.0) { fxHide(); return; }
  float age = (uTime - aFx.x) * 1000.0;
  float fade = aFx.y < 0.0 ? 1.0 : clamp(1.0 - (uTime - aFx.y) * 1000.0 / ${glsl(STOP_MS)}, 0.0, 1.0);
  if (aFx.z > 0.5) {
    float s = clamp(age / ${glsl(REDUCED_MS)}, 0.0, 1.0) * fade;
    vB = vec3(${glsl(HEAT.reducedBaseMm)}, ${glsl(HEAT.reducedBaseMm + HEAT.reducedMiddleMm)}, ${glsl(HEAT.reducedBaseMm)});
    vA = vec3(s);
  } else {
    float s = clamp(age / ${glsl(HEAT.startMs)}, 0.0, 1.0) * fade;
    vec3 p = fract(age / ${glsl(HEAT.loopMs)} + vec3(0.0, 1.0 / 3.0, 2.0 / 3.0));
    vB = ${glsl(HEAT.baseMm)} + ${glsl(HEAT.travelMm)} * p;
    vA = s * clamp(p / ${glsl(HEAT.fadeIn)}, 0.0, 1.0) * clamp((1.0 - p) / ${glsl(HEAT.fadeOut)}, 0.0, 1.0);
  }
  if (age < 0.0 || max(vA.x, max(vA.y, vA.z)) <= 0.0 && aFx.y >= 0.0) { fxHide(); return; }
  vec3 c = fxCentre();
  vW = fxStroke(c, ${glsl(HEAT.strokeDmm)}, ${glsl(HEAT.strokeMm[0])}, ${glsl(HEAT.strokeMm[1])}, unit);
  vP = fxLocal(vec4(${HEAT.boxMm.map(glsl).join(', ')}));
  gl_Position = projectionMatrix * fxUpright(c, vP * unit, ${glsl(HEAT.pullMm)} * unit);
  #include <logdepthbuf_vertex>
}
`;

/** A wavy ink line from y = b to y = t around x = x0, with round ends. Shared by heat and the smoke's wisp. */
const WAVE_LINE = /* glsl */ `
float fxWave(vec2 p, float x0, float b, float t, float amp, float wave, float ph, float w, float px) {
  float k = 6.28318530718 / wave;
  float y = clamp(p.y, b, t);
  float xw = x0 + amp * sin((y - b) * k + ph);
  float slope = amp * k * cos((y - b) * k + ph);
  float d = (p.y < b || p.y > t) ? length(p - vec2(xw, y)) : abs(p.x - xw) / sqrt(1.0 + slope * slope);
  return fxBand(d, w, px);
}
`;

const HEAT_FRAGMENT = /* glsl */ `
varying vec3 vB;
varying vec3 vA;
varying float vW;
${WAVE_LINE}
void main() {
  #include <logdepthbuf_fragment>
  float px = length(fwidth(vP));
  float a = fxWave(vP, ${glsl(HEAT.xMm[0])}, vB.x, vB.x + ${glsl(HEAT.lengthMm)}, ${glsl(HEAT.ampMm)}, ${glsl(HEAT.waveMm)}, ${glsl(HEAT.phase[0])}, vW, px) * vA.x;
  a = max(a, fxWave(vP, ${glsl(HEAT.xMm[1])}, vB.y, vB.y + ${glsl(HEAT.lengthMm)}, ${glsl(HEAT.ampMm)}, ${glsl(HEAT.waveMm)}, ${glsl(HEAT.phase[1])}, vW, px) * vA.y);
  a = max(a, fxWave(vP, ${glsl(HEAT.xMm[2])}, vB.z, vB.z + ${glsl(HEAT.lengthMm)}, ${glsl(HEAT.ampMm)}, ${glsl(HEAT.waveMm)}, ${glsl(HEAT.phase[2])}, vW, px) * vA.z);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uInk, a);
  #include <colorspace_fragment>
}
`;

const SMOKE_VERTEX = /* glsl */ `
attribute vec4 aFx; // start (s), stopped at (s, below 0 while running), reduced (0 or 1), seed
varying vec4 vPuff0; // x, y, r (mm), opacity
varying vec4 vPuff1;
varying vec4 vPuff2;
varying vec2 vWisp;  // opacity, seed
varying float vW;
vec4 puff(float i, float age, float drift, float reduced) {
  float t = (age - i * ${glsl(SMOKE.staggerMs)}) / ${glsl(SMOKE.puffMs)};
  float tc = clamp(t, 0.0, 1.0);
  float o = reduced > 0.5 || t < 0.0 || t > 1.0 ? 0.0
    : clamp(t / ${glsl(SMOKE.fadeIn)}, 0.0, 1.0) * (t < ${glsl(SMOKE.fadeFrom)} ? 1.0 : (1.0 - t) / ${glsl(1 - SMOKE.fadeFrom)});
  return vec4(drift * tc, ${glsl(SMOKE.baseMm)} + ${glsl(SMOKE.riseMm)} * tc, mix(${glsl(SMOKE.radiusMm[0])}, ${glsl(SMOKE.radiusMm[1])}, tc), o);
}
void main() {
  float unit = fxUnit();
  if (unit <= 0.0) { fxHide(); return; }
  float age = (uTime - aFx.x) * 1000.0;
  float fade = aFx.y < 0.0 ? 1.0 : clamp(1.0 - (uTime - aFx.y) * 1000.0 / ${glsl(STOP_MS)}, 0.0, 1.0);
  vPuff0 = puff(0.0, age, ${glsl(SMOKE.driftMm[0])}, aFx.z);
  vPuff1 = puff(1.0, age, ${glsl(SMOKE.driftMm[1])}, aFx.z);
  vPuff2 = puff(2.0, age, ${glsl(SMOKE.driftMm[2])}, aFx.z);
  vPuff0.w *= fade;
  vPuff1.w *= fade;
  vPuff2.w *= fade;
  float wisp = age < 0.0 ? 0.0 : aFx.z > 0.5 ? clamp(age / ${glsl(REDUCED_MS)}, 0.0, 1.0)
    : clamp((age - ${glsl(SMOKE.wispFromMs)}) / ${glsl(SMOKE.ms - SMOKE.wispFromMs)}, 0.0, 1.0);
  vWisp = vec2(wisp * fade, aFx.w);
  if (age < 0.0 || max(max(vPuff0.w, vPuff1.w), max(vPuff2.w, vWisp.x)) <= 0.0 && (aFx.y >= 0.0 || age > ${glsl(SMOKE.ms)})) {
    fxHide();
    return;
  }
  vec3 c = fxCentre();
  vW = fxStroke(c, ${glsl(SMOKE.strokeDmm)}, ${glsl(SMOKE.strokeMm[0])}, ${glsl(SMOKE.strokeMm[1])}, unit);
  vP = fxLocal(vec4(${SMOKE.boxMm.map(glsl).join(', ')}));
  gl_Position = projectionMatrix * fxUpright(c, vP * unit, ${glsl(SMOKE.pullMm)} * unit);
  #include <logdepthbuf_vertex>
}
`;

const SMOKE_FRAGMENT = /* glsl */ `
uniform vec3 uPuff;
varying vec4 vPuff0;
varying vec4 vPuff1;
varying vec4 vPuff2;
varying vec2 vWisp;
varying float vW;
${WAVE_LINE}
// A flat puff, a little lumpy like a hand-drawn cloud: paper-grey fill inside an ink outline. Returns colour, coverage.
vec4 puff(vec2 p, vec4 f, float seed, float px) {
  if (f.w <= 0.0) return vec4(0.0);
  vec2 d = p - f.xy;
  float r = f.z * (1.0 + 0.07 * sin(5.0 * atan(d.y, d.x) + seed));
  float sd = length(d) - r;
  float cover = fxFill(sd - vW * 0.5, px);
  float line = fxBand(sd, vW, px);
  return vec4(mix(uPuff, uInk, line), cover * f.w);
}
// Paint b over a (premultiplied).
vec4 over(vec4 a, vec4 b) { return vec4(b.rgb * b.a + a.rgb * (1.0 - b.a), b.a + a.a * (1.0 - b.a)); }
void main() {
  #include <logdepthbuf_fragment>
  float px = length(fwidth(vP));
  float seed = vWisp.y * 6.2831853;
  vec4 acc = vec4(0.0);
  if (vWisp.x > 0.0) {
    float tail = fxWave(vP, 0.0, ${glsl(SMOKE.wisp.bottomMm)}, ${glsl(SMOKE.wisp.topMm)}, ${glsl(SMOKE.wisp.ampMm)}, ${glsl(SMOKE.wisp.waveMm)}, seed, vW, px);
    acc = over(acc, vec4(uInk, tail * vWisp.x));
    acc = over(acc, puff(vP, vec4(${glsl(SMOKE.wisp.puffAtMm[0])}, ${glsl(SMOKE.wisp.puffAtMm[1])}, ${glsl(SMOKE.wisp.puffMm)}, vWisp.x), seed + 1.0, px));
  }
  acc = over(acc, puff(vP, vPuff0, seed, px));
  acc = over(acc, puff(vP, vPuff1, seed + 2.0, px));
  acc = over(acc, puff(vP, vPuff2, seed + 4.0, px));
  if (acc.a < 0.004) discard;
  gl_FragColor = vec4(acc.rgb / acc.a, acc.a);
  #include <colorspace_fragment>
}
`;

/* ---------- the effects ---------- */

export type Point = Readonly<{ x: number; y: number; z: number }>;

/** Caps per kind: pop and snap rings share one pool (same shape; the colour and life are per instance). */
export const FX_CAP = { rings: 24, sparks: 12, heat: 16, smoke: 8 } as const;
export type FxKind = keyof typeof FX_CAP;

export interface EffectHandle {
  /** Fades the mark out (150 ms) and frees its slot. Harmless twice, and after its slot was reused. */
  stop(): void;
}

export interface Effects {
  /** A Group at the scene root holding one instanced mesh per kind. */
  readonly object: Group;
  /** An ink ring at a committed contact; lying on the surface when its `normal` is given, else facing the eye. */
  popRing(at: Point, normal?: Point): void;
  /** The same ring in the accent colour, shorter (a ghost finding a fit). */
  snapRing(at: Point, normal?: Point): void;
  /** A short ink star burst with a mustard core. */
  spark(at: Point): void;
  /** Three wavy ink lines rising above `anchor` in a loop, until stopped. */
  heat(anchor: Object3D): EffectHandle;
  /** Three puffs rising once, then a small static wisp above `anchor`, until stopped. */
  smoke(anchor: Object3D): EffectHandle;
  dispose(): void;
}

export interface EffectsOptions {
  max?: Partial<Record<FxKind, number>>;
  /** Multiplies every size (the spec's world sizes at 1). A number or a live value; read when an effect starts. */
  scale?: ScaleOption;
}

interface Kind {
  mesh: InstancedMesh;
  pool: InstancePool;
  fx: InstancedBufferAttribute;
  anchors: (Object3D | null)[] | null;
}

export function createEffects(world: World, opts: EffectsOptions = {}): Effects {
  const motion = motionOf(world);
  const time: IUniform<number> = { value: 0 };
  const ease = easeTable();
  const cap = (k: FxKind) => Math.max(1, Math.floor(opts.max?.[k] ?? FX_CAP[k]));
  const ink = new Color(INK);
  const accent = new Color(ACCENT);
  const v3 = new Vector3();
  let clock = 0;
  let seedN = 0;
  const seed = () => {
    seedN = (seedN + 0.6180339887) % 1;
    return seedN;
  };

  const object = new Group();
  object.name = 'look:fx';
  object.matrixAutoUpdate = false;

  const make = (name: FxKind, vertex: string, fragment: string, extra: Record<string, IUniform>, attrs: Record<string, number>, anchored: boolean, order: number): Kind => {
    const material = inkMaterial({ vertex, fragment, uniforms: { ...baseUniforms(time, ease), ...extra } });
    const mesh = inkInstances(`look:fx:${name}`, cap(name), material, { aFx: 4, ...attrs });
    mesh.renderOrder = order;
    object.add(mesh);
    return {
      mesh,
      pool: createPool(mesh.count),
      fx: mesh.geometry.getAttribute('aFx') as InstancedBufferAttribute,
      anchors: anchored ? new Array<Object3D | null>(mesh.count).fill(null) : null,
    };
  };

  const rings = make('rings', RING_VERTEX, RING_FRAGMENT, {}, { aNormal: 3 }, false, 3);
  for (let i = 0; i < rings.mesh.count; i++) rings.mesh.setColorAt(i, ink);
  const sparks = make('sparks', SPARK_VERTEX, SPARK_FRAGMENT, { uCore: { value: new Color(BANDS.mustard.l) } }, {}, false, 6);
  const heats = make('heat', HEAT_VERTEX, HEAT_FRAGMENT, {}, {}, true, 4);
  const smokes = make('smoke', SMOKE_VERTEX, SMOKE_FRAGMENT, { uPuff: { value: new Color(BANDS.paper.m) } }, {}, true, 5);
  const kinds = [rings, sparks, heats, smokes];

  const setFx = (k: Kind, slot: number, a: number, b: number, c: number, d: number) => {
    const arr = k.fx.array as Float32Array;
    arr[slot * 4] = a;
    arr[slot * 4 + 1] = b;
    arr[slot * 4 + 2] = c;
    arr[slot * 4 + 3] = d;
    k.fx.needsUpdate = true;
  };
  const place = (k: Kind, slot: number, p: Point, s: number) => {
    if (writeInstance(k.mesh.instanceMatrix.array as Float32Array, slot, p.x, p.y, p.z, s)) k.mesh.instanceMatrix.needsUpdate = true;
    k.mesh.visible = true;
  };

  const ring = (kind: RingKind, at: Point, normal: Point | undefined, c: Color) => {
    const reduced = motion.reducedMotion;
    const life = ringLife(kind, reduced) / 1000;
    const slot = rings.pool.acquire(clock, clock + life);
    setFx(rings, slot, clock, life, reduced ? 1 : 0, seed());
    const n = rings.mesh.geometry.getAttribute('aNormal') as InstancedBufferAttribute;
    const len = normal ? Math.hypot(normal.x, normal.y, normal.z) : 0;
    if (len > 1e-6) n.setXYZ(slot, normal!.x / len, normal!.y / len, normal!.z / len);
    else n.setXYZ(slot, 0, 0, 0);
    n.needsUpdate = true;
    rings.mesh.setColorAt(slot, c);
    rings.mesh.instanceColor!.needsUpdate = true;
    place(rings, slot, at, 0.001 * readScale(opts.scale));
  };

  const anchored = (k: Kind, anchor: Object3D): EffectHandle => {
    const slot = k.pool.acquire(clock);
    const gen = k.pool.generation(slot);
    k.anchors![slot] = anchor;
    setFx(k, slot, clock, -1, motion.reducedMotion ? 1 : 0, seed());
    anchor.getWorldPosition(v3);
    place(k, slot, v3, 0.001 * readScale(opts.scale));
    return {
      stop() {
        if (k.pool.generation(slot) !== gen || !k.pool.isLive(slot, clock)) return;
        const arr = k.fx.array as Float32Array;
        if (arr[slot * 4 + 1]! >= 0) return;
        arr[slot * 4 + 1] = clock;
        k.fx.needsUpdate = true;
        k.pool.setUntil(slot, clock + STOP_MS / 1000);
      },
    };
  };

  const off: Unsubscribe = onLookFrame(world, (dt) => {
    clock += dt;
    time.value = clock;
    for (let i = 0; i < kinds.length; i++) {
      const k = kinds[i]!;
      if (!k.mesh.visible) continue;
      if (k.anchors) {
        const m = k.mesh.instanceMatrix.array as Float32Array;
        let moved = false;
        for (let s = 0; s < k.anchors.length; s++) {
          const a = k.anchors[s];
          if (!a) continue;
          if (!k.pool.isLive(s, clock)) {
            k.anchors[s] = null;
            moved = writeInstance(m, s, 0, 0, 0, 0) || moved;
            continue;
          }
          a.getWorldPosition(v3);
          moved = writeInstance(m, s, v3.x, v3.y, v3.z, m[s * 16]!) || moved;
        }
        if (moved) k.mesh.instanceMatrix.needsUpdate = true;
      }
      if (!k.pool.anyLive(clock)) k.mesh.visible = false;
    }
  });

  world.scene.add(object);
  let disposed = false;
  return {
    object,
    popRing: (at, normal) => ring('pop', at, normal, ink),
    snapRing: (at, normal) => ring('snap', at, normal, accent),
    spark(at) {
      const reduced = motion.reducedMotion;
      const life = sparkLife(reduced) / 1000;
      const slot = sparks.pool.acquire(clock, clock + life);
      setFx(sparks, slot, clock, life, reduced ? 1 : 0, seed());
      place(sparks, slot, at, 0.001 * readScale(opts.scale));
    },
    heat: (anchor) => anchored(heats, anchor),
    smoke: (anchor) => anchored(smokes, anchor),
    dispose() {
      if (disposed) return;
      disposed = true;
      off();
      object.removeFromParent();
      for (const k of kinds) {
        k.mesh.geometry.dispose();
        (k.mesh.material as ShaderMaterial).dispose();
        k.mesh.dispose();
      }
    },
  };
}

const shared = new WeakMap<World, Effects>();

/** The world's one shared effects instance, made on first use and gone again after its `dispose()`. */
export function effectsOf(world: World, opts?: EffectsOptions): Effects {
  let fx = shared.get(world);
  if (fx) return fx;
  const own = createEffects(world, opts);
  fx = {
    ...own,
    dispose() {
      if (shared.get(world) === fx) shared.delete(world);
      own.dispose();
    },
  };
  shared.set(world, fx);
  return fx;
}
