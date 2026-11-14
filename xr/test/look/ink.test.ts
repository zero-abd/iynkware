import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { drawnBox, paintBands, smoothOutlineNormals } from '../../src/look/ink';
import { BANDS } from '../../src/look/palette';

describe('look ink helpers', () => {
  it('paints the three bands as linear vertex attributes', () => {
    const g = paintBands(new BoxGeometry(1, 1, 1), BANDS.mustard);
    const n = g.attributes.position!.count;
    expect(g.attributes.color!.count).toBe(n);
    expect(g.attributes._ink_mid!.count).toBe(n);
    expect(g.attributes._ink_dark!.count).toBe(n);
    const l = new Color(BANDS.mustard.l);
    expect(g.attributes.color!.getX(0)).toBeCloseTo(l.r, 5);
    expect(g.attributes._ink_dark!.getZ(n - 1)).toBeCloseTo(new Color(BANDS.mustard.d).b, 5);
  });

  it('smooths outline normals across a hard corner', () => {
    const g = smoothOutlineNormals(new BoxGeometry(1, 1, 1).toNonIndexed());
    const pos = g.attributes.position!, out = g.attributes._outline_normal!;
    for (let i = 0; i < pos.count; i++) {
      // every box vertex is a corner shared by three faces: its push direction is the corner diagonal
      const k = 1 / Math.sqrt(3);
      expect(out.getX(i)).toBeCloseTo(Math.sign(pos.getX(i)) * k, 5);
      expect(out.getY(i)).toBeCloseTo(Math.sign(pos.getY(i)) * k, 5);
      expect(out.getZ(i)).toBeCloseTo(Math.sign(pos.getZ(i)) * k, 5);
    }
  });

  it('bounds bodies only, never the ink helpers placed by their shaders', () => {
    const item = new Group();
    const body = new Mesh(new BoxGeometry(0.1, 0.02, 0.05), new MeshBasicMaterial());
    const fat = new Mesh(new PlaneGeometry(2, 4), new MeshBasicMaterial());
    fat.userData.inkRole = 'line';
    const halo = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial());
    halo.userData.inkRole = 'glow';
    body.add(halo);
    item.add(body, fat);
    item.position.set(1, 0, 0);
    const box = drawnBox(item);
    expect(box.min.x).toBeCloseTo(0.95, 6);
    expect(box.max.x).toBeCloseTo(1.05, 6);
    expect(box.max.y).toBeCloseTo(0.01, 6);
    expect(box.max.z).toBeCloseTo(0.025, 6);
  });
});
