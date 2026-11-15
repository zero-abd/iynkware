/**
 * Converted lab items: `lab/<kind>.glb` and its sidecar from `./xr-assets/`, when `index.json` lists `lab/<kind>`
 * (the asset pipeline's lab conversion is on its own branch; until it lands nothing is listed and every item is drawn
 * from primitives). Read with the assets registry's own helpers (`pageFolder`, `parseIndex`) and dressed by the
 * pipeline's `createXrAsset` (tools/xr-assets/material/xr-asset.js, the same lazy chunk the registry's ink look uses),
 * whose `set(channel, value)` drives the sidecar's channels, so the lab sets them by the same ids as the primitives.
 * Lab-only channels a sidecar does not have (text readouts, liquid levels) are ignored: the converted look shows them
 * when its sidecar gains them.
 */
import type { Object3D } from '@iwsdk/core';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { XrAsset } from '../../../../tools/xr-assets/schema/xr-asset';
import { pageFolder, parseIndex, type IndexItem, type ReadFile } from '../../assets/converted';
import type { ChannelValue, ItemVisual, ItemVisualSource } from './visual';

interface XrAssetApi {
  readonly object: Object3D;
  set(id: string, value: number | readonly number[]): boolean;
  node(name: string): Object3D | null;
  update(dt?: number): void;
}
interface XrAssetModule {
  createXrAsset(gltf: { scene: Object3D }, sidecar: XrAsset, options?: object): XrAssetApi;
}

const modules = import.meta.glob('../../../../tools/xr-assets/material/xr-asset.js');
const idOf = (kind: string) => `lab/${kind}`;
const text = (b: ArrayBuffer) => new TextDecoder().decode(b);

export interface GltfSource extends ItemVisualSource {
  /** Settles once the index is read or found missing. */
  readonly ready: Promise<void>;
}

export function createGltfSource(read: ReadFile | undefined = pageFolder()): GltfSource {
  let items = new Map<string, IndexItem>();
  const ready = read
    ? read('index.json')
        .then((b) => {
          items = parseIndex(JSON.parse(text(b)));
        })
        .catch(() => undefined)
    : Promise.resolve();
  const loaded = new Map<string, Promise<{ sidecar: XrAsset; scene: Object3D; ink: XrAssetModule }>>();
  const load = (item: IndexItem) => {
    let p = loaded.get(item.id);
    if (!p) {
      p = (async () => {
        const loadInk = Object.values(modules)[0];
        if (!loadInk || !read) throw new Error('no ink material in the tree');
        const [sidecar, glb, ink] = await Promise.all([read(item.sidecar).then((b) => JSON.parse(text(b)) as XrAsset), read(item.glb), loadInk() as Promise<XrAssetModule>]);
        const scene = (await new GLTFLoader().parseAsync(glb, '')).scene as unknown as Object3D;
        return { sidecar, scene, ink };
      })();
      loaded.set(item.id, p);
    }
    return p;
  };
  return {
    ready,
    has: (kind) => items.has(idOf(kind)),
    async create(kind) {
      const item = items.get(idOf(kind));
      if (!item) throw new Error(`no converted lab item ${idOf(kind)}`);
      const { sidecar, scene, ink } = await load(item);
      const asset = ink.createXrAsset({ scene: scene.clone() }, sidecar);
      const visual: ItemVisual = {
        object: asset.object,
        source: 'gltf',
        set(channel: string, value: ChannelValue) {
          if (typeof value === 'number') asset.set(channel, value);
        },
        node: (name) => asset.node(name) ?? undefined,
        update: (dt) => asset.update(dt),
        dispose: () => asset.object.removeFromParent(),
      };
      return visual;
    },
  };
}

/** Converted when the index lists it and it loads; else the primitives. A failure warns once per kind. */
export function chooseSource(gltf: GltfSource, primitives: ItemVisualSource): ItemVisualSource {
  const warned = new Set<string>();
  return {
    has: () => true,
    async create(kind, opts) {
      await gltf.ready;
      if (gltf.has(kind)) {
        try {
          return await gltf.create(kind, opts);
        } catch (e) {
          if (!warned.has(kind)) console.warn(`[lab] converted ${idOf(kind)} did not load; drawing primitives`, e);
          warned.add(kind);
        }
      }
      return primitives.create(kind, opts);
    },
  };
}
