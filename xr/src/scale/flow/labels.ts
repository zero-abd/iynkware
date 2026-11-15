/**
 * Node voltage labels and the "conventional current" chip: every label is a cell of ONE canvas atlas drawn by the look
 * kit's `paintTag`, and ONE InstancedMesh shows them, each turned to face the viewer about the vertical axis and sized
 * so its text is 20 dmm at the viewer's distance (never nearer than 0.5 m, so it is larger at Room size).
 */
import { CanvasTexture, DoubleSide, InstancedBufferAttribute, InstancedMesh, PlaneGeometry, ShaderMaterial, SRGBColorSpace, Vector3, type Matrix4 } from '@iwsdk/core';
import type { Lang } from '../../contracts/common';
import { makeCanvas, paintTag, useFont } from '../../look/paint';
import { TAG } from '../../look/palette';
import { dmm, TYPE } from '../../look/type';
import { num } from '../kit/text';
import type { NodeSpot } from './paths';
import { uploadNow } from '../../look/upload';

export const MAX_LABELS = 8;
const COLS = 2;
const ROWS = 5;
const CELL_W = 384;
const CELL_H = 96;
const TAG_H = 80;
/** Cell index of the chip. */
const CHIP = MAX_LABELS;

export interface PickedLabel {
  readonly node: string;
  readonly text: string;
  readonly at: readonly [number, number, number];
}

/**
 * At most `max` nets, the highest |V| first, ground and nets at about 0 V left out: "D13 4.98 V". Pure.
 */
export function pickLabels(
  lang: Lang,
  volts: Readonly<Record<string, number>>,
  spots: readonly NodeSpot[],
  ground: string | undefined,
  max = MAX_LABELS,
): PickedLabel[] {
  const rows: Array<{ spot: NodeSpot; v: number }> = [];
  for (const spot of spots) {
    const v = volts[spot.node];
    if (v === undefined || !Number.isFinite(v) || spot.node === ground) continue;
    if (Math.abs(v) < 0.005) continue;
    rows.push({ spot, v });
  }
  rows.sort((a, b) => Math.abs(b.v) - Math.abs(a.v) || (a.spot.node < b.spot.node ? -1 : 1));
  return rows.slice(0, Math.min(max, MAX_LABELS)).map(({ spot, v }) => ({ node: spot.node, text: `${spot.name} ${num(lang, v, 2)} V`, at: spot.at }));
}

const VERT = /* glsl */ `
attribute vec4 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv.xy + uv * aUv.zw;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.04) discard;
  gl_FragColor = c;
  #include <colorspace_fragment>
}`;

export class FlowLabels {
  readonly mesh: InstancedMesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly aUv: InstancedBufferAttribute;
  private readonly board = new Float32Array((MAX_LABELS + 1) * 3);
  private readonly shown = new Array<string>(MAX_LABELS + 1).fill('');
  private readonly pending = new Array<string>(MAX_LABELS + 1).fill('');
  private used = 0;
  private chipOn = false;
  private lastDraw = -Infinity;
  private dirty = false;
  private readonly p = new Vector3();

  constructor() {
    this.canvas = makeCanvas(COLS * CELL_W, ROWS * CELL_H);
    this.g = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const geometry = new PlaneGeometry(1, 1);
    this.aUv = new InstancedBufferAttribute(new Float32Array((MAX_LABELS + 1) * 4), 4);
    for (let i = 0; i <= MAX_LABELS; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      this.aUv.setXYZW(i, col / COLS, 1 - (row + 1) / ROWS, 1 / COLS, 1 / ROWS);
    }
    geometry.setAttribute('aUv', this.aUv);
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { map: { value: this.texture } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new InstancedMesh(geometry, material, MAX_LABELS + 1);
    this.mesh.name = 'scale-flow-labels';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.count = 0;
  }

  /** The labels to show and where they hang (board frame), and the chip's text and place when the chip is on. */
  set(labels: readonly PickedLabel[], chip: { text: string; at: readonly [number, number, number] } | null): void {
    this.used = Math.min(labels.length, MAX_LABELS);
    for (let i = 0; i < this.used; i++) {
      const l = labels[i]!;
      this.pending[i] = l.text;
      this.board[i * 3] = l.at[0];
      this.board[i * 3 + 1] = l.at[1];
      this.board[i * 3 + 2] = l.at[2];
    }
    this.chipOn = chip !== null;
    if (chip) {
      this.pending[CHIP] = chip.text;
      this.board[CHIP * 3] = chip.at[0];
      this.board[CHIP * 3 + 1] = chip.at[1];
      this.board[CHIP * 3 + 2] = chip.at[2];
    }
    for (let i = 0; i < this.used; i++) if (this.pending[i] !== this.shown[i]) this.dirty = true;
    if (chip && this.pending[CHIP] !== this.shown[CHIP]) this.dirty = true;
  }

  /** Shows nothing until the next `set`. */
  clear(): void {
    this.used = 0;
    this.chipOn = false;
    this.mesh.count = 0;
  }

  get count(): number {
    return this.mesh.count;
  }

  /** Cell texts now drawn, for checks. */
  get texts(): readonly string[] {
    return this.shown.filter((_, i) => i < this.used || (i === CHIP && this.chipOn)).filter((s) => s !== '');
  }

  private redraw(): void {
    const g = this.g;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let i = 0; i <= MAX_LABELS; i++) {
      const text = this.pending[i]!;
      this.shown[i] = text;
      if (text === '') continue;
      const cx = (i % COLS) * CELL_W;
      const cy = Math.floor(i / COLS) * CELL_H;
      useFont(g, TYPE.tag, TAG_H * 0.5, text);
      const w = Math.min(CELL_W - 8, Math.ceil(g.measureText(text).width + TAG_H * 0.8));
      paintTag(g, text, cx + (CELL_W - w) / 2, cy + (CELL_H - TAG_H) / 2, w, TAG_H, { fill: i === CHIP ? TAG : undefined });
    }
    this.texture.needsUpdate = true;
    uploadNow(this.texture);
    this.dirty = false;
  }

  /**
   * Places the labels: `stage` maps the board frame to the world, `cam` is the viewer's world matrix elements.
   * Redraws the atlas at most every 200 ms and only when a text changed.
   */
  update(stage: Matrix4, cam: ArrayLike<number>, nowMs: number): void {
    if (this.dirty && nowMs - this.lastDraw >= 200) {
      this.lastDraw = nowMs;
      this.redraw();
    }
    const inst = this.mesh.instanceMatrix.array as Float32Array;
    const cx = cam[12]!;
    const cy = cam[13]!;
    const cz = cam[14]!;
    let n = 0;
    const total = this.used + (this.chipOn ? 1 : 0);
    for (let k = 0; k < total; k++) {
      const cell = k < this.used ? k : CHIP;
      if (this.shown[cell] === '') continue;
      this.p.set(this.board[cell * 3]!, this.board[cell * 3 + 1]!, this.board[cell * 3 + 2]!).applyMatrix4(stage);
      const dx = cx - this.p.x;
      const dz = cz - this.p.z;
      const dist = Math.max(0.5, Math.hypot(dx, cy - this.p.y, dz));
      const tagH = 2 * dmm(TYPE.tag.size, dist);
      const h = (tagH * CELL_H) / TAG_H;
      const w = h * (CELL_W / CELL_H);
      const yaw = Math.atan2(dx, dz);
      const s = Math.sin(yaw);
      const c = Math.cos(yaw);
      const o = n * 16;
      inst[o] = c * w;
      inst[o + 1] = 0;
      inst[o + 2] = -s * w;
      inst[o + 3] = 0;
      inst[o + 4] = 0;
      inst[o + 5] = h;
      inst[o + 6] = 0;
      inst[o + 7] = 0;
      inst[o + 8] = s;
      inst[o + 9] = 0;
      inst[o + 10] = c;
      inst[o + 11] = 0;
      inst[o + 12] = this.p.x;
      inst[o + 13] = this.p.y + tagH * 1.1;
      inst[o + 14] = this.p.z;
      inst[o + 15] = 1;
      n++;
    }
    // The atlas cell of each placed label: labels use cells 0..used-1, the chip cell 8.
    n = 0;
    for (let k = 0; k < total; k++) {
      const cell = k < this.used ? k : CHIP;
      if (this.shown[cell] === '') continue;
      this.aUv.setXYZW(n, (cell % COLS) / COLS, 1 - (Math.floor(cell / COLS) + 1) / ROWS, 1 / COLS, 1 / ROWS);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aUv.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
    this.texture.dispose();
    this.mesh.dispose();
  }
}
