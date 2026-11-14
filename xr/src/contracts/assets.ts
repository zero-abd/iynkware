/**
 * The asset registry: one mesh tree and its sidecar per part ref. The sidecar's shape is the asset pipeline's contract,
 * `tools/xr-assets/schema/xr-asset.ts` (docs/XR_ASSETS.md), imported here unchanged. Until an item's figure is
 * converted, the registry builds a placeholder from the iynk part descriptor and writes a sidecar of the same shape, so
 * consumers never branch on where an asset came from.
 * Contract file: changes only in its own PR (label `contract-change`).
 *
 * Implementation: `xr/src/assets/registry.ts` (`createAssetRegistry`).
 *
 * What the sidecar fixes (docs/XR_ASSETS.md sections 3 to 7):
 *   frame     metres, +Y up, the item's front faces +Z, right-handed; origin `footprint-centre` (x and z at the centre
 *             of the geometry's bounds, y = 0 on the surface the item stands on).
 *   anchors   connection points use the simulation's ids: pins `D13`, `A`, `K`; holes `a1`...`j30`, `RAIL_TP2`.
 *             Everything else is `<kind>:<name>`: `led:LED`, `control:button`, `label:U3`.
 *   channels  what lights or moves: `led:<part>` (emissive), `servo:<part>`, `press:<part>`; `nodes` names the meshes.
 * iynkware adds `footprint`: where the Studio's breadboard-view rectangle lies in that frame, which is how the bench
 * turns a placement's `x_mm`, `y_mm` (the rectangle's top-left corner) into a position.
 * The bench scales whole boards (`BenchSpace.scale`); assets never bake a scale in.
 */
import type { Object3D } from '@iwsdk/core';
import type { Anchor, XrAsset } from '../../../tools/xr-assets/schema/xr-asset';

export type {
  Anchor,
  AnchorKind,
  Channel,
  Layer,
  Part as AssetPart,
  XrAsset,
} from '../../../tools/xr-assets/schema/xr-asset';

/** The Studio's layout rectangle in the asset frame, metres. Its corner (x, z) is the document's (x_mm, y_mm). */
export interface Footprint {
  /** The far-left corner as seen from the front: the smallest x and z of the rectangle. */
  readonly x: number;
  readonly z: number;
  /** Width along +x and depth along +z. */
  readonly w: number;
  readonly d: number;
}

export interface PartAsset {
  /** `core.uno-r3` */
  readonly ref: string;
  readonly version: string;
  /** `gltf` when converted from the figure, `placeholder` when drawn from the descriptor. */
  readonly source: 'gltf' | 'placeholder';
  /** The pipeline's sidecar, or the one the placeholder builder wrote. Read-only: shared by every placement. */
  readonly sidecar: XrAsset;
  readonly footprint: Footprint;
  /** `sidecar.anchors` by id, and by each alias no other anchor has as its id. */
  readonly anchors: ReadonlyMap<string, Anchor>;
  /** Many holes or pins as one instanced mesh: anchor ids in instance order, so a ray hit maps back to a hole. */
  readonly instanced?: ReadonlyArray<{ meshName: string; anchors: readonly string[] }>;
  /**
   * A new Object3D for one placement, mesh nodes named as the sidecar names them. Geometry and materials are shared
   * between placements, except the materials of channel nodes, which each placement owns. Never dispose shared ones.
   */
  instantiate(): Object3D;
}

export interface AssetRegistry {
  /** Resolves to the converted asset when there is one, else the placeholder. Never rejects for a known ref. */
  get(ref: string, version?: string): Promise<PartAsset>;
  /** Starts loading so `get` is instant later (bench shelf, lesson start). */
  preload(refs: readonly string[]): Promise<void>;
  /** Whether a converted glTF exists for the ref (the placeholder is always available). */
  hasConverted(ref: string): boolean;
}
