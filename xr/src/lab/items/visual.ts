/**
 * What an item looks like on the bench, behind one interface, so the converted glTF items (`lab/<kind>.glb` with its
 * sidecar, being made by the asset pipeline) replace the placeholder primitives without the rest of the lab knowing.
 * Both are driven by the same channel ids (`channels.ts`): the lab figures' (`turn:COLLAR`, `flame:BURNER`,
 * `swing:BOB`, `led:CV`) and a few lab-only ones the sidecars do not have yet (`text:VOUT`, `level:LIQUID`,
 * `tint:FLAME`).
 *
 * Frame: the asset frame (docs/XR_ASSETS.md section 3): metres, +y up, the front faces +z, origin at the centre of the
 * item's foot on the surface it stands on.
 */
import type { Object3D } from '@iwsdk/core';

export type ChannelValue = number | string;

export interface ItemVisual {
  readonly object: Object3D;
  readonly source: 'gltf' | 'primitive';
  /** Sets a channel; unknown ids are ignored (a converted item may not have every lab-only channel). */
  set(channel: string, value: ChannelValue): void;
  /** A moving node controls may hang on (`BOB`, `LOOP`, `PROBE`), or undefined. */
  node(name: string): Object3D | undefined;
  /** Every frame while shown: flicker, swirl. Allocates nothing. */
  update(dt: number): void;
  dispose(): void;
}

export interface ItemVisualSource {
  /** Whether this source draws `kind` (known once the source is ready). */
  has(kind: string): boolean;
  create(kind: string, opts: { label?: string }): Promise<ItemVisual>;
}
