/* The ink look for iynk's XR assets (docs/XR_ASSETS.md section 6): three flat tone bands per face, ink face edges, an
   inverted-hull silhouette and a flat projected cast shadow, in plain three.js (imports only 'three').

   The band maths (step3, the 0.18 soft step, the sun and fixed-light thresholds, matOf, the line weights and the
   shadow length) are ported from Colorfigures core.js (figures/vendor/colorfigures/core.js), whose licence follows:

   MIT License

   Copyright (c) 2026 April Zhu (Colorfigures: colour, hand-drawn style, 3D props, template, examples)
   Copyright (c) 2026 April Zhu (iso-glow, on which Colorfigures is based)
   Copyright (c) 2026 Tolga Cohce (iso-figure, on which iso-glow is based)

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in all
   copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   SOFTWARE.

   ------------------------------------------------------------------------------------------------------------------
   Cost model (WebGL2, standard WebXR layers, no multiview: every draw call below is issued once per eye).

   Draw calls per item, at rest (see-through 0, no part hidden):
     body      one per glTF primitive of every visible mesh node (sidecar stats.drawCalls: triangle primitives of
               ink.sun / ink.fixed / ink.flat, plus one line primitive per node)
     outline   one per mesh node that has ink.sun or ink.fixed triangles (static, static.cover, each channel node):
               the node's sun and fixed primitives are merged into one hull, ink.flat (decals) gets none, static.xray
               gets none
     shadow    one per static mesh node (static, static.cover; xray only while see-through shows it), plus one per
               rotate / spin channel node (servo horns, props) because those move, and one per channel node at least
               a quarter of the item's size (an LED part's dome); a board's LEDs and buttons cast none
     glow      one per lit emissive channel node (createGlow: a 4-vertex quad), none while it is off
   So an item costs about  stats.drawCalls + meshNodesWithSolids + 1..2 + movingChannels + litLeds.  For example a
   board with 3 static triangle primitives + 1 static line primitive and 5 channel nodes of 1 triangle + 1 line
   primitive each: body 4 + 10 = 14, outline 1 + 5 = 6, shadow 1 (+ 1 per servo) = 21 draw calls, 42 with two eyes,
   + 1 per LED while it is lit.
   A line primitive drawn as fat lines (createFatLines, loadXrAsset's default) is still one draw: one instanced quad
   per segment, 4 vertices each. The xray layer costs nothing until see-through shows it.
   Fragment cost: bands are computed per vertex (faces are flat and do not share vertices, so the per-vertex result
   is exactly the per-face result); the fragment shader only picks the front or back colour. No loops, no textures;
   only the shadow discards (geometry on or under its plane), the hull and the bodies never do.
   Every shader also follows three's logarithmic depth buffer when the renderer uses one.
   ------------------------------------------------------------------------------------------------------------------ */

import * as THREE from 'three';

/* ---------- the figure's constants (core.js) ---------- */
export const INK = '#231e16';
export const PAPER = '#f2efe7';
export const SHADOW = '#41538f';
export const ACCENT = '#f4b829';           // the figure's accent (a part that is "on" or picked)
export const SOFT = 0.18;                  // core.js SOFT: half-width of the blend at each band step
export const SHADOW_LEN = 0.45;            // core.js SHADOW_LEN: cast shadow length as a share of height
/** Band thresholds per shading class: tone() against the sun, toneI() against the fixed light. */
export const SHADES = Object.freeze({
  sun: Object.freeze({ hi: -0.15, lo: -0.45 }),
  fixed: Object.freeze({ hi: 0.6, lo: 0.05 }),
});
/** core.js LIN = norm([.6, .2, 1]) in the figure's own frame (x towards viewer-right, y towards viewer-left, z up). */
export const LIN_FIGURE = (() => { const v = [0.6, 0.2, 1], l = Math.hypot(...v); return v.map((x) => x / l); })();
/** Silhouette weight: core.js hullInk gives min(w, .9 + 20 * thickness), w up to ~2.8 for big bodies. */
export const HULL_MIN = 0.9, HULL_MAX = 2.8, HULL_K = 20;
/** Face edges are drawn at about 0.9 in the figures. */
export const FACE_LINE = 0.9;

/* ---------- pure maths, tested in test/material.test.mjs ---------- */
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** GLSL smoothstep, which is exactly core.js step3's ss(). */
export const smoothstep = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };

/**
 * The weights [light, mid, dark] that core.js step3 gives a face whose normal makes dot `d` with the light.
 * step3 returns   a >= 1 ? l : b <= 0 ? d : a > 0 ? mix(m, l, a) : b < 1 ? mix(d, m, b) : m
 * with a = ss(hi - SOFT, hi + SOFT, d) and b = ss(lo - SOFT, lo + SOFT, d). The branch order matters where the two
 * soft zones overlap (the sun's thresholds are only 0.30 apart, less than 2 x 0.18): there a > 0 wins.
 * The vertex shader computes the same weights without branches (inkBand in INK_COMMON).
 */
export function bandOf(d, hi, lo, soft = SOFT) {
  const a = smoothstep(hi - soft, hi + soft, d), b = smoothstep(lo - soft, lo + soft, d);
  if (a > 0) return [a, 1 - a, 0];
  return [0, b, 1 - b];
}
/** The thresholds for a shading class ('sun' | 'fixed'); 'flat' and 'line' have none. */
export const thresholdsOf = (shade) => SHADES[shade] || null;

/** core.js mix(a, b, t): per-channel blend of two '#rrggbb' colours in sRGB, rounded. */
export function mixHex(a, b, t) {
  return '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.substr(i, 2), 16) * (1 - t) + parseInt(b.substr(i, 2), 16) * t)
    .toString(16).padStart(2, '0')).join('');
}
/** core.js matOf(hex): mid 16 % and dark 42 % of the way to black. */
export const matOf = (hex) => ({ l: hex, m: mixHex(hex, '#000000', 0.16), d: mixHex(hex, '#000000', 0.42) });
/** The colour step3 gives a material { l, m, d } at dot d, through bandOf (the same result as core.js step3). */
export function bandColor(d, hi, lo, mat) {
  const [wl, wm, wd] = bandOf(d, hi, lo);
  if (wl >= 1) return mat.l;
  if (wd >= 1) return mat.d;
  if (wl > 0) return mixHex(mat.m, mat.l, wl);
  if (wd > 0) return mixHex(mat.d, mat.m, wm);
  return mat.m;
}
/** Blend three sRGB colours [r,g,b] 0..1 by weights, in sRGB as the figure does, unrounded (what the shader does). */
export const blendBands = (w, l, m, d) => [0, 1, 2].map((i) => w[0] * l[i] + w[1] * m[i] + w[2] * d[i]);

export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
/** '#rrggbb' -> [r, g, b] 0..1 sRGB. */
export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(String(hex).substr(i, 2), 16) / 255);
/** '#rrggbb' -> THREE.Color in linear (three's working colour space). */
export const linearColor = (hex) => new THREE.Color().setRGB(...hexToRgb(hex).map(srgbToLinear), THREE.LinearSRGBColorSpace);

/**
 * Silhouette weight for a part, from core.js hullInk: min(wMax, .9 + 20 * thickness), where thickness is twice the
 * area over the perimeter of the part's outline on screen, as a share of the frame width. `hull` is the outline as 2D
 * points (any units), `frameWidth` the frame's width in the same units.
 */
export function hullWeight(hull, frameWidth, wMax = HULL_MAX) {
  let a = 0, per = 0;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length];
    a += p[0] * q[1] - q[0] * p[1];
    per += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  const thick = per && frameWidth ? Math.abs(a) / per / frameWidth : 0;
  return Math.min(wMax, HULL_MIN + HULL_K * thick);
}
/** 2D convex hull (monotone chain, as core.js hull). */
export function hull2d(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
/** An orthonormal screen basis [right, up] for a camera looking along -view with +Y up (the viewer's default view). */
export function viewBasis(view) {
  const v = new THREE.Vector3(...view).normalize();
  const up0 = Math.abs(v.y) > 0.99 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up0, v).normalize();
  const up = new THREE.Vector3().crossVectors(v, right).normalize();
  return [right, up];
}
/** The cast-shadow offset in the root frame's xz per metre of height: away from the sun, shadowLength long. */
export function shadowOffset(sun, shadowLength = SHADOW_LEN) {
  const h = Math.hypot(sun[0], sun[2]);
  return h < 1e-6 ? [0, 0] : [-sun[0] / h * shadowLength, -sun[2] / h * shadowLength];
}
/** Where a root-frame point lands on the plane y = planeY in the figure's shadow (heights below the plane stay). */
export function projectShadow(p, sun, shadowLength = SHADOW_LEN, planeY = 0) {
  const [ox, oz] = shadowOffset(sun, shadowLength), h = Math.max(0, p[1] - planeY);
  return [p[0] + ox * h, planeY, p[2] + oz * h];
}

/* ---------- shared uniforms ---------- */
const DEFAULT_SUN = [-0.324, 0.762, -0.561];      // only used when an item has no look (fixtures)
const DEFAULT_FIXED = [0.507, 0.845, 0.169];
const v3 = (a, d) => new THREE.Vector3(...(Array.isArray(a) && a.length === 3 ? a : d)).normalize();

/**
 * Uniforms shared by every material of one item: explode, hidden parts, highlight, the lights in world space, the
 * viewport and the ink scale. Pass the same object to every create*() of an item; loadXrAsset does.
 * `uSun` / `uFixed` are WORLD directions: look.sun turned by the item root's world rotation (updateInkLights).
 */
export function createInkUniforms(look = {}) {
  return {
    uExplode: { value: 0 },
    uHidden: { value: new Uint32Array(16) },               // 512 part bits
    uHighlight: { value: -1 },                             // a _PART index, -1 for none
    uHiColor: { value: linearColor(ACCENT) },
    uHiAmount: { value: 0.5 },
    uSun: { value: v3(look.sun, DEFAULT_SUN) },
    uFixed: { value: v3(look.fixedLight, DEFAULT_FIXED) },
    uResolution: { value: new THREE.Vector2(1280, 800) },  // the viewport being drawn, physical px
    uInkPx: { value: 1.4 },                                // px per figure ink unit (see updateInkViewport)
    uInkColor: { value: linearColor(look.ink || INK) },
    uShadowColor: { value: linearColor(look.shadow || SHADOW) },
  };
}
const _q = new THREE.Quaternion();
/** Turns look.sun / look.fixedLight by the root's world rotation into the shared uniforms (lights stay with the item). */
export function updateInkLights(uniforms, look, root) {
  root.matrixWorld.decompose(_v0, _q, _v1);
  uniforms.uSun.value.copy(v3(look && look.sun, DEFAULT_SUN)).applyQuaternion(_q);
  uniforms.uFixed.value.copy(v3(look && look.fixedLight, DEFAULT_FIXED)).applyQuaternion(_q);
}
const _vp = new THREE.Vector4(), _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3();
/**
 * Reads the viewport being drawn (each eye in XR) into uResolution and picks the ink scale: in the figures one ink
 * unit is about 1.3 px on a 760 px wide frame, so on a desktop canvas it grows with the canvas; in a headset it is
 * held near 1 px per unit so a 2.8 silhouette stays about 2 px wide at any distance. `scale` multiplies it.
 */
export function updateInkViewport(uniforms, renderer, scale = 1) {
  renderer.getCurrentViewport(_vp);
  const w = Math.max(1, _vp.z), h = Math.max(1, _vp.w);
  uniforms.uResolution.value.set(w, h);
  const xr = renderer.xr && renderer.xr.isPresenting;
  uniforms.uInkPx.value = (xr ? 1.0 : Math.min(2.2, Math.max(0.8, Math.min(w, h) / 560))) * scale;
}

/* ---------- GLSL ---------- */
const INK_COMMON = /* glsl */`
uniform float uExplode;
uniform uint uHidden[16];
uniform float uHighlight;
#ifdef HAS_EXPLODE
attribute vec3 _explode;
#endif
#ifdef HAS_PART
attribute float _part;
#endif
float inkPart() {
#ifdef HAS_PART
  return _part;
#else
  return -1.0;
#endif
}
bool inkHidden(float part) {
  if (part < -0.5 || part > 511.5) return false;
  uint p = uint(part + 0.5);
  return ((uHidden[p >> 5u] >> (p & 31u)) & 1u) != 0u;
}
vec3 inkPosition() {
#ifdef HAS_EXPLODE
  return position + uExplode * _explode;
#else
  return position;
#endif
}
bool inkPersp() { return projectionMatrix[2][3] != 0.0; }
// unit vector from a view-space point towards the eye (perspective) or the view axis (orthographic)
vec3 inkToEye(vec3 mv) { return inkPersp() ? normalize(-mv) : vec3(0.0, 0.0, 1.0); }
// a vertex of a hidden part goes outside the clip volume; every vertex of a face has the same part, so the face
// degenerates and is never rasterised
const vec4 INK_GONE = vec4(2.0, 2.0, 2.0, 1.0);
`;

const BAND_VERT = /* glsl */`
${INK_COMMON}
uniform vec3 uLight;            // world direction towards this class's light
uniform float uHi, uLo, uSoft;
uniform vec3 uEmissive;         // linear
uniform float uEmissiveLevel;
uniform vec3 uHiColor;
uniform float uHiAmount;
uniform float uDepthPull;       // metres towards the eye (the xray layer is drawn over the bodies it sits in)
#ifdef HAS_BANDS
attribute vec3 _ink_mid;
attribute vec3 _ink_dark;
#endif
varying vec3 vFront;
varying vec3 vBack;
varying float vFacing;
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((max(c, vec3(0.0)) + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
// core.js step3, branch-free: a > 0 -> mix(m, l, a); else mix(d, m, b). Mixed in sRGB as the figure mixes hex colours.
vec3 inkBand(float d, vec3 l, vec3 m, vec3 k) {
  float a = smoothstep(uHi - uSoft, uHi + uSoft, d);
  float b = smoothstep(uLo - uSoft, uLo + uSoft, d);
  float useA = a > 0.0 ? 1.0 : 0.0;
  return a * l + mix(b, 1.0 - a, useA) * m + (1.0 - b) * (1.0 - useA) * k;
}
void main() {
  float part = inkPart();
  vec4 mv = modelViewMatrix * vec4(inkPosition(), 1.0);
  vec3 toEye = inkToEye(mv.xyz);
  // which side of the face the eye is on; interpolated it is exact per fragment (linear in the position)
  vFacing = dot(normalMatrix * normal, inkPersp() ? -mv.xyz : vec3(0.0, 0.0, 1.0));
#ifdef SHADE_FLAT
  vec3 front = color.rgb;              // .rgb: three declares color as vec4 when COLOR_0 has alpha
  vec3 back = color.rgb;
#else
  vec3 l = toSrgb(color.rgb);
#ifdef HAS_BANDS
  vec3 m = toSrgb(_ink_mid), k = toSrgb(_ink_dark);
#else
  vec3 m = l * 0.84, k = l * 0.58;          // matOf: 16 % and 42 % of the way to black
#endif
  float d = dot(normalize(mat3(modelMatrix) * normal), uLight);
  vec3 front = toLin(inkBand(d, l, m, k));
  vec3 back = toLin(inkBand(-d, l, m, k)); // seen from behind, the visible side's normal is -normal
#endif
  // lit: the lens takes its bands from the channel colour lifted a little towards white (led.js lifts 25 % + 30 % x
  // lit; less here, the halo drawn over it does the rest), so it brightens and keeps its shading
  if (uEmissiveLevel > 0.0) {
    vec3 el = mix(toSrgb(uEmissive), vec3(1.0), 0.12 + 0.18 * uEmissiveLevel);
#ifdef SHADE_FLAT
    vec3 lf = toLin(el), lb = lf;
#else
    vec3 lf = toLin(inkBand(d, el, el * 0.84, el * 0.58)), lb = toLin(inkBand(-d, el, el * 0.84, el * 0.58));
#endif
    front = mix(front, lf, uEmissiveLevel);
    back = mix(back, lb, uEmissiveLevel);
  }
  float hi = (uHighlight >= 0.0 && abs(part - uHighlight) < 0.5) ? uHiAmount : 0.0;
  vFront = mix(front, uHiColor, hi);
  vBack = mix(back, uHiColor, hi);
  mv.xyz += toEye * uDepthPull;
#if defined(SHADE_FLAT) && defined(USE_LOGARITHMIC_DEPTH_BUFFER)
  mv.xyz += toEye * (0.0008 * max(-mv.z, 0.0));   // a written fragment depth ignores the polygon offset
#endif
  gl_Position = projectionMatrix * mv;
  if (inkHidden(part)) gl_Position = INK_GONE;
}`;

const BAND_FRAG = /* glsl */`
uniform float uOpacity;
varying vec3 vFront;
varying vec3 vBack;
varying float vFacing;
void main() {
  gl_FragColor = vec4(vFacing >= 0.0 ? vFront : vBack, uOpacity);
  #include <colorspace_fragment>
}`;

const LINE_VERT = /* glsl */`
${INK_COMMON}
uniform float uLinePush;       // share of the eye distance the line is pulled towards the eye (beats its faces)
uniform float uDepthPull;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(inkPosition(), 1.0);
  vec3 toEye = inkToEye(mv.xyz);
  mv.xyz += toEye * (uLinePush * max(-mv.z, 0.0) + uDepthPull);
  vColor = color.rgb;
  gl_Position = projectionMatrix * mv;
  if (inkHidden(inkPart())) gl_Position = INK_GONE;
}`;

const COLOR_FRAG = /* glsl */`
uniform float uOpacity;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, uOpacity);
  #include <colorspace_fragment>
}`;

const FAT_LINE_VERT = /* glsl */`
uniform float uExplode;
uniform uint uHidden[16];
uniform vec2 uResolution;
uniform float uInkPx;
uniform float uLineScale;
uniform float uMinPx;
uniform float uLinePush;
uniform float uDepthPull;
attribute vec3 iStart;
attribute vec3 iEnd;
attribute vec3 iColor;
attribute float iWidth;
#ifdef HAS_PART
attribute float iPart;
#endif
#ifdef HAS_EXPLODE
attribute vec3 iExpA;
attribute vec3 iExpB;
#endif
varying vec3 vColor;
bool hiddenPart(float part) {
  if (part < -0.5 || part > 511.5) return false;
  uint p = uint(part + 0.5);
  return ((uHidden[p >> 5u] >> (p & 31u)) & 1u) != 0u;
}
void main() {
  vec3 a = iStart, b = iEnd;
#ifdef HAS_EXPLODE
  a += uExplode * iExpA; b += uExplode * iExpB;
#endif
  vec4 ma = modelViewMatrix * vec4(a, 1.0), mb = modelViewMatrix * vec4(b, 1.0);
  bool persp = projectionMatrix[2][3] != 0.0;
  if (persp) {                                   // trim the segment to the near plane
    float near = projectionMatrix[3][2] / (projectionMatrix[2][2] - 1.0);
    if (ma.z > -near && mb.z <= -near) ma = mix(ma, mb, (-near - ma.z) / (mb.z - ma.z));
    else if (mb.z > -near && ma.z <= -near) mb = mix(mb, ma, (-near - mb.z) / (ma.z - mb.z));
  }
  vec3 ea = persp ? normalize(-ma.xyz) : vec3(0.0, 0.0, 1.0), eb = persp ? normalize(-mb.xyz) : vec3(0.0, 0.0, 1.0);
  ma.xyz += ea * (uLinePush * max(-ma.z, 0.0) + uDepthPull);
  mb.xyz += eb * (uLinePush * max(-mb.z, 0.0) + uDepthPull);
  vec4 ca = projectionMatrix * ma, cb = projectionMatrix * mb;
  vec2 sa = ca.xy / ca.w * uResolution, sb = cb.xy / cb.w * uResolution;
  vec2 dir = sb - sa;
  float len = length(dir);
  dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float wpx = max(uMinPx, iWidth * uInkPx * uLineScale);
  bool atB = position.x > 0.5;
  vec4 c = atB ? cb : ca;
  // half the width to each side, and half a width past each end (square caps close the joints)
  vec2 off = (nrm * position.y + dir * (atB ? 1.0 : -1.0)) * 0.5 * wpx;
  c.xy += off / uResolution * 2.0 * c.w;
  vColor = iColor;
  gl_Position = c;
#ifdef HAS_PART
  if (hiddenPart(iPart)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
#endif
}`;

const OUTLINE_VERT = /* glsl */`
${INK_COMMON}
uniform vec2 uResolution;
uniform float uInkPx;
uniform float uWidth;           // ink units when the geometry has no _outline_w
uniform float uOutScale;        // share of the stroke shown outside the body
uniform float uHullAll;         // 1: push every face's copy out (open shells with no back faces at the rim)
uniform float uPushK;           // push-back along the view ray, in stroke widths
attribute vec4 _outline_normal;
#ifdef HAS_OUTLINE_W
attribute float _outline_w;
#endif
void main() {
  vec4 mv = modelViewMatrix * vec4(inkPosition(), 1.0);
  vec3 toEye = inkToEye(mv.xyz);
#ifdef HAS_OUTLINE_W
  float wpx = _outline_w * uInkPx * uOutScale;
#else
  float wpx = uWidth * uInkPx * uOutScale;
#endif
  // the size of one pixel in view-space metres at this depth
  float px = 2.0 / (projectionMatrix[1][1] * uResolution.y) * (inkPersp() ? max(-mv.z, 1e-4) : 1.0);
  // every hull vertex sits a little behind its body (its own width, so a face up to 45 degrees to the view whose
  // stored normal or winding is wrong still hides behind the face it copies) ...
  mv.xyz -= toEye * (wpx * px * uPushK);
  vec4 clip = projectionMatrix * mv;
  // ... and only the copies of faces turned away from the eye (by the stored outward face normal, not by the
  // winding) are pushed out across the screen. The copies of faces turned towards the eye stay inside the body.
  vec3 n = normalMatrix * normal;
  if (dot(n, toEye) < 0.0 || uHullAll > 0.5) {
    vec4 cn = projectionMatrix * vec4(normalMatrix * _outline_normal.xyz, 0.0);
    vec2 dir = (cn.xy * clip.w - clip.xy * cn.w) * uResolution;   // d(ndc)/dt along the normal, in pixels
    float len = length(dir);
    if (len > 1e-12) clip.xy += dir / len * (2.0 * wpx / uResolution) * clip.w;
  }
  gl_Position = clip;
  if (inkHidden(inkPart())) gl_Position = INK_GONE;
}`;

const SOLID_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  gl_FragColor = vec4(uColor, uOpacity);
  #include <colorspace_fragment>
}`;

const SHADOW_VERT = /* glsl */`
${INK_COMMON}
uniform mat4 uToRoot;           // the source's local frame -> the item root frame (the shadow mesh lives in the root)
uniform vec2 uShadowDir;        // root xz offset per metre of height
uniform float uPlaneY;
varying float vH;
void main() {
  vec4 r = uToRoot * vec4(inkPosition(), 1.0);
  float h = r.y - uPlaneY;
  vH = h;
  float hc = max(h, 0.0);
  vec4 mv = modelViewMatrix * vec4(r.x + uShadowDir.x * hc, uPlaneY, r.z + uShadowDir.y * hc, 1.0);
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  mv.xyz += inkToEye(mv.xyz) * (0.0015 * max(-mv.z, 0.0));   // a written fragment depth ignores the polygon offset
#endif
  gl_Position = projectionMatrix * mv;
  if (inkHidden(inkPart())) gl_Position = INK_GONE;
}`;

const SHADOW_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
uniform float uMinH;
varying float vH;
void main() {
  if (vH < uMinH) discard;      // geometry on or under the plane (a mat's top, a board's underside) casts nothing
  gl_FragColor = vec4(uColor, uOpacity);
  #include <colorspace_fragment>
}`;

const GLOW_VERT = /* glsl */`
uniform vec3 uCenter;           // the parent's frame
uniform float uRadius;          // metres, outer disc at full level
uniform float uPull;            // metres towards the eye
uniform float uMinPx;
uniform float uLevel;
uniform vec2 uResolution;
uniform float uInkPx;
varying vec2 vUv;
void main() {
  bool persp = projectionMatrix[2][3] != 0.0;
  float s = length(modelMatrix[0].xyz);               // the item's scale: radius and pull are in its metres
  vec4 mv = modelViewMatrix * vec4(uCenter, 1.0);
  float dist = persp ? max(length(mv.xyz), 1e-6) : 1.0;
  vec3 toEye = persp ? -mv.xyz / dist : vec3(0.0, 0.0, 1.0);
  float pull = persp ? min(uPull * s, 0.5 * dist) : uPull * s;
  // one pixel in view-space metres at the centre's depth
  float px = 2.0 / (projectionMatrix[1][1] * uResolution.y) * (persp ? max(-mv.z, 1e-4) : 1.0);
  float r = max(uRadius * s * (0.45 + 0.55 * uLevel), uMinPx * uInkPx * px);
  if (persp) r *= (dist - pull) / dist;               // moved towards the eye, it keeps its drawn size
  mv.xyz += toEye * pull;
  mv.xy += position.xy * r;
  vUv = position.xy;
  gl_Position = projectionMatrix * mv;
}`;

const GLOW_FRAG = /* glsl */`
uniform vec3 uColor;            // linear
uniform vec3 uCore;
uniform float uLevel;
uniform float uAdd;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  if (r >= 1.0) discard;
  float halo = 0.34 * uLevel * (1.0 - smoothstep(0.35, 1.0, r));
  float core = 0.8 * uLevel * (1.0 - smoothstep(0.17, 0.3, r));
  float a = halo + core - halo * core;
  if (a < 0.002) discard;
  gl_FragColor = vec4((uColor * halo * (1.0 - core) + uCore * core) / a, 1.0);
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - uAdd));   // premultiplied; uAdd of it is added
}`;

/* logarithmic depth, when the app's renderer uses it: every ink shader writes the same depth three's own do */
export function withLogDepthVertex(src) {
  const i = src.lastIndexOf('}');
  return '#ifdef USE_LOGARITHMIC_DEPTH_BUFFER\nvarying float vFragDepth;\nvarying float vIsPerspective;\n#endif\n' + src.slice(0, i)
    + '#ifdef USE_LOGARITHMIC_DEPTH_BUFFER\n  vFragDepth = 1.0 + gl_Position.w;\n  vIsPerspective = projectionMatrix[2][3] == -1.0 ? 1.0 : 0.0;\n#endif\n' + src.slice(i);
}
export const withLogDepthFragment = (src) => '#include <logdepthbuf_pars_fragment>\n' + src.replace('#include <colorspace_fragment>', '#include <logdepthbuf_fragment>\n  #include <colorspace_fragment>');
const VS = { band: withLogDepthVertex(BAND_VERT), line: withLogDepthVertex(LINE_VERT), fat: withLogDepthVertex(FAT_LINE_VERT), outline: withLogDepthVertex(OUTLINE_VERT), shadow: withLogDepthVertex(SHADOW_VERT), glow: withLogDepthVertex(GLOW_VERT) };
const FS = { band: withLogDepthFragment(BAND_FRAG), color: withLogDepthFragment(COLOR_FRAG), solid: withLogDepthFragment(SOLID_FRAG), shadow: withLogDepthFragment(SHADOW_FRAG), glow: withLogDepthFragment(GLOW_FRAG) };

/* ---------- materials ---------- */
const definesFor = (geometry, extra = {}) => {
  const d = { ...extra };
  if (geometry) {
    const a = geometry.attributes;
    if (a._explode) d.HAS_EXPLODE = '';
    if (a._part) d.HAS_PART = '';
    if (a._ink_mid && a._ink_dark) d.HAS_BANDS = '';
    if (a._outline_w) d.HAS_OUTLINE_W = '';
  }
  return d;
};
/** Shading class from a glTF material (extras.iynkInk.shade, else its name 'ink.<shade>'). */
export function shadeOf(material) {
  const s = material && material.userData && material.userData.iynkInk && material.userData.iynkInk.shade;
  if (s) return s;
  const m = /^ink\.(sun|fixed|flat|line)$/.exec((material && material.name) || '');
  return m ? m[1] : null;
}
/** Sets a material's opacity and the transparent / depthWrite flags that go with it. */
export function setInkOpacity(material, opacity) {
  material.uniforms.uOpacity.value = opacity;
  const t = opacity < 0.999;
  if (material.transparent !== t) { material.transparent = t; material.needsUpdate = true; }
  material.depthWrite = !t || material.userData.inkRole === 'body';
}

/**
 * The band material. shade: 'sun' | 'fixed' | 'flat'. look: the sidecar's look (lights). geometry: the geometry it
 * will draw (its optional attributes switch defines). uniforms: the item's shared uniforms (createInkUniforms).
 * Double-sided; the band uses the side of the face the eye is on, by position, never by winding. 'flat' (decals,
 * silkscreen, printed areas) is pulled forward with a polygon offset so a decal coplanar with its body wins.
 */
export function createInkMaterial({ shade = 'sun', look = {}, geometry = null, uniforms = null, opacity = 1, depthPull = 0, name } = {}) {
  const u = uniforms || createInkUniforms(look);
  const th = SHADES[shade] || SHADES.sun;
  const m = new THREE.ShaderMaterial({
    name: name || 'ink.' + shade,
    uniforms: {
      uExplode: u.uExplode, uHidden: u.uHidden, uHighlight: u.uHighlight, uHiColor: u.uHiColor, uHiAmount: u.uHiAmount,
      uLight: shade === 'fixed' ? u.uFixed : u.uSun,
      uHi: { value: th.hi }, uLo: { value: th.lo }, uSoft: { value: SOFT },
      uEmissive: { value: new THREE.Color(1, 1, 1) }, uEmissiveLevel: { value: 0 },
      uDepthPull: { value: depthPull },
      uOpacity: { value: 1 },
    },
    defines: definesFor(geometry, shade === 'flat' ? { SHADE_FLAT: '' } : {}),
    vertexShader: VS.band,
    fragmentShader: FS.band,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  m.toneMapped = false;
  m.forceSinglePass = true;                     // a fading double-sided body is one draw, not back + front
  m.userData.inkRole = 'body';
  m.userData.shade = shade;
  if (shade === 'flat') { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -4; }
  m.defaultAttributeValues = { ...m.defaultAttributeValues, _explode: [0, 0, 0], _part: [-1], _ink_mid: [1, 1, 1], _ink_dark: [1, 1, 1] };
  setInkOpacity(m, opacity);
  return m;
}
/** Emissive: the bands blend towards `color` ('#rrggbb' or THREE.Color, sRGB) by level 0..1. */
export function setInkEmissive(material, color, level) {
  if (!material.uniforms.uEmissive) return;
  if (typeof color === 'string') material.uniforms.uEmissive.value.copy(linearColor(color));
  else if (color && color.isColor) material.uniforms.uEmissive.value.copy(color);
  material.uniforms.uEmissiveLevel.value = clamp01(level);
}

/** 1-px GL lines in their vertex colour (ink, or a trace's or wire's own colour), pulled a little towards the eye. */
export function createLineMaterial({ geometry = null, uniforms = null, look = {}, opacity = 1, depthPull = 0, push = 0.0012 } = {}) {
  const u = uniforms || createInkUniforms(look);
  const m = new THREE.ShaderMaterial({
    name: 'ink.line',
    uniforms: { uExplode: u.uExplode, uHidden: u.uHidden, uHighlight: u.uHighlight, uLinePush: { value: push }, uDepthPull: { value: depthPull }, uOpacity: { value: 1 } },
    defines: definesFor(geometry),
    vertexShader: VS.line,
    fragmentShader: FS.color,
    vertexColors: true,
  });
  m.toneMapped = false;
  m.userData.inkRole = 'line';
  m.defaultAttributeValues = { ...m.defaultAttributeValues, _explode: [0, 0, 0], _part: [-1], color: [0.0144, 0.0122, 0.0080] };
  setInkOpacity(m, opacity);
  return m;
}

// the instanced quad: x = which end (0 start, 1 end), y = which side. Each fat line owns its copy (a dozen floats),
// so disposing one item's geometry never frees a buffer another item still draws with
const quadPosition = () => new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, 1, 0, 1, -1, 0], 3);
const quadIndex = () => new THREE.Uint16BufferAttribute([0, 2, 1, 0, 3, 2], 1);
/**
 * Fat lines (optional): a line primitive redrawn as screen-space quads, one instance per segment, each as wide as
 * the figure's stroke (_line_width x the ink scale). One draw call, like the GL line it replaces. Returns a Mesh in
 * the same frame as `lines` (add it next to it, or as its child; loadXrAsset replaces the GL line with it).
 */
export function createFatLines(lines, { uniforms = null, look = {}, opacity = 1, depthPull = 0, push = 0.0012, scale = 1, minPx = 1 } = {}) {
  const u = uniforms || createInkUniforms(look);
  const src = lines.isBufferGeometry ? lines : lines.geometry;
  const pos = src.attributes.position, col = src.attributes.color, wid = src.attributes._line_width;
  const part = src.attributes._part, exp = src.attributes._explode;
  const idx = src.index ? src.index.array : null;
  const n = Math.floor((idx ? idx.length : pos.count) / 2);
  const S = new Float32Array(n * 3), E = new Float32Array(n * 3), C = new Float32Array(n * 3), W = new Float32Array(n);
  const P = part ? new Float32Array(n) : null, XA = exp ? new Float32Array(n * 3) : null, XB = exp ? new Float32Array(n * 3) : null;
  const inkLin = hexToRgb(look.ink || INK).map(srgbToLinear);
  for (let i = 0; i < n; i++) {
    const a = idx ? idx[2 * i] : 2 * i, b = idx ? idx[2 * i + 1] : 2 * i + 1;
    S[3 * i] = pos.getX(a); S[3 * i + 1] = pos.getY(a); S[3 * i + 2] = pos.getZ(a);
    E[3 * i] = pos.getX(b); E[3 * i + 1] = pos.getY(b); E[3 * i + 2] = pos.getZ(b);
    if (col) { C[3 * i] = col.getX(a); C[3 * i + 1] = col.getY(a); C[3 * i + 2] = col.getZ(a); } else C.set(inkLin, 3 * i);
    W[i] = wid ? (wid.getX(a) + wid.getX(b)) / 2 : FACE_LINE;
    if (P) P[i] = part.getX(a);
    if (XA) { XA[3 * i] = exp.getX(a); XA[3 * i + 1] = exp.getY(a); XA[3 * i + 2] = exp.getZ(a); XB[3 * i] = exp.getX(b); XB[3 * i + 1] = exp.getY(b); XB[3 * i + 2] = exp.getZ(b); }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(quadIndex());
  g.setAttribute('position', quadPosition());
  g.setAttribute('iStart', new THREE.InstancedBufferAttribute(S, 3));
  g.setAttribute('iEnd', new THREE.InstancedBufferAttribute(E, 3));
  g.setAttribute('iColor', new THREE.InstancedBufferAttribute(C, 3));
  g.setAttribute('iWidth', new THREE.InstancedBufferAttribute(W, 1));
  if (P) g.setAttribute('iPart', new THREE.InstancedBufferAttribute(P, 1));
  if (XA) { g.setAttribute('iExpA', new THREE.InstancedBufferAttribute(XA, 3)); g.setAttribute('iExpB', new THREE.InstancedBufferAttribute(XB, 3)); }
  g.instanceCount = n;
  if (!src.boundingSphere) src.computeBoundingSphere();
  g.boundingSphere = src.boundingSphere.clone();
  g.boundingSphere.radius += 0.02;              // exploded segments travel up to ~20 mm
  const defines = {};
  if (P) defines.HAS_PART = '';
  if (XA) defines.HAS_EXPLODE = '';
  const m = new THREE.ShaderMaterial({
    name: 'ink.line.fat',
    uniforms: {
      uExplode: u.uExplode, uHidden: u.uHidden, uResolution: u.uResolution, uInkPx: u.uInkPx,
      uLineScale: { value: scale }, uMinPx: { value: minPx }, uLinePush: { value: push }, uDepthPull: { value: depthPull }, uOpacity: { value: 1 },
    },
    defines, vertexShader: VS.fat, fragmentShader: FS.color, side: THREE.DoubleSide,
  });
  m.toneMapped = false;
  m.userData.inkRole = 'line';
  setInkOpacity(m, opacity);
  const mesh = new THREE.Mesh(g, m);
  mesh.name = ((lines.name || 'lines') + '.fat');
  mesh.userData.inkRole = 'line';
  mesh.onBeforeRender = (renderer) => updateInkViewport(u, renderer, mesh.userData.inkScale || 1);
  return mesh;
}

/* ---------- geometry helpers ---------- */
/**
 * Merges the triangle geometries of several meshes (with their local matrices applied, so the result is in their
 * common parent's frame) into one, keeping only `names`. A missing attribute is filled with `fill[name]`.
 */
export function mergeInkGeometries(meshes, names, fill = {}) {
  const geos = meshes.map((m) => m.geometry);
  let count = 0, icount = 0;
  for (const g of geos) { count += g.attributes.position.count; icount += g.index ? g.index.count : g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const ref = geos.map((g) => g.attributes[name]).find(Boolean);
    if (!ref && fill[name] === undefined) continue;
    const size = ref ? ref.itemSize : fill[name].length;
    const arr = new Float32Array(count * size);
    let o = 0;
    for (let gi = 0; gi < geos.length; gi++) {
      const a = geos[gi].attributes[name], n = geos[gi].attributes.position.count;
      if (a) for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) arr[(o + i) * size + c] = a.getComponent(i, c);
      else { const f = fill[name] || new Array(size).fill(0); for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) arr[(o + i) * size + c] = f[c] || 0; }
      // bake the mesh's local matrix into positions and directions (_explode is a root-frame offset: kept as is)
      const mesh = meshes[gi];
      if (!mesh.matrix.equals(_I) && (name === 'position' || name === 'normal' || name === '_outline_normal')) {
        const isPoint = name === 'position', nm = new THREE.Matrix3().getNormalMatrix(mesh.matrix), v = new THREE.Vector3();
        for (let i = 0; i < n; i++) {
          const k = (o + i) * size;
          v.set(arr[k], arr[k + 1], arr[k + 2]);
          if (isPoint) v.applyMatrix4(mesh.matrix); else v.applyMatrix3(nm).normalize();
          arr[k] = v.x; arr[k + 1] = v.y; arr[k + 2] = v.z;
        }
      }
      o += n;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const index = count > 65535 ? new Uint32Array(icount) : new Uint16Array(icount);
  let io = 0, vo = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    if (g.index) for (let i = 0; i < g.index.count; i++) index[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < n; i++) index[io++] = i + vo;
    vo += n;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  // exploded vertices travel up to |_explode|: grow the bounds so frustum culling never drops them
  out.computeBoundingSphere();
  const e = out.attributes._explode;
  if (e) { let m = 0; for (let i = 0; i < e.count; i++) m = Math.max(m, Math.hypot(e.getX(i), e.getY(i), e.getZ(i))); out.boundingSphere.radius += m; }
  return out;
}
const _I = new THREE.Matrix4();

/**
 * Inverted-hull silhouette. Returns a Mesh drawing `source` (a Mesh, sharing its geometry; or an array of meshes,
 * merged in their common parent's frame) again in ink, each vertex pushed out along _OUTLINE_NORMAL by a constant
 * screen width, computed in clip space so it is the same number of pixels at any distance and in each eye.
 *
 * Why this way, with double-sided faces of inconsistent winding: culling front faces with side = BackSide would let
 * the rasteriser decide which hull faces are "back" from the triangle winding, which the converter only gets right
 * where it knows the solid; a wrongly wound face would then put an ink blot over the body. Instead the hull is drawn
 * double-sided and the vertex shader decides per vertex from the stored outward face NORMAL: copies of faces turned
 * away from the eye are pushed out (they become the ink rim around the silhouette), copies of faces turned towards
 * the eye stay where they are. Every copy is also pushed back along the view ray by its own on-screen width, so a
 * copy that stays (or a face whose stored normal is wrong) lies just behind the face it copies and loses the depth
 * test against it at up to 45 degrees of slope, whatever the winding. A face's copy is extruded along the smoothed
 * _OUTLINE_NORMAL, so the rim has no cracks at hard edges. Drawn after the bodies (renderOrder 1), so most of its
 * fragments fail the early depth test. The rim width is the part's hullInk weight (_outline_w, ink units, built by
 * loadXrAsset from the part's outline at the default view) or `width`.
 * Options: width (ink units, default 2.8), uniforms (shared), look, attach (default true: add it to the source).
 */
export function createOutline(source, { width = HULL_MAX, uniforms = null, look = {}, attach = true, outScale = 0.75, faces = 'back', pushK = null } = {}) {
  const u = uniforms || createInkUniforms(look);
  const meshes = Array.isArray(source) ? source : [source];
  const merged = meshes.length > 1;
  const geometry = merged
    ? mergeInkGeometries(meshes, ['position', 'normal', '_outline_normal', '_explode', '_part', '_outline_w'], {})
    : meshes[0].geometry;
  if (!geometry.attributes._outline_normal) geometry.setAttribute('_outline_normal', geometry.attributes.normal);
  const m = new THREE.ShaderMaterial({
    name: 'ink.outline',
    uniforms: {
      uExplode: u.uExplode, uHidden: u.uHidden, uHighlight: u.uHighlight, uResolution: u.uResolution, uInkPx: u.uInkPx,
      uWidth: { value: width }, uOutScale: { value: outScale }, uColor: u.uInkColor, uOpacity: { value: 1 },
      uHullAll: { value: faces === 'all' ? 1 : 0 }, uPushK: { value: pushK != null ? pushK : faces === 'all' ? 1.5 : 1 },
    },
    defines: definesFor(geometry),
    vertexShader: VS.outline,
    fragmentShader: FS.solid,
    side: THREE.DoubleSide,
  });
  m.toneMapped = false;
  m.forceSinglePass = true;
  m.userData.inkRole = 'outline';
  m.defaultAttributeValues = { ...m.defaultAttributeValues, _explode: [0, 0, 0], _part: [-1], _outline_w: [width] };
  const mesh = new THREE.Mesh(geometry, m);
  mesh.name = (meshes[0].name || 'mesh') + '.outline';
  mesh.renderOrder = 1;
  mesh.userData.inkRole = 'outline';
  mesh.userData.ownsGeometry = merged;
  mesh.onBeforeRender = (renderer) => updateInkViewport(u, renderer, mesh.userData.inkScale || 1);
  if (attach) (merged ? meshes[0].parent || meshes[0] : meshes[0]).add(mesh);
  return mesh;
}

/**
 * Flat projected cast shadow, as castShadow in core.js: the source drawn again with every point moved along the
 * ground away from the sun by shadowLength x its height and laid on the plane y = planeY of the item's root frame,
 * opaque #41538f, polygon offset towards the eye so it wins over a mat or table at y = planeY. It honours explode
 * and hidden parts through the shared uniforms; geometry on or under the plane casts nothing. The returned Mesh
 * belongs in the root (attach: true adds it there): each frame it reads the source's transform relative to the root,
 * so a spinning prop's shadow spins. Options: look (sun, shadowLength, shadow colour), root, planeY, uniforms.
 */
export function createShadow(source, { look = {}, root = null, planeY = 0, uniforms = null, attach = true } = {}) {
  const u = uniforms || createInkUniforms(look);
  const meshes = Array.isArray(source) ? source : [source];
  const merged = meshes.length > 1;
  const geometry = merged ? mergeInkGeometries(meshes, ['position', '_explode', '_part'], {}) : meshes[0].geometry;
  const frame = merged ? meshes[0].parent || meshes[0] : meshes[0];      // the frame the geometry is in
  const r = root || topOf(frame);
  const [ox, oz] = shadowOffset(look.sun || DEFAULT_SUN, look.shadowLength != null ? look.shadowLength : SHADOW_LEN);
  const m = new THREE.ShaderMaterial({
    name: 'ink.shadow',
    uniforms: {
      uExplode: u.uExplode, uHidden: u.uHidden, uHighlight: u.uHighlight,
      uToRoot: { value: new THREE.Matrix4() }, uShadowDir: { value: new THREE.Vector2(ox, oz) },
      uPlaneY: { value: planeY }, uMinH: { value: 1e-4 }, uColor: u.uShadowColor, uOpacity: { value: 1 },
    },
    defines: definesFor(geometry),
    vertexShader: VS.shadow,
    fragmentShader: FS.shadow,
    side: THREE.DoubleSide,
  });
  m.toneMapped = false;
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -8;
  m.userData.inkRole = 'shadow';
  m.defaultAttributeValues = { ...m.defaultAttributeValues, _explode: [0, 0, 0], _part: [-1] };
  const mesh = new THREE.Mesh(geometry, m);
  mesh.name = (meshes[0].name || 'mesh') + '.shadow';
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;                   // its drawn position is not its geometry's
  mesh.userData.inkRole = 'shadow';
  mesh.userData.ownsGeometry = merged;
  mesh.userData.source = frame;
  const inv = new THREE.Matrix4();
  mesh.onBeforeRender = () => {
    inv.copy(r.matrixWorld).invert();
    m.uniforms.uToRoot.value.multiplyMatrices(inv, frame.matrixWorld);
  };
  if (attach) r.add(mesh);
  return mesh;
}
const topOf = (o) => { while (o.parent && !o.parent.isScene) o = o.parent; return o; };

/**
 * A lit LED's halo, the figure's two glow discs (bench-kinds.js: a wide one in the LED's colour at 0.3 x lit, a
 * small warm white core at 0.75 x lit) as one camera-facing quad of 4 vertices, the discs and their radial falloff
 * computed in the fragment shader (no texture). One draw call; hidden (none) while the level is 0.
 *   center: the glow's centre in the parent's frame (the LED node); radius: the outer disc at full level, metres
 *   (it shrinks to 0.45 of that as the level falls, as the figure's does), never under minPx screen pixels x the ink
 *   scale, so a 2 mm SMD LED still reads at arm's length in the headset; pull: metres the quad is moved towards the
 *   eye (default 1.6 x radius) so the board it sits on does not cut its lower half, with its drawn size kept.
 *   add: the additive share. 0 blends the discs over what is behind (the figure's SVG), 1 adds them; between, the
 *   halo lights a dark body as light does and still tints white paper or a breadboard, where pure addition shows
 *   nothing. Premultiplied blending, depth tested, no depth write, drawn last (renderOrder 3).
 * setGlow(mesh, color, level) drives it.
 */
export function createGlow({ center = [0, 0, 0], radius = 0.004, color = '#ffffff', level = 0, uniforms = null, look = {}, pull = null, minPx = 7, add = 0.35, core = '#fffbe8' } = {}) {
  const u = uniforms || createInkUniforms(look);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const c = Array.isArray(center) ? new THREE.Vector3(...center) : center.clone();
  g.boundingSphere = new THREE.Sphere(c.clone(), radius * 2 + (pull != null ? pull : 1.6 * radius));
  const m = new THREE.ShaderMaterial({
    name: 'ink.glow',
    uniforms: {
      uResolution: u.uResolution, uInkPx: u.uInkPx,
      uCenter: { value: c }, uRadius: { value: radius }, uPull: { value: pull != null ? pull : 1.6 * radius }, uMinPx: { value: minPx },
      uColor: { value: linearColor('#ffffff') }, uCore: { value: linearColor(core) }, uLevel: { value: 0 }, uAdd: { value: add },
    },
    vertexShader: VS.glow,
    fragmentShader: FS.glow,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
  });
  m.toneMapped = false;
  m.userData.inkRole = 'glow';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'glow';
  mesh.renderOrder = 3;
  mesh.userData.inkRole = 'glow';
  mesh.userData.ownsGeometry = true;
  mesh.onBeforeRender = (renderer) => updateInkViewport(u, renderer, mesh.userData.inkScale || 1);
  setGlow(mesh, color, level);
  return mesh;
}
/** A glow's colour ('#rrggbb' sRGB or THREE.Color) and level 0..1; it is drawn only while the level is above 0. */
export function setGlow(mesh, color, level) {
  const un = mesh.material.uniforms;
  if (typeof color === 'string') un.uColor.value.copy(linearColor(color));
  else if (color && color.isColor) un.uColor.value.copy(color);
  un.uLevel.value = clamp01(level);
  mesh.visible = un.uLevel.value > 0.003;
}
