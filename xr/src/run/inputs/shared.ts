/** What the input pieces share: the placed part they act on and the host that sends, shows chips and lights the cue. */
import { Quaternion, Vector3, type Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { PartAsset } from '../../contracts/assets';
import { animated, MOTION } from '../kit/motion';
import type { InputSpec } from './map';

export interface LivePart {
  readonly id: string;
  readonly object: Object3D;
  readonly asset: PartAsset;
  readonly specs: readonly InputSpec[];
  /** Where a control sits in the part's frame (its `control:` anchor), or the middle of its top. */
  readonly controlAt: readonly [number, number, number];
  /** The part's size in its own frame, metres: x and z of its bounds. */
  readonly size: readonly [number, number];
  /** Where the top middle of the part is, in its own frame (sensors read from here). */
  readonly topAt: readonly [number, number, number];
  /** The middle of the part's front face (+z), where a beam leaves. */
  readonly frontAt: readonly [number, number, number];
}

export interface Host {
  readonly app: XrApp;
  /** The run is going (`running` or `paused`). */
  live(): boolean;
  send(part: string, path: string, value: number | boolean): void;
  /** Shows a readout chip above the part for a moment. */
  chip(part: LivePart, text: string): void;
  /** The part's hover ring brightens while a hand or ray is on its control. */
  hover(part: LivePart, on: boolean): void;
}

/** What a part's piece gives back: a per frame step, a reset to the run's start, and a teardown. */
export interface Piece {
  /** The run went live (true) or stopped (false). `reset` follows a stop. */
  live?(on: boolean): void;
  tick?(dt: number, nowMs: number): void;
  reset(): void;
  dispose(): void;
}

const axis = new Vector3();
const spin = new Quaternion();
const pivot = new Vector3();

/**
 * Drives the node of a sidecar channel (`press:<part>` translate, `turn:<part>` rotate) from a 0..1 position over the
 * channel's value range.
 */
export interface Mover {
  /** Eases to `t` (0..1) over `ms`. */
  to(t: number, ms: number): void;
  /** Jumps. */
  set(t: number): void;
  dispose(): void;
}

/** Null when the part has no such channel or node (yet): the input is sent all the same. */
export function mover(app: XrApp, part: LivePart, prefix: 'press:' | 'turn:', rest = 0): Mover | null {
  const ch = part.asset.sidecar.channels.find((c) => c.id.startsWith(prefix) && (c.kind === 'translate' || c.kind === 'rotate'));
  const name = ch?.nodes[0];
  const node = name === undefined ? undefined : part.object.getObjectByName(name);
  if (!ch || !node || !ch.axis) return null;
  const base = node.position.clone();
  const baseQ = node.quaternion.clone();
  const ax = ch.axis;
  const pv = ch.pivot;
  const apply = (t: number) => {
    const v = ch.value.min + (ch.value.max - ch.value.min) * t;
    const d = (ch.scale ?? 1) * (v - ch.value.rest);
    if (ch.kind === 'translate') {
      node.position.set(base.x + ax[0] * d, base.y + ax[1] * d, base.z + ax[2] * d);
      return;
    }
    axis.set(ax[0], ax[1], ax[2]).normalize();
    spin.setFromAxisAngle(axis, d);
    node.quaternion.copy(spin).multiply(baseQ);
    if (pv) {
      pivot.set(pv[0], pv[1], pv[2]);
      node.position.copy(base).sub(pivot).applyQuaternion(spin).add(pivot);
    }
  };
  const a = animated(app, rest, apply, 'move');
  return {
    to: (t, ms) => a.to(t, ms),
    set: (t) => a.set(t),
    dispose() {
      a.dispose();
      node.position.copy(base);
      node.quaternion.copy(baseQ);
    },
  };
}

export const PRESS_MS = MOTION.press;
export const RELEASE_MS = MOTION.release;
export const STATE_MS = MOTION.state;
