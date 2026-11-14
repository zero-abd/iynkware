/**
 * Converted assets: the asset pipeline's glb and sidecar per item (`tools/xr-assets`, docs/XR_ASSETS.md), served at
 * `./xr-assets/` next to the page. vite.config.ts serves that folder in dev and copies it into the build, from
 * `tools/xr-assets/out/` once it has been built, else from the committed `tools/xr-assets/samples/`.
 *
 * Which ref is which item: `ITEM_OF`, an explicit table. The sidecar's `source.descriptor` is the descriptor's file stem
 * (`breadboard` for `core.breadboard-half`, `led-5mm` for `core.led-5mm`), so it cannot name the ref by itself, and the
 * index (fetched once, when the registry is made) does not carry it. A ref is converted when the table names an item
 * and the index lists it.
 *
 * An item loads once: its glb is parsed into one template scene, each glTF mesh node of which arrives as one Mesh named
 * as the sidecar names it (`static`, `led:L`), with the node's other primitives as its children. A placement is a clone
 * of the template (geometry shared) dressed by `chooseLook`, the one place the look is decided:
 *   ink    when the pipeline's ink material is in the tree (tools/xr-assets/material/xr-asset.js): `createXrAsset` per
 *          placement, so the placement owns its ink materials (their light uniforms follow its rotation);
 *   plain  else the glb's own glTF materials, vertex colours (COLOR_0, the light band), shared between placements
 *          except the channel nodes', which each placement owns; the xray layer is hidden.
 * Either way an emissive channel node's material answers `color`, `emissive` and `emissiveIntensity`, which is what the
 * LED view drives (xr/src/run/views/led.ts).
 */
import { Color, Matrix4, Object3D, Vector3 } from '@iwsdk/core';
import type { Material, Mesh } from '@iwsdk/core';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Descriptor } from '@/parts/descriptor';
import type { XrAssetIndex } from '../../../tools/xr-assets/schema/xr-asset';
import type { Anchor, Footprint, PartAsset, XrAsset } from '../contracts/assets';
import { MESH, layoutOf } from './placeholder';

/** Descriptor ref to the pipeline's item id (`<dir>/<id>`, as the index lists it). */
export const ITEM_OF: Readonly<Record<string, string>> = {
  'core.uno-r3': 'boards/uno-r3',
  'core.breadboard-half': 'parts/breadboard',
  'core.led-5mm': 'parts/led',
  'core.resistor': 'parts/resistor',
};

export type IndexItem = XrAssetIndex['items'][number];
/** Reads one file of the asset folder by its path there (`index.json`, `boards/uno-r3.glb`); rejects when it is missing. */
export type ReadFile = (path: string) => Promise<ArrayBuffer>;
/** A glb's scene. */
export type ParseGlb = (glb: ArrayBuffer) => Promise<Object3D>;
/** Dresses one placement: takes a clone of the item's template scene and returns the placement's object. */
export type Dress = (scene: Object3D, sidecar: XrAsset) => Object3D;

export interface ConvertedOptions {
  /** The asset folder; without one (outside a browser) nothing is converted. Default: `./xr-assets/` next to the page. */
  read?: ReadFile;
  parse?: ParseGlb;
  /** The look; default `chooseLook`. */
  look?: () => Promise<Dress>;
  warn?: (message: string) => void;
}

export interface ConvertedAssets {
  /** Settles once the index is read (or found missing); never rejects. */
  readonly ready: Promise<void>;
  /** Whether the ref has a converted item. False until `ready`. */
  has(ref: string): boolean;
  /** The converted asset; rejects, naming the item, when it cannot be used (the registry then draws the placeholder). */
  load(d: Descriptor): Promise<PartAsset>;
}

const INDEX = 'index.json';
const SCHEMA = 'iynkware.xr-asset/1';
const INDEX_SCHEMA = 'iynkware.xr-asset-index/1';
/** An `emissiveIntensity` of this or more is its channel fully lit. */
const FULL_GLOW = 1;

/** The index's items by id. Throws when it is not an `iynkware.xr-asset-index/1`. */
export function parseIndex(json: unknown): Map<string, IndexItem> {
  const index = json as Partial<XrAssetIndex> | null;
  if (index?.schema !== INDEX_SCHEMA || !Array.isArray(index.items)) throw new Error(`not an ${INDEX_SCHEMA}`);
  const ok = (i: IndexItem) => typeof i?.id === 'string' && typeof i.glb === 'string' && typeof i.sidecar === 'string';
  return new Map(index.items.filter(ok).map((i) => [i.id, i]));
}

/** The index item a ref is drawn from, if any. */
export function itemFor(ref: string, items: ReadonlyMap<string, IndexItem>): IndexItem | undefined {
  const id = ITEM_OF[ref];
  return id === undefined ? undefined : items.get(id);
}

const round5 = (m: number): number => Math.round(m * 1e5) / 1e5;

/**
 * The descriptor's layout rectangle (board-mm, x right, y back, z = 0) mapped into the asset frame by `fromSource`.
 * With `anchors`, the rectangle then moves by the mean offset from the descriptor's positioned pins (through
 * `fromSource`) to their anchors: a part's figure can be drawn somewhere on its page's breadboard (the LED at e2), and
 * its `fromSource` maps that page's millimetres rather than the descriptor's. For boards and breadboards the offset is 0.
 */
export function footprintOf(d: Descriptor, frame: XrAsset['frame'], anchors?: ReadonlyMap<string, Anchor>): Footprint {
  const { w, h } = layoutOf(d);
  const m = new Matrix4().fromArray(frame.fromSource);
  const p = new Vector3();
  let [dx, dz, n] = [0, 0, 0];
  for (const pin of anchors ? d.pins : []) {
    const a = pin.position && anchors!.get(pin.id);
    if (!pin.position || !a) continue;
    p.set(pin.position.x, pin.position.y, 0).applyMatrix4(m);
    dx += a.position[0] - p.x;
    dz += a.position[2] - p.z;
    n++;
  }
  if (n > 0) [dx, dz] = [dx / n, dz / n];
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
    p.set(x, y, 0).applyMatrix4(m);
    lo[0] = Math.min(lo[0], p.x + dx);
    lo[1] = Math.min(lo[1], p.z + dz);
    hi[0] = Math.max(hi[0], p.x + dx);
    hi[1] = Math.max(hi[1], p.z + dz);
  }
  return Object.freeze({ x: round5(lo[0]), z: round5(lo[1]), w: round5(hi[0] - lo[0]), d: round5(hi[1] - lo[1]) });
}

/** Anchors by id, then by each alias no anchor has as its id (the first anchor naming an alias keeps it). */
export function anchorMap(anchors: readonly Anchor[]): Map<string, Anchor> {
  const map = new Map(anchors.map((a) => [a.id, a]));
  for (const a of anchors) for (const alias of a.aliases ?? []) if (!map.has(alias)) map.set(alias, a);
  return map;
}

function checkSidecar(json: unknown): XrAsset {
  const s = json as Partial<XrAsset> | null;
  if (s?.schema !== SCHEMA) throw new Error(`sidecar is not ${SCHEMA}`);
  if (s.frame?.fromSource?.length !== 16) throw new Error('sidecar has no frame.fromSource');
  for (const key of ['anchors', 'channels', 'layers', 'parts'] as const) {
    if (!Array.isArray(s[key])) throw new Error(`sidecar has no ${key}`);
  }
  if (!s.bounds) throw new Error('sidecar has no bounds');
  return s as XrAsset;
}

const isDrawable = (o: Object3D): boolean => (o as Mesh).isMesh === true || (o as { isLine?: boolean }).isLine === true;
const isTriangles = (o: Object3D): boolean => (o as Mesh).isMesh === true;

/**
 * Names the template's mesh nodes as the sidecar does (GLTFLoader strips `.` and `:` and keeps the glTF name in
 * `userData.name`) and turns a node of several primitives (a Group of meshes) into its first triangle mesh, carrying
 * the node's transform and userData, with the other primitives as its children. Returns the item's root node.
 */
export function prepareTemplate(scene: Object3D, sidecar: XrAsset): Object3D {
  let root: Object3D | undefined;
  scene.traverse((o) => {
    if (!root && o.userData.name === sidecar.id) root = o;
  });
  if (!root) throw new Error(`glb has no root node ${sidecar.id}`);
  for (const node of [...root.children]) {
    const name = node.userData.name as string | undefined;
    if (name === undefined) continue;
    let mesh = node;
    const body = isDrawable(node) ? undefined : node.children.find(isTriangles);
    if (body && node.children.every((c) => isDrawable(c) && c.children.length === 0)) {
      body.position.copy(node.position);
      body.quaternion.copy(node.quaternion);
      body.scale.copy(node.scale);
      body.userData = node.userData;
      for (const c of [...node.children]) if (c !== body) body.add(c);
      root.children[root.children.indexOf(node)] = body;
      body.parent = root;
      node.parent = null;
      mesh = body;
    }
    mesh.name = name;
  }
  return root;
}

/** The meshes under the named mesh nodes of a dressed placement. */
function meshesOf(scene: Object3D, names: ReadonlySet<string>): Mesh[] {
  const out: Mesh[] = [];
  scene.traverse((o) => {
    if (names.has(o.userData.name as string)) o.traverse((c) => isTriangles(c) && out.push(c as Mesh));
  });
  return out;
}

const emissiveNodes = (sidecar: XrAsset): Set<string> =>
  new Set(sidecar.channels.filter((c) => c.kind === 'emissive').flatMap((c) => c.nodes));

/**
 * The plain look: the glb's own materials (vertex colours, the light band), shared, except the channel nodes', which are
 * this placement's clones. Layers invisible at see-through 0 (xray) are hidden.
 */
export const plainLook: Dress = (scene, sidecar) => {
  const hidden = new Set(sidecar.layers.filter((l) => l.opacity[0] <= 0.003).flatMap((l) => l.nodes));
  const channels = new Set(sidecar.channels.flatMap((c) => c.nodes));
  scene.traverse((o) => {
    const name = o.userData.name as string | undefined;
    if (name !== undefined && hidden.has(name)) o.visible = false;
  });
  scene.traverse((o) => {
    if (!channels.has(o.userData.name as string)) return;
    o.traverse((c) => {
      const m = c as Mesh;
      if (isDrawable(c)) m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    });
  });
  return scene;
};

/** What the pipeline's `xr-asset.js` gives (docs/XR_ASSETS.md section 7); only what is used here. */
interface InkModule {
  createXrAsset(gltf: { scene: Object3D }, sidecar: XrAsset, options?: object): { object: Object3D };
}
interface InkBody extends Material {
  uniforms?: { uEmissive?: { value: Color }; uEmissiveLevel?: { value: number } };
  userData: { inkRole?: string };
}

/**
 * Gives an ink body material the surface the LED view drives: `emissive` (a colour) and `emissiveIntensity` blend the
 * bands towards that colour (fully at FULL_GLOW); `color` is accepted and unused (the bands are the figure's).
 */
function glowable(m: InkBody): void {
  const glow = m.uniforms;
  if (!glow?.uEmissive || !glow.uEmissiveLevel || 'emissiveIntensity' in m) return;
  const emissive = new Color(0, 0, 0);
  let intensity = 0;
  Object.defineProperties(m, {
    color: { value: new Color(1, 1, 1) },
    emissive: { value: emissive },
    emissiveIntensity: {
      get: () => intensity,
      set: (v: number) => {
        intensity = v;
        glow.uEmissive!.value.copy(emissive);
        glow.uEmissiveLevel!.value = Math.min(1, Math.max(0, v / FULL_GLOW));
      },
    },
  });
}

const inkLook =
  (ink: InkModule): Dress =>
  (scene, sidecar) => {
    const { object } = ink.createXrAsset({ scene }, sidecar);
    for (const m of meshesOf(object, emissiveNodes(sidecar))) {
      const body = m.material as InkBody;
      if (body.userData.inkRole === 'body') glowable(body);
    }
    return object;
  };

/** The pipeline's ink material, when it is in the tree (a lazy chunk); none before it lands. */
const inkModules = import.meta.glob('../../../tools/xr-assets/material/xr-asset.js');

/** The look every converted placement gets: the ink material when present, else the glb's own vertex colours. */
export async function chooseLook(warn: (message: string) => void = console.warn): Promise<Dress> {
  const load = Object.values(inkModules)[0];
  if (!load) return plainLook;
  try {
    return inkLook((await load()) as InkModule);
  } catch (e) {
    warn(`converted assets: the ink material did not load (${message(e)}); drawing vertex colours`);
    return plainLook;
  }
}

/**
 * Placeholder-era name: an LED part's lit mesh is `MESH.light` (scripts/emulator-check.mjs reads it). A converted LED
 * part keeps that name on a non-drawing child of its channel node holding the node's material. Remove once nothing
 * looks `light` up.
 */
function keepLightName(object: Object3D, sidecar: XrAsset): void {
  if (sidecar.kind !== 'part') return;
  const leds = sidecar.channels.filter((c) => c.kind === 'emissive' && c.id.startsWith('led:'));
  const node = leds.length === 1 ? object.getObjectByName(leds[0]!.nodes[0] ?? '') : undefined;
  if (!node || !isTriangles(node) || object.getObjectByName(MESH.light)) return;
  node.add(Object.assign(new Object3D(), { name: MESH.light, visible: false, material: (node as Mesh).material }));
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const text = (b: ArrayBuffer): string => new TextDecoder().decode(b);

/** `./xr-assets/` next to the page, or undefined outside a browser. */
export function pageFolder(folder = './xr-assets/'): ReadFile | undefined {
  const base = globalThis.document?.baseURI;
  if (!base || typeof fetch !== 'function') return undefined;
  const root = new URL(folder, base);
  return async (path) => {
    const res = await fetch(new URL(path, root));
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.arrayBuffer();
  };
}

const gltfScene: ParseGlb = async (glb) => (await new GLTFLoader().parseAsync(glb, '')).scene as unknown as Object3D;

interface Loaded {
  sidecar: XrAsset;
  template: Object3D;
  dress: Dress;
}

/** Reads the index now, then each item's sidecar and glb on first use. */
export function createConvertedAssets(opts: ConvertedOptions = {}): ConvertedAssets {
  const read = 'read' in opts ? opts.read : pageFolder();
  const parse = opts.parse ?? gltfScene;
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const look = opts.look ?? (() => chooseLook(warn));
  let items = new Map<string, IndexItem>();
  const ready = read
    ? read(INDEX)
        .then((b) => {
          items = parseIndex(JSON.parse(text(b)));
        })
        .catch((e: unknown) => warn(`converted assets: no index at ./xr-assets/${INDEX} (${message(e)}); drawing placeholders`))
    : Promise.resolve();
  const loaded = new Map<string, Promise<Loaded>>();
  let dressing: Promise<Dress> | undefined;

  const loadItem = (item: IndexItem): Promise<Loaded> => {
    let p = loaded.get(item.id);
    if (!p) {
      p = (async () => {
        const [sidecar, scene, dress] = await Promise.all([
          read!(item.sidecar).then((b) => checkSidecar(JSON.parse(text(b)))),
          read!(item.glb).then(parse),
          (dressing ??= look()),
        ]);
        if (sidecar.id !== item.id) throw new Error(`sidecar is ${sidecar.id}`);
        prepareTemplate(scene, sidecar);
        return { sidecar, template: scene, dress };
      })();
      loaded.set(item.id, p);
    }
    return p;
  };

  return {
    ready,
    has: (ref) => read !== undefined && itemFor(ref, items) !== undefined,
    async load(d) {
      await ready;
      const item = itemFor(d.id, items);
      if (!item || !read) throw new Error(`no converted item for ${d.id}`);
      try {
        return build(d, item.id, await loadItem(item));
      } catch (e) {
        throw new Error(`converted asset ${item.id} (${d.id}@${d.version}): ${message(e)}`);
      }
    },
  };
}

/** The PartAsset over a loaded item. Dresses the first placement now, so a look that fails fails here, not later. */
function build(d: Descriptor, itemId: string, { sidecar, template, dress }: Loaded): PartAsset {
  const anchors = anchorMap(sidecar.anchors);
  const missing = d.pins.filter((p) => p.position && !anchors.has(p.id)).map((p) => p.id);
  if (missing.length > 0) throw new Error(`no anchor for descriptor pin ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', ...' : ''}`);
  const tag = `${d.id}@${d.version}`;
  const place = (): Object3D => {
    const object = dress(template.clone(), sidecar);
    keepLightName(object, sidecar);
    object.name = tag;
    Object.assign(object.userData, { ref: d.id, version: d.version, source: 'gltf', item: itemId });
    return object;
  };
  let first: Object3D | undefined = place();
  return Object.freeze({
    ref: d.id,
    version: d.version,
    source: 'gltf' as const,
    sidecar,
    footprint: footprintOf(d, sidecar.frame, anchors),
    anchors,
    instantiate(): Object3D {
      const object = first ?? place();
      first = undefined;
      return object;
    },
  });
}
