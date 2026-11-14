/**
 * A converted drone (`tools/xr-assets`, `drones/<contentId>.glb` and its sidecar, served at `./xr-assets/`) with its
 * full handle: parts shown and hidden one by one (assembly), explode, see-through, a part highlighted, props spun.
 * The asset registry gives only the Object3D, so Range loads drones itself through the same folder and the same ink
 * material. Frame (docs/XR_ASSETS.md 3, the sidecar's `frame.fromSource`): metres, real size, +Y up, origin at the
 * craft centre on the mat; the craft's nose (figure x) is +Z and its left (figure y) is +X. To point the nose along a
 * course yaw, set `object.rotation.y = map.yawToWorld(yawDeg) + Math.PI / 2` (`CourseMap` in `../flight/core`).
 *
 *   const drone = await loadDrone('quad5');            // null when not converted (only quad5 is, today)
 *   bench.add(drone.object); drone.setPartVisible('PROPS', false); drone.set('prop:M1', 9000); drone.update(dt);
 */
import type { Object3D } from '@iwsdk/core';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { XrAsset } from '../../contracts/assets';
import { pageFolder, type ReadFile } from '../../assets/converted';

/** The ink material's per-placement handle (tools/xr-assets/material/xr-asset.js, `createXrAsset`), as Range uses it. */
export interface DroneHandle {
  readonly object: Object3D;
  readonly sidecar: XrAsset;
  /** Spin a prop or motor channel (`prop:M1`, rpm); false for an unknown channel. */
  set(channel: string, value: number): boolean;
  get(channel: string): number | undefined;
  /** Advances spinning channels by `dt` seconds; call once a frame while anything spins. */
  update(dt?: number): unknown;
  /** 0..1 for the whole craft: parts rise by their own `z` times the craft's explode factor. */
  explode(t: number): unknown;
  /** 0..1: covers fade to 28 %, the x-ray layer fades in. */
  seeThrough(t: number): unknown;
  /** Shows or hides a part (`FRAME` ... `PROPS`, the sidecar's part ids) with everything under it. */
  setPartVisible(partId: string, visible: boolean): unknown;
  isPartVisible(partId: string): boolean;
  /** Tints one part in the accent colour; null clears. */
  highlight(partId: string | null): unknown;
  /** Draw calls this placement makes now. */
  drawCalls(): number;
  dispose(): void;
}

interface InkModule {
  createXrAsset(gltf: { scene: Object3D }, sidecar: XrAsset, options?: object): DroneHandle;
}

const inkModules = import.meta.glob('../../../../tools/xr-assets/material/xr-asset.js');
const decode = (b: ArrayBuffer) => new TextDecoder().decode(b);

interface Item {
  readonly sidecar: XrAsset;
  readonly glb: ArrayBuffer;
}

const items = new Map<string, Promise<Item | null>>();
let ink: Promise<InkModule> | null = null;

/** Whether `index.json` lists `drones/<contentId>`. */
async function listed(read: ReadFile, contentId: string): Promise<boolean> {
  const index = JSON.parse(decode(await read('index.json'))) as { items?: Array<{ id?: string }> };
  return (index.items ?? []).some((i) => i.id === `drones/${contentId}`);
}

function loadItem(contentId: string, read: ReadFile): Promise<Item | null> {
  let p = items.get(contentId);
  if (!p) {
    p = (async () => {
      if (!(await listed(read, contentId))) return null;
      const [side, glb] = await Promise.all([read(`drones/${contentId}.json`), read(`drones/${contentId}.glb`)]);
      return { sidecar: JSON.parse(decode(side)) as XrAsset, glb };
    })().catch((e: unknown) => {
      items.delete(contentId);
      console.warn(`range: drone ${contentId} did not load (${e instanceof Error ? e.message : String(e)})`);
      return null;
    });
    items.set(contentId, p);
  }
  return p;
}

/**
 * A new placement of the converted drone, or null when it is not converted or does not load (the caller says so; it
 * never draws a stand-in box). Each call parses the glb again, so placements share nothing they could disturb.
 */
export async function loadDrone(contentId: string, read: ReadFile | undefined = pageFolder()): Promise<DroneHandle | null> {
  if (!read) return null;
  const item = await loadItem(contentId, read);
  if (!item) return null;
  const load = Object.values(inkModules)[0];
  if (!load) return null;
  ink ??= load() as Promise<InkModule>;
  const [module, gltf] = await Promise.all([ink, new GLTFLoader().parseAsync(item.glb.slice(0), '')]);
  return module.createXrAsset({ scene: gltf.scene as unknown as Object3D }, item.sidecar);
}
