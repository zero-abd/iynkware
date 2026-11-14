/**
 * The asset registry's placeholders, built from iynk's built-in part descriptors: a sidecar in the pipeline's shape
 * (tools/xr-assets/schema/xr-asset.ts) with anchors named by simulation ids in the footprint-centre frame
 * (contracts/assets.ts), instanced holes and pins that map a ray hit back to an anchor, and the per-ref cache.
 */
import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Mesh, Raycaster, Vector3 } from '@iwsdk/core';
import type { Object3D } from '@iwsdk/core';
import { builtinRegistry } from '@/parts/builtin';
import type { Descriptor } from '@/parts/descriptor';
import type { Anchor, PartAsset } from '../src/contracts/assets';
import { LED_PART, LIGHT_ANCHOR, MESH, createAssetRegistry, describeFrom, placeholderShape } from '../src/assets/registry';

const parts = builtinRegistry();
const assets = createAssetRegistry({ describe: describeFrom(parts) });
const desc = (ref: string): Descriptor => {
  const d = parts.latest(ref);
  if (!d) throw new Error(`no built-in ${ref}`);
  return d;
};
const pinOf = (d: Descriptor, id: string) => {
  const pin = d.pins.find((p) => p.id === id);
  if (!pin?.position) throw new Error(`${d.id} has no positioned pin ${id}`);
  return pin.position;
};
const anchorOf = (asset: PartAsset, name: string): Anchor => {
  const a = asset.anchors.get(name);
  if (!a) throw new Error(`${asset.ref} has no anchor ${name}`);
  return a;
};
const meshesOf = (o: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  o.traverse((c) => {
    if ((c as Mesh).isMesh) out.push(c as Mesh);
  });
  return out;
};
/** An anchor at `mm` measured from the footprint's top-left corner (x right, up, z towards the person). */
const expectAt = (asset: PartAsset, a: Anchor, mm: readonly [number, number, number]) => {
  expect(a.position[0] - asset.footprint.x).toBeCloseTo(mm[0] / 1000, 5);
  expect(a.position[1]).toBeCloseTo(mm[1] / 1000, 5);
  expect(a.position[2] - asset.footprint.z).toBeCloseTo(mm[2] / 1000, 5);
};
const sizeOf = (asset: PartAsset): number[] => {
  const { min, max } = asset.sidecar.bounds;
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
};

describe('breadboard placeholder', () => {
  const ref = 'core.breadboard-half';

  it('puts hole c14 on the top surface, footprint-centred', async () => {
    const d = desc(ref);
    const body = d.dimensions!.body!;
    const c14 = pinOf(d, 'c14');
    const asset = await assets.get(ref);
    const a = anchorOf(asset, 'c14');
    expect(a).toMatchObject({ id: 'c14', kind: 'hole', part: '' });
    expect(a.depth).toBeGreaterThan(0);
    expectAt(asset, a, [c14.x, body.d, body.h - c14.y]);
    // the numbers the descriptor gives today: 82.5 x 54.5 x 8.5 mm, c14 at (37.44, 35.36)
    expectAt(asset, a, [37.44, 8.5, 54.5 - 35.36]);
    expect(a.normal).toEqual([0, 1, 0]);
    expect(placeholderShape(d)).toBe('surface');
    // the body is the footprint, so its centre is the origin and its corner is the footprint's
    expect(asset.footprint).toMatchObject({ x: -0.04125, z: -0.02725, w: 0.0825, d: 0.0545 });
    expect(asset.sidecar.bounds.min[0]).toBeCloseTo(-asset.sidecar.bounds.max[0], 6);
    expect(asset.sidecar.bounds.min[2]).toBeCloseTo(-asset.sidecar.bounds.max[2], 6);
  });

  it('draws the 400 holes as one instanced mesh in anchor order', async () => {
    const asset = await assets.get(ref);
    expect(asset.instanced).toHaveLength(1);
    const [set] = asset.instanced!;
    expect(set!.meshName).toBe(MESH.holes);
    expect(set!.anchors).toHaveLength(400);
    expect(new Set(set!.anchors).size).toBe(400);

    const group = asset.instantiate();
    const holes = group.getObjectByName(set!.meshName) as InstancedMesh;
    expect(holes.isInstancedMesh).toBe(true);
    expect(holes.count).toBe(400);
    const m = new Matrix4();
    const p = new Vector3();
    set!.anchors.forEach((name, i) => {
      const a = anchorOf(asset, name);
      expect(a.kind).toBe('hole');
      holes.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(p.x).toBeCloseTo(a.position[0], 6);
      expect(p.y).toBeCloseTo(a.position[1], 6);
      expect(p.z).toBeCloseTo(a.position[2], 6);
    });
    expect(meshesOf(group)).toHaveLength(2);
  });

  it('maps a ray hit on a hole back to its anchor', async () => {
    const asset = await assets.get(ref);
    const group = asset.instantiate();
    group.updateMatrixWorld(true);
    const a = anchorOf(asset, 'c14');
    const ray = new Raycaster(new Vector3(a.position[0], 1, a.position[2]), new Vector3(0, -1, 0));
    const [hit] = ray.intersectObject(group, true);
    expect(hit?.object.name).toBe(MESH.holes);
    expect(asset.instanced![0]!.anchors[hit!.instanceId!]).toBe('c14');
  });
});

describe('board placeholder', () => {
  const ref = 'core.uno-r3';

  it('has a D13 anchor on top of its header', async () => {
    const d = desc(ref);
    const d13 = pinOf(d, 'D13');
    const asset = await assets.get(ref);
    const a = anchorOf(asset, 'D13');
    expect(a).toMatchObject({ id: 'D13', kind: 'pin' });
    expectAt(asset, a, [d13.x, d.dimensions!.board!.thickness + 8.5, d.dimensions!.body!.h - d13.y]);
    expect(placeholderShape(d)).toBe('board');
    expect(asset.sidecar).toMatchObject({ schema: 'iynkware.xr-asset/1', kind: 'board', source: { descriptor: ref } });
  });

  it('maps descriptor millimetres into the asset frame through frame.fromSource', async () => {
    const d = desc(ref);
    const d13 = pinOf(d, 'D13');
    const asset = await assets.get(ref);
    const tip = new Vector3(d13.x, d13.y, d.dimensions!.board!.thickness + 8.5).applyMatrix4(
      new Matrix4().fromArray(asset.sidecar.frame.fromSource),
    );
    const a = anchorOf(asset, 'D13');
    expect(tip.x).toBeCloseTo(a.position[0], 5);
    expect(tip.y).toBeCloseTo(a.position[1], 5);
    expect(tip.z).toBeCloseTo(a.position[2], 5);
    expect(new Matrix4().fromArray(asset.sidecar.frame.fromSource).determinant()).toBeGreaterThan(0);
  });

  it('draws its 44 header pins as one instanced mesh in descriptor order', async () => {
    const d = desc(ref);
    const asset = await assets.get(ref);
    const [set] = asset.instanced!;
    expect(set!.meshName).toBe(MESH.pins);
    expect(set!.anchors).toEqual(d.pins.filter((p) => p.position).map((p) => p.id));
    expect(set!.anchors).toHaveLength(44);
    const group = asset.instantiate();
    expect((group.getObjectByName(MESH.pins) as InstancedMesh).count).toBe(44);
    expect(meshesOf(group)).toHaveLength(2);
  });
});

describe('leaded placeholders', () => {
  it('puts the LED legs at their pin positions, on the surface, with a light on the dome', async () => {
    const d = desc('core.led-5mm');
    const h = d.dimensions!.body!.h;
    const asset = await assets.get('core.led-5mm');
    expect(placeholderShape(d)).toBe('leaded');
    const legA = anchorOf(asset, 'A');
    const legK = anchorOf(asset, 'K');
    expectAt(asset, legA, [0, 0, h]);
    expectAt(asset, legK, [2.54, 0, h]);
    expect(legA.normal).toEqual([0, -1, 0]);
    const light = anchorOf(asset, LIGHT_ANCHOR);
    expect(light).toMatchObject({ id: 'led:LED', kind: 'led', part: LED_PART, channel: LIGHT_ANCHOR });
    // centred: the lens sits on the origin's vertical, halfway between the legs
    expect(light.position[0]).toBeCloseTo(0, 6);
    expect(light.position[2]).toBeCloseTo(0, 6);
    expect(legA.position[0]).toBeCloseTo(-0.00127, 6);
    expect(light.position[1]).toBeGreaterThan(d.dimensions!.body!.d / 1000);
    // real size: the 5.8 mm rim across, the body plus its standoff tall
    const size = sizeOf(asset);
    expect(size[0]).toBeCloseTo(0.0058, 4);
    expect(size[2]).toBeCloseTo(0.0058, 4);
    expect(size[1]).toBeCloseTo(light.position[1], 6);
  });

  it('describes the lens as an emissive led channel on the light mesh', async () => {
    const asset = await assets.get('core.led-5mm');
    expect(asset.sidecar.channels).toEqual([
      expect.objectContaining({ id: LIGHT_ANCHOR, kind: 'emissive', part: LED_PART, nodes: [MESH.light] }),
    ]);
    expect(asset.sidecar.parts.map((p) => [p.id, p.role])).toEqual([
      ['', 'item'],
      [LED_PART, 'led'],
    ]);
    expect(asset.instantiate().getObjectByName(MESH.light)).toBeTruthy();
  });

  it('gives each LED its own light material and shares everything else', async () => {
    const asset = await assets.get('core.led-5mm');
    const one = asset.instantiate();
    const two = asset.instantiate();
    expect(one).not.toBe(two);
    expect(meshesOf(one)).toHaveLength(2);
    const lightOne = one.getObjectByName(MESH.light) as Mesh;
    const lightTwo = two.getObjectByName(MESH.light) as Mesh;
    expect(lightOne.geometry).toBe(lightTwo.geometry);
    expect(lightOne.material).not.toBe(lightTwo.material);
    const bodyOne = one.getObjectByName(MESH.body) as Mesh;
    const bodyTwo = two.getObjectByName(MESH.body) as Mesh;
    expect(bodyOne.geometry).toBe(bodyTwo.geometry);
    expect(bodyOne.material).toBe(bodyTwo.material);
  });

  it('draws a resistor as one mesh with its legs 10.16 mm apart', async () => {
    const asset = await assets.get('core.resistor');
    expectAt(asset, anchorOf(asset, 'P1'), [0, 0, 2.3]);
    expectAt(asset, anchorOf(asset, 'P2'), [10.16, 0, 2.3]);
    // the legs and the lead between them are the widest part
    expect(sizeOf(asset)[0]).toBeCloseTo(0.01066, 5);
    expect(meshesOf(asset.instantiate())).toHaveLength(1);
    expect(asset.instanced).toBeUndefined();
  });
});

describe('cache', () => {
  it('hands out the same asset for the same ref and version', async () => {
    const d = desc('core.uno-r3');
    const [a, b, c] = await Promise.all([assets.get(d.id), assets.get(d.id), assets.get(d.id, d.version)]);
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(await assets.get(d.id)).toBe(a);
    expect(a).toMatchObject({ ref: d.id, version: d.version, source: 'placeholder' });
    expect(assets.hasConverted(d.id)).toBe(false);
  });

  it('builds a fresh group per placement over shared geometry', async () => {
    const asset = await assets.get('core.breadboard-half');
    const one = asset.instantiate();
    const two = asset.instantiate();
    expect(one).not.toBe(two);
    const [bodyOne, holesOne] = [one.getObjectByName(MESH.body) as Mesh, one.getObjectByName(MESH.holes) as InstancedMesh];
    const [bodyTwo, holesTwo] = [two.getObjectByName(MESH.body) as Mesh, two.getObjectByName(MESH.holes) as InstancedMesh];
    expect(bodyOne).not.toBe(bodyTwo);
    expect(bodyOne.geometry).toBe(bodyTwo.geometry);
    expect(holesOne.geometry).toBe(holesTwo.geometry);
    expect(holesOne.material).toBe(holesTwo.material);
  });

  it('rejects a ref it has no descriptor for', async () => {
    await expect(assets.get('core.no-such-part')).rejects.toThrow(/no part descriptor for core\.no-such-part/);
    await expect(assets.get('core.uno-r3', '9.9.9')).rejects.toThrow(/core\.uno-r3@9\.9\.9/);
    await expect(assets.preload(['core.led-5mm', 'core.no-such-part'])).rejects.toThrow(/no part descriptor/);
  });
});

describe('every built-in part', () => {
  it('gets a placeholder with one anchor per positioned pin and none for the rest', async () => {
    const refs = [...new Set(parts.list().map((s) => s.ref))];
    await assets.preload(refs);
    for (const ref of refs) {
      const d = desc(ref);
      const asset = await assets.get(ref);
      const pinIds = new Set(d.pins.map((p) => p.id));
      for (const pin of d.pins) {
        const a = asset.anchors.get(pin.id);
        expect(a !== undefined && (a.kind === 'pin' || a.kind === 'hole'), `${ref} ${pin.id}`).toBe(!!pin.position);
      }
      for (const a of asset.anchors.values()) {
        expect(a.position.every(Number.isFinite), `${ref} ${a.id}`).toBe(true);
        // connection points by simulation id, everything else '<kind>:<name>'
        if (a.kind === 'pin' || a.kind === 'hole') expect(pinIds.has(a.id), `${ref} ${a.id}`).toBe(true);
        else expect(a.id.startsWith(`${a.kind}:`), `${ref} ${a.id}`).toBe(true);
      }
      expect(asset.sidecar.anchors).toHaveLength(asset.anchors.size);
      // footprint-centre: x and z of the bounds' centre at the origin
      const { min, max } = asset.sidecar.bounds;
      expect(Math.abs(min[0] + max[0]), ref).toBeLessThan(2e-5);
      expect(Math.abs(min[2] + max[2]), ref).toBeLessThan(2e-5);
      // metres at real size: nothing on the bench is under a millimetre or over a quarter metre
      const size = sizeOf(asset);
      expect(size.every((s) => s > 0.0005 && s < 0.25), `${ref} ${size.join(' x ')}`).toBe(true);
      const meshes = meshesOf(asset.instantiate());
      expect(meshes.length, ref).toBeGreaterThan(0);
      expect(meshes.length, ref).toBeLessThanOrEqual(2);
    }
  });
});
