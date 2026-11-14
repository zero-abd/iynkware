/**
 * The servo view: the horn (the `servo:` rotate channel's node) turns about the shaft to the commanded angle at a real
 * servo's slew, slowing as it arrives. Unpowered it holds where it is. Only the channel's node moves, never geometry.
 *
 * `turnAbout` and `rigOf` are shared with the motor view (`motor.ts`): they turn a channel's node about the channel's
 * axis and pivot in the part object's frame, whatever transform the node starts with.
 */
import { Quaternion, Vector3, type Object3D } from '@iwsdk/core';
import type { Channel, PartAsset } from '../../contracts/assets';
import type { PartState, PartView, PartViewFactory } from '../../contracts/part-view';

/** A hobby servo's slew: an SG90 sweeps 60 degrees in about 0.1 s. */
export const SERVO_SLEW_DEG_PER_S = 600;
/** Inside this many degrees of the target the horn lands. */
const LAND_DEG = 0.05;
/** Within this many degrees of the target the horn slows (a real servo's loop does), down to a quarter speed. */
const EASE_DEG = 12;

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** One step of a servo at `slewDegPerS` towards `target`: constant speed, slowing for the last `EASE_DEG`, then it lands. */
export function servoStep(current: number, target: number, dtSeconds: number, slewDegPerS = SERVO_SLEW_DEG_PER_S): number {
  const gap = target - current;
  const dist = Math.abs(gap);
  if (dist <= LAND_DEG) return target;
  const speed = slewDegPerS * Math.max(0.25, Math.min(1, dist / EASE_DEG));
  const step = speed * Math.max(0, dtSeconds);
  return step >= dist ? target : current + Math.sign(gap) * step;
}

/** The angle in radians a channel turns its node for `value` (degrees, rpm-integrated degrees...): away from rest, by scale. */
export function channelRadians(channel: Pick<Channel, 'value' | 'scale'>, value: number): number {
  return (value - channel.value.rest) * (channel.scale ?? Math.PI / 180);
}

/** What a view needs of one channel: its node, and the node's own start so a turn composes with it. */
export interface Rig {
  readonly channel: Channel;
  readonly node: Object3D;
  readonly axis: Vector3;
  readonly pivot: Vector3;
  readonly basePosition: Vector3;
  readonly baseQuaternion: Quaternion;
}

/** The first channel of `kind` whose id starts with `prefix` and whose node exists in the placed object. */
export function rigOf(asset: PartAsset, object: Object3D, prefix: string, kinds: readonly Channel['kind'][]): Rig | undefined {
  for (const channel of asset.sidecar.channels) {
    if (!channel.id.startsWith(prefix) || !kinds.includes(channel.kind)) continue;
    const name = channel.nodes[0];
    const node = name === undefined ? undefined : object.getObjectByName(name);
    if (!node) continue;
    const axis = new Vector3(...(channel.axis ?? [0, 1, 0])).normalize();
    const pivot = new Vector3(...(channel.pivot ?? [0, 0, 0]));
    return { channel, node, axis, pivot, basePosition: node.position.clone(), baseQuaternion: node.quaternion.clone() };
  }
  return undefined;
}

const q = new Quaternion();
const p = new Vector3();

/** Turns the node `radians` about the channel's axis through its pivot (object frame), from the node's rest pose. No allocation. */
export function turnAbout(rig: Rig, radians: number): void {
  q.setFromAxisAngle(rig.axis, radians);
  p.copy(rig.basePosition).sub(rig.pivot).applyQuaternion(q).add(rig.pivot);
  rig.node.position.copy(p);
  rig.node.quaternion.multiplyQuaternions(q, rig.baseQuaternion);
  rig.node.updateMatrix();
}

export const servoView: PartViewFactory = (ctx): PartView => {
  const rig = rigOf(ctx.asset, ctx.object, 'servo:', ['rotate']);
  const { min, max, rest } = rig?.channel.value ?? { min: 0, max: 180, rest: 90 };
  let current = rest;
  let target = rest;
  const show = () => {
    if (rig) turnAbout(rig, channelRadians(rig.channel, current));
  };
  return {
    partId: ctx.partId,
    update(state: PartState) {
      // Unpowered, a servo holds the last angle it was driven to.
      if (state.kind === 'servo' && state.powered) target = clamp(state.angle, min, max);
    },
    tick(dt) {
      if (current === target) return;
      current = servoStep(current, target, dt);
      show();
    },
    reset() {
      current = target = rest;
      show();
    },
    dispose() {
      current = target = rest;
      show();
    },
  };
};
