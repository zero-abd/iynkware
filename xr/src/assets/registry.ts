/**
 * The asset registry (contracts/assets.ts): one `PartAsset` per part ref and version, built once and cached. A ref the
 * asset pipeline has converted is drawn from its glb and sidecar (`./converted.ts`, read from `./xr-assets/` next to
 * the page); every other ref, and a converted one that fails to load, is a placeholder drawn from the iynk part
 * descriptor (`./placeholder.ts`).
 */
import type { Descriptor } from '@/parts/descriptor';
import type { PartRegistry } from '@/parts/registry';
import type { AssetRegistry, PartAsset } from '../contracts/assets';
import { createConvertedAssets } from './converted';
import type { ConvertedAssets } from './converted';
import { buildPlaceholder } from './placeholder';

export { LED_PART, LIGHT_ANCHOR, MESH, placeholderShape } from './placeholder';
export type { PlaceholderShape } from './placeholder';

/** The descriptor for a ref: the given version, or the one the caller picks when none is given. */
export type Describe = (ref: string, version?: string) => Descriptor | undefined;

export interface AssetRegistryOptions {
  describe: Describe;
  /** Converted assets. Default: `./xr-assets/` next to the page, its index read as the registry is made (none in Node). */
  converted?: ConvertedAssets;
  /** Where a converted asset that fails is reported (default console.warn); the placeholder is drawn instead. */
  warn?: (message: string) => void;
}

/** `describe` over an iynk part registry: exactly the version asked for, else the newest. */
export function describeFrom(parts: Pick<PartRegistry, 'get' | 'latest'>): Describe {
  return (ref, version) => (version === undefined ? parts.latest(ref) : parts.get(ref, version));
}

/**
 * Assets are keyed by the descriptor's `id@version`, so `get(ref)` and `get(ref, latestVersion)` hand out the same
 * object. A ref `describe` does not know rejects (and is not cached, so a part added later resolves).
 */
export function createAssetRegistry(opts: AssetRegistryOptions): AssetRegistry {
  const cache = new Map<string, Promise<PartAsset>>();

  const describe = (ref: string, version?: string): Descriptor => {
    const d = opts.describe(ref, version);
    if (!d) throw new Error(`asset registry: no part descriptor for ${version === undefined ? ref : `${ref}@${version}`}`);
    return d;
  };

  const converted = opts.converted ?? createConvertedAssets();
  const warn = opts.warn ?? ((m: string) => console.warn(m));

  const load = async (d: Descriptor): Promise<PartAsset> => {
    await converted.ready;
    if (converted.has(d.id)) {
      // A converted asset that fails to load still leaves the placeholder: `get` never rejects for a known ref.
      try {
        return await converted.load(d);
      } catch (e) {
        warn(`asset registry: ${e instanceof Error ? e.message : String(e)}; drawing the placeholder`);
      }
    }
    return buildPlaceholder(d);
  };

  const get = (ref: string, version?: string): Promise<PartAsset> => {
    let d: Descriptor;
    try {
      d = describe(ref, version);
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    const key = `${d.id}@${d.version}`;
    let asset = cache.get(key);
    if (!asset) {
      asset = load(d);
      cache.set(key, asset);
      asset.catch(() => cache.delete(key));
    }
    return asset;
  };

  return {
    get,
    /** Starts every ref at once; rejects with the first unknown ref's error, the known ones still cached. */
    async preload(refs) {
      await Promise.all(refs.map((ref) => get(ref)));
    },
    hasConverted: (ref) => converted.has(ref),
  };
}
