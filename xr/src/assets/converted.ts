/**
 * The seam for converted assets. The asset pipeline (`tools/xr-assets`, docs/XR_ASSETS.md) turns each figure into a
 * binary glTF plus a sidecar (`tools/xr-assets/schema/xr-asset.ts`) and an index (`XrAssetIndex`); none is shipped in
 * `xr/` yet, so nothing here loads anything.
 *
 * When they land, `loadConvertedAsset` is the one function to fill in: read the index, load the glb with three's
 * GLTFLoader (`three/examples/jsm/loaders/GLTFLoader.js`, the same three that `@iwsdk/core` re-exports; no CDN
 * decoders), keep the sidecar as `PartAsset.sidecar`, compute `footprint` from the descriptor's layout rectangle through
 * `frame.fromSource`, give each channel node its own material clone per placement, and return `source: 'gltf'`.
 * The registry's `hasConverted` then answers from that index too.
 */
import type { Descriptor } from '@/parts/descriptor';
import type { PartAsset } from '../contracts/assets';

/**
 * The converted asset for a descriptor, or undefined when there is none and the registry draws the placeholder.
 * Not implemented: always undefined until the pipeline ships its manifest.
 */
export async function loadConvertedAsset(_descriptor: Descriptor): Promise<PartAsset | undefined> {
  return undefined;
}
