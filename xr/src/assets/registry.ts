/**
 * The asset registry (contracts/assets.ts): one `PartAsset` per part ref and version, built once and cached. Until the
 * asset pipeline converts a part's figure, the asset is a placeholder drawn from the iynk part descriptor
 * (`./placeholder.ts`); `./converted.ts` is where converted glTF assets will come from.
 */
import type { Descriptor } from '@/parts/descriptor';
import type { PartRegistry } from '@/parts/registry';
import type { AssetRegistry, PartAsset } from '../contracts/assets';
import { loadConvertedAsset } from './converted';
import { buildPlaceholder } from './placeholder';

export { LED_PART, LIGHT_ANCHOR, MESH, placeholderShape } from './placeholder';
export type { PlaceholderShape } from './placeholder';

/** The descriptor for a ref: the given version, or the one the caller picks when none is given. */
export type Describe = (ref: string, version?: string) => Descriptor | undefined;

export interface AssetRegistryOptions {
  describe: Describe;
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

  // Converted assets are not shipped yet; this reads the pipeline's manifest once `loadConvertedAsset` does.
  const hasConverted = (_ref: string): boolean => false;

  const load = async (d: Descriptor): Promise<PartAsset> => {
    if (hasConverted(d.id)) {
      // A converted asset that fails to load still leaves the placeholder: `get` never rejects for a known ref.
      const converted = await loadConvertedAsset(d).catch(() => undefined);
      if (converted) return converted;
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
    hasConverted,
  };
}
