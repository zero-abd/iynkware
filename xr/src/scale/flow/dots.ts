/**
 * The flow's dots: ONE InstancedMesh of inked discs (or, under reduced motion, static arrowheads), coloured by the
 * voltage step of the node they run in. A dot is a quad that faces the viewer in the shader; the instance matrix only
 * carries its board frame position. Nothing is allocated per frame: the instance arrays are filled in place.
 */
import { Color, DoubleSide, InstancedBufferAttribute, InstancedMesh, PlaneGeometry, ShaderMaterial } from '@iwsdk/core';
import { ACCENT, INK, MUTED_DIM, mixHex } from '../../look/palette';
import { boardSpeed, cappedSpacing, dotsOn, firstDot, MAX_DOTS, MIN_FLOW_AMPS, RAMP_STEPS, spacingOf } from './motion';
import type { Topology } from './paths';

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute vec3 aDir;
uniform float uSize;
varying vec2 vP;
varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
  vec2 d = (modelViewMatrix * vec4(aDir, 0.0)).xy;
  d = length(d) > 1e-6 ? normalize(d) : vec2(1.0, 0.0);
  vec2 p = position.xy;
  vec2 r = vec2(p.x * d.x - p.y * d.y, p.x * d.y + p.y * d.x);
  mv.xy += r * uSize;
  gl_Position = projectionMatrix * mv;
  vP = p;
  vC = aColor;
}`;

const FRAG = /* glsl */ `
uniform float uArrow;
uniform vec3 uInk;
varying vec2 vP;
varying vec3 vC;
void main() {
  vec2 p = vP;
  vec3 col = vC;
  if (uArrow < 0.5) {
    float r = length(p);
    if (r > 1.0) discard;
    if (r > 0.6) col = uInk;
  } else {
    float e = min(p.x + 0.7, (0.9 - p.x) * 0.5 - abs(p.y));
    if (e < 0.0) discard;
    if (e < 0.16) col = uInk;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** Ramp colours by |step| 0..8, linear rgb: ink-dim toward the accent. */
const RAMP: Float32Array = (() => {
  const out = new Float32Array((RAMP_STEPS + 1) * 3);
  const c = new Color();
  for (let i = 0; i <= RAMP_STEPS; i++) {
    c.set(mixHex(MUTED_DIM, ACCENT, i / RAMP_STEPS));
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  return out;
})();

export interface DotsView {
  /** The stage's kind and scale (world units per board metre). */
  readonly kind: 'bench' | 'room';
  readonly scale: number;
  readonly reduced: boolean;
}

export class FlowDots {
  readonly mesh: InstancedMesh;
  private readonly aColor: InstancedBufferAttribute;
  private readonly aDir: InstancedBufferAttribute;
  private readonly material: ShaderMaterial;
  private topo: Topology | null = null;
  private travelled = new Float64Array(0);
  private amps = new Float64Array(0);
  private steps = new Uint8Array(0);
  private active = new Int32Array(0);
  private activeCount = 0;
  private totalLength = 0;

  constructor() {
    const geometry = new PlaneGeometry(2, 2);
    this.aColor = new InstancedBufferAttribute(new Float32Array(MAX_DOTS * 3), 3);
    this.aDir = new InstancedBufferAttribute(new Float32Array(MAX_DOTS * 3), 3);
    geometry.setAttribute('aColor', this.aColor);
    geometry.setAttribute('aDir', this.aDir);
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uSize: { value: 0.003 }, uArrow: { value: 0 }, uInk: { value: new Color(INK) } },
      side: DoubleSide,
    });
    this.mesh = new InstancedMesh(geometry, this.material, MAX_DOTS);
    this.mesh.name = 'scale-flow-dots';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < MAX_DOTS; i++) {
      m[i * 16] = 1;
      m[i * 16 + 5] = 1;
      m[i * 16 + 10] = 1;
      m[i * 16 + 15] = 1;
    }
  }

  /** A new topology (layout or project change). Keeps nothing from the old one. */
  setTopology(topo: Topology | null): void {
    this.topo = topo;
    const n = topo?.segs.length ?? 0;
    this.travelled = new Float64Array(n);
    this.amps = new Float64Array(n);
    this.steps = new Uint8Array(n);
    this.active = new Int32Array(n);
    this.activeCount = 0;
    this.totalLength = 0;
    this.mesh.count = 0;
  }

  /** Takes the currents (`amps`, signed, per segment) and steps (|ramp step| per segment) of a new analog frame. */
  setFlow(amps: Float64Array, stepOf: (segIndex: number) => number): void {
    const topo = this.topo;
    if (!topo) return;
    let k = 0;
    let total = 0;
    for (let i = 0; i < topo.segs.length; i++) {
      this.amps[i] = amps[i]!;
      this.steps[i] = Math.min(RAMP_STEPS, Math.abs(stepOf(i)));
      if (Math.abs(amps[i]!) >= MIN_FLOW_AMPS) {
        this.active[k++] = i;
        total += topo.segs[i]!.length;
      }
    }
    this.activeCount = k;
    this.totalLength = total;
  }

  clear(): void {
    this.activeCount = 0;
    this.totalLength = 0;
    this.mesh.count = 0;
  }

  get count(): number {
    return this.mesh.count;
  }

  /** Fills the instances for this frame. `simDt` is simulated seconds since the last call (0 while paused). */
  update(simDt: number, view: DotsView): void {
    const topo = this.topo;
    const mesh = this.mesh;
    if (!topo || this.activeCount === 0) {
      mesh.count = 0;
      return;
    }
    const spacing = cappedSpacing(spacingOf(view.kind, view.scale, view.reduced), this.totalLength);
    const world = spacing * view.scale;
    this.material.uniforms.uArrow!.value = view.reduced ? 1 : 0;
    this.material.uniforms.uSize!.value = view.reduced ? Math.min(0.009, Math.max(0.003, world * 0.25)) : Math.max(0.0012, world * 0.22);
    const inst = mesh.instanceMatrix.array as Float32Array;
    const col = this.aColor.array as Float32Array;
    const dir = this.aDir.array as Float32Array;
    let n = 0;
    for (let a = 0; a < this.activeCount && n < MAX_DOTS; a++) {
      const i = this.active[a]!;
      const s = topo.segs[i]!;
      const amps = this.amps[i]!;
      const sign = amps >= 0 ? 1 : -1;
      let first: number;
      if (view.reduced) first = Math.min(spacing / 2, s.length / 2);
      else {
        this.travelled[i] = (this.travelled[i]! + sign * boardSpeed(amps, view.scale) * simDt) % 1000;
        first = firstDot(this.travelled[i]!, spacing);
      }
      const pts = s.pts;
      const cum = s.cum;
      const last = cum.length - 2;
      const c = this.steps[i]! * 3;
      let j = 0;
      const count = dotsOn(s.length - first, spacing);
      for (let k = 0; k < count && n < MAX_DOTS; k++) {
        const d = first + k * spacing;
        if (d > s.length) break;
        while (j < last && cum[j + 1]! < d) j++;
        const span = cum[j + 1]! - cum[j]!;
        const t = span > 0 ? (d - cum[j]!) / span : 0;
        const x0 = pts[j * 3]!;
        const y0 = pts[j * 3 + 1]!;
        const z0 = pts[j * 3 + 2]!;
        const dx = pts[j * 3 + 3]! - x0;
        const dy = pts[j * 3 + 4]! - y0;
        const dz = pts[j * 3 + 5]! - z0;
        const o = n * 16;
        inst[o + 12] = x0 + dx * t;
        inst[o + 13] = y0 + dy * t;
        inst[o + 14] = z0 + dz * t;
        const q = n * 3;
        dir[q] = dx * sign;
        dir[q + 1] = dy * sign;
        dir[q + 2] = dz * sign;
        col[q] = RAMP[c]!;
        col[q + 1] = RAMP[c + 1]!;
        col[q + 2] = RAMP[c + 2]!;
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aDir.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
