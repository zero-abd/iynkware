/**
 * Converted assets (src/assets/converted.ts) over the pipeline's committed samples (tools/xr-assets/samples): the index
 * and the ref table, the footprint through `frame.fromSource`, converted anchors against the placeholder's in the board
 * frame, placements, and the fallback to the placeholder when anything about an item is wrong.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Mesh, MeshStandardMaterial, Object3D } from '@iwsdk/core';
import { builtinRegistry } from '@/parts/builtin';
import type { Descriptor } from '@/parts/descriptor';
import type { PartAsset, XrAsset } from '../src/contracts/assets';
import { ITEM_OF, createConvertedAssets, footprintOf, itemFor, parseIndex, plainLook } from '../src/assets/converted';
import type { ConvertedOptions, ReadFile } from '../src/assets/converted';
import { buildPlaceholder } from '../src/assets/placeholder';
import { createAssetRegistry, describeFrom } from '../src/assets/registry';

const SAMPLES = new URL('../../tools/xr-assets/samples/', import.meta.url);
const readSample: ReadFile = async (path) => {
  const b = await readFile(fileURLToPath(new URL(path, SAMPLES)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const json = (v: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(v)).buffer as ArrayBuffer;
const sample = async (path: string): Promise<XrAsset> => JSON.parse(new TextDecoder().decode(await readSample(path))) as XrAsset;

const parts = builtinRegistry();
const desc = (ref: string): Descriptor => {
  const d = parts.latest(ref);
  if (!d) throw new Error(`no built-in ${ref}`);
  return d;
};
const BLINK = Object.keys(ITEM_OF);

/** A registry over the samples with the plain look; `opts` replaces any part of the converted source. */
const registry = (opts: ConvertedOptions = {}) => {
  const warn = vi.fn<(m: string) => void>();
  const converted = createConvertedAssets({ read: readSample, look: async () => plainLook, warn, ...opts });
  return { warn, assets: createAssetRegistry({ describe: describeFrom(parts), converted, warn }) };
};

/** A point's offset from the footprint's far-left corner, metres (x right, z towards the person). */
const inBoard = (asset: PartAsset, p: readonly number[]): [number, number] => [p[0]! - asset.footprint.x, p[2]! - asset.footprint.z];

describe('converted asset index', () => {
  it('maps the Blink refs to sample items and nothing else', async () => {
    const items = parseIndex(JSON.parse(new TextDecoder().decode(await readSample('index.json'))));
    for (const ref of BLINK) expect(itemFor(ref, items)).toMatchObject({ id: ITEM_OF[ref], glb: `${ITEM_OF[ref]}.glb` });
    expect(itemFor('core.push-button-6mm', items)).toBeUndefined();
    expect(itemFor('core.led-5mm', new Map())).toBeUndefined();
    expect(() => parseIndex({ schema: 'iynkware.xr-asset/1', items: [] })).toThrow(/index/);
  });

  it('answers hasConverted from the index and draws the rest as placeholders', async () => {
    const { assets, warn } = registry();
    await assets.preload([...BLINK, 'core.push-button-6mm']);
    for (const ref of BLINK) {
      expect(assets.hasConverted(ref)).toBe(true);
      expect((await assets.get(ref)).source).toBe('gltf');
    }
    expect(assets.hasConverted('core.push-button-6mm')).toBe(false);
    expect((await assets.get('core.push-button-6mm')).source).toBe('placeholder');
    expect(warn).not.toHaveBeenCalled();
  });

  it('converts nothing without an asset folder', async () => {
    const { assets } = registry({ read: undefined });
    expect((await assets.get('core.uno-r3')).source).toBe('placeholder');
    expect(assets.hasConverted('core.uno-r3')).toBe(false);
  });
});

describe('converted footprint', () => {
  it('is the layout rectangle through frame.fromSource', async () => {
    const d = desc('core.uno-r3');
    const fp = footprintOf(d, { ...(await sample('boards/uno-r3.json')).frame, fromSource: [0.001, 0, 0, 0, 0, 0, -0.001, 0, 0, 0.001, 0, 0, 0.01, 0, 0.02, 1] });
    const ph = buildPlaceholder(d).footprint;
    expect(fp.x).toBeCloseTo(0.01, 6);
    expect(fp.z).toBeCloseTo(0.02 - ph.d, 6);
    expect(fp.w).toBeCloseTo(ph.w, 6);
    expect(fp.d).toBeCloseTo(ph.d, 6);
  });

  it('moves the rectangle onto the pins when fromSource is the figure page frame', async () => {
    const d = desc('core.led-5mm');
    const led = await sample('parts/led.json');
    const anchors = new Map(led.anchors.map((a) => [a.id, a]));
    const page = footprintOf(d, led.frame);
    const fit = footprintOf(d, led.frame, anchors);
    expect(Math.hypot(fit.x - page.x, fit.z - page.z)).toBeGreaterThan(0.01);
    // Leg A is the descriptor's (0, 0): the rectangle's front-left corner, so at (x, z + d) from the far-left one.
    expect(fit.x).toBeCloseTo(anchors.get('A')!.position[0], 5);
    expect(fit.z + fit.d).toBeCloseTo(anchors.get('A')!.position[2], 5);
  });

  it('has the placeholder footprint size for every Blink item, and the breadboard its corner too', async () => {
    const { assets } = registry();
    for (const ref of BLINK) {
      const [asset, ph] = [await assets.get(ref), buildPlaceholder(desc(ref))];
      expect(asset.footprint.w, ref).toBeCloseTo(ph.footprint.w, 5);
      expect(asset.footprint.d, ref).toBeCloseTo(ph.footprint.d, 5);
    }
    const bb = await assets.get('core.breadboard-half');
    const ph = buildPlaceholder(desc('core.breadboard-half')).footprint;
    expect(Math.abs(bb.footprint.x - ph.x)).toBeLessThan(0.0005);
    expect(Math.abs(bb.footprint.z - ph.z)).toBeLessThan(0.0005);
  });
});

describe('converted anchors', () => {
  const near = async (ref: string, ids: (asset: PartAsset) => string[]) => {
    const { assets } = registry();
    const asset = await assets.get(ref);
    const ph = buildPlaceholder(desc(ref));
    expect(asset.source).toBe('gltf');
    const list = ids(asset);
    expect(list.length).toBeGreaterThan(0);
    const off: string[] = [];
    for (const id of list) {
      const [a, b] = [asset.anchors.get(id), ph.anchors.get(id)];
      if (!a || !b) {
        off.push(`${id}: ${a ? '' : 'no converted anchor'}${b ? '' : 'no placeholder anchor'}`);
        continue;
      }
      const [ax, az] = inBoard(asset, a.position);
      const [bx, bz] = inBoard(ph, b.position);
      const mm = Math.hypot(ax - bx, az - bz) * 1000;
      if (mm > 0.5) off.push(`${id}: ${mm.toFixed(2)} mm`);
    }
    expect(off).toEqual([]);
    return list.length;
  };
  const positioned = (ref: string) => () => desc(ref).pins.filter((p) => p.position).map((p) => p.id);

  it('puts every positioned Uno R3 pin within 0.5 mm of the placeholder', async () => {
    expect(await near('core.uno-r3', positioned('core.uno-r3'))).toBeGreaterThan(30);
  });

  it('puts every breadboard hole of the sample within 0.5 mm of the placeholder', async () => {
    const holes = (asset: PartAsset) => asset.sidecar.anchors.filter((a) => a.kind === 'hole').map((a) => a.id);
    expect(await near('core.breadboard-half', holes)).toBe(400);
  });

  it('puts the LED and resistor legs within 0.5 mm of the placeholder', async () => {
    expect(await near('core.led-5mm', positioned('core.led-5mm'))).toBe(2);
    expect(await near('core.resistor', positioned('core.resistor'))).toBe(2);
  });
});

describe('converted placements', () => {
  const meshNamed = (o: Object3D, name: string) => o.getObjectByName(name) as Mesh;

  it('shares static geometry and materials and owns its channel materials', async () => {
    const { assets } = registry();
    const uno = await assets.get('core.uno-r3');
    const [one, two] = [uno.instantiate(), uno.instantiate()];
    expect(one.userData).toMatchObject({ ref: 'core.uno-r3', source: 'gltf', item: 'boards/uno-r3' });
    const [s1, s2] = [meshNamed(one, 'static'), meshNamed(two, 'static')];
    expect(s1.isMesh).toBe(true);
    expect(s1.geometry).toBe(s2.geometry);
    expect(s1.material).toBe(s2.material);
    const [l1, l2] = [meshNamed(one, 'led:L'), meshNamed(two, 'led:L')];
    expect(l1.isMesh).toBe(true);
    expect(l1.geometry).toBe(l2.geometry);
    expect(l1.material).not.toBe(l2.material);
    expect(meshNamed(one, 'static.xray').visible).toBe(false);
  });

  it('gives the LED channel node a material the LED view can light, also under the placeholder name', async () => {
    const { assets } = registry();
    const led = await assets.get('core.led-5mm');
    const channel = led.sidecar.channels.find((c) => c.kind === 'emissive' && c.id.startsWith('led:'));
    const object = led.instantiate();
    const node = meshNamed(object, channel!.nodes[0]!);
    const mat = node.material as MeshStandardMaterial;
    expect(mat.emissive).toBeDefined();
    expect((object.getObjectByName('light') as Mesh).material).toBe(mat);
    expect(led.anchors.get('A')).toMatchObject({ kind: 'pin' });
  });
});

describe('converted asset fallback', () => {
  const failing = async (opts: ConvertedOptions, why: RegExp, othersLoad = true) => {
    const { assets, warn } = registry(opts);
    const asset = await assets.get('core.uno-r3');
    expect(asset.source).toBe('placeholder');
    expect(asset.anchors.get('D13')).toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/boards\/uno-r3/));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(why));
    if (othersLoad) expect((await assets.get('core.led-5mm')).source).toBe('gltf');
  };

  it('draws the placeholder when the loader throws', async () => {
    await failing({ parse: () => Promise.reject(new Error('bad glb')) }, /bad glb/, false);
  });

  it('draws the placeholder when a file is missing', async () => {
    await failing({ read: (p) => (p === 'boards/uno-r3.glb' ? Promise.reject(new Error('HTTP 404')) : readSample(p)) }, /404/);
  });

  it('draws the placeholder for a bad sidecar', async () => {
    await failing({ read: (p) => (p === 'boards/uno-r3.json' ? Promise.resolve(json({ schema: 'nope' })) : readSample(p)) }, /sidecar/);
  });

  it('draws the placeholder when a descriptor pin has no anchor', async () => {
    const uno = await sample('boards/uno-r3.json');
    const pin = desc('core.uno-r3').pins.find((p) => p.position)!.id;
    const cut = { ...uno, anchors: uno.anchors.filter((a) => a.id !== pin && !(a.aliases ?? []).includes(pin)) };
    await failing({ read: (p) => (p === 'boards/uno-r3.json' ? Promise.resolve(json(cut)) : readSample(p)) }, new RegExp(`no anchor for descriptor pin ${pin}`));
  });

  it('draws placeholders when there is no index', async () => {
    const { assets, warn } = registry({ read: (p) => (p === 'index.json' ? Promise.reject(new Error('HTTP 404')) : readSample(p)) });
    expect((await assets.get('core.uno-r3')).source).toBe('placeholder');
    expect(assets.hasConverted('core.uno-r3')).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no index/));
  });
});
