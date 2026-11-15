/** Insight: layer opacity, build levels and lifts, target choice, restore, strings. */
import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, BoxGeometry, Group } from '@iwsdk/core';
import { ownMaterials, setOpacity } from '../../src/scale/kit/materials';
import { tableProblems } from '../../src/scale/kit/text';
import {
  bodyOpacity, buildLevel, COVER_OPACITY, LEVEL_LIFT, layerOpacity, lensAmount, liftOf, movedByBench, targetOf,
} from '../../src/scale/insight/lens';
import { INSIGHT_STRINGS } from '../../src/scale/insight/strings';

describe('layerOpacity', () => {
  it('keeps base, fades cover to 0.28 and brings xray in', () => {
    expect(layerOpacity('base', 1)).toBe(1);
    expect(layerOpacity('cover', 0)).toBe(1);
    expect(layerOpacity('cover', 1)).toBeCloseTo(COVER_OPACITY);
    expect(layerOpacity('cover', 0.5)).toBeCloseTo(0.64);
    expect(layerOpacity('xray', 0)).toBe(0);
    expect(layerOpacity('xray', 1)).toBe(1);
  });
  it('clamps and ignores junk', () => {
    expect(layerOpacity('xray', 3)).toBe(1);
    expect(layerOpacity('cover', Number.NaN)).toBe(1);
    expect(bodyOpacity(1)).toBeCloseTo(COVER_OPACITY);
  });
});

describe('build levels and lift', () => {
  it('puts boards and surfaces at 0, seated parts at 1, modules at 2', () => {
    expect(buildLevel('surface', false, 'part', 'cmp_bb')).toBe(0);
    expect(buildLevel('board', false, 'board', 'brd_uno')).toBe(0);
    expect(buildLevel('part', true, 'part', 'cmp_led1')).toBe(1);
    expect(buildLevel('part', true, 'module', 'cmp_shield')).toBe(2);
    expect(buildLevel(undefined, false, undefined, 'brd_x')).toBe(0);
  });
  it('lifts by level and amount', () => {
    expect(liftOf(0, 1)).toBe(0);
    expect(liftOf(1, 1)).toBeCloseTo(LEVEL_LIFT);
    expect(liftOf(2, 0.5)).toBeCloseTo(LEVEL_LIFT);
    expect(liftOf(2, 0)).toBe(0);
  });
});

describe('targets', () => {
  const placed = (id: string) => id === 'cmp_led1' || id === 'brd_uno';
  it('aims at the one selected placed part, else the whole build', () => {
    expect(targetOf(['cmp_led1'], placed)).toBe('cmp_led1');
    expect(targetOf([], placed)).toBeNull();
    expect(targetOf(['cmp_led1', 'brd_uno'], placed)).toBeNull();
    expect(targetOf(['wir_1'], placed)).toBeNull();
  });
  it('gives a placement its share of a lens', () => {
    expect(lensAmount({ amount: 0.6, part: null }, 'cmp_led1')).toBe(0.6);
    expect(lensAmount({ amount: 1, part: 'cmp_led1' }, 'cmp_led1')).toBe(1);
    expect(lensAmount({ amount: 1, part: 'cmp_led1' }, 'brd_uno')).toBe(0);
  });
  it('tells a bench write from its own', () => {
    expect(movedByBench([0, 0.018, 0], [0, 0.018, 0])).toBe(false);
    expect(movedByBench([0.01, 0, 0], [0, 0.018, 0])).toBe(true);
  });
});

describe('restore at 0', () => {
  it('returns the original materials and opacity', () => {
    const shared = new MeshBasicMaterial({ color: 0xff0000 });
    const root = new Group();
    const a = new Mesh(new BoxGeometry(), shared);
    const b = new Mesh(new BoxGeometry(), shared);
    root.add(a, b);
    const owned = ownMaterials(root);
    expect(a.material).not.toBe(shared);
    expect(a.material).toBe(b.material);
    for (const c of owned.clones.values()) setOpacity(c, bodyOpacity(1));
    expect((a.material as MeshBasicMaterial).opacity).toBeCloseTo(COVER_OPACITY);
    expect((a.material as MeshBasicMaterial).transparent).toBe(true);
    expect(shared.opacity).toBe(1);
    owned.restore();
    expect(a.material).toBe(shared);
    expect(b.material).toBe(shared);
    expect(shared.opacity).toBe(1);
    expect(shared.transparent).toBe(false);
  });
});

describe('strings', () => {
  it('has the same keys and placeholders in all six languages', () => {
    expect(tableProblems(INSIGHT_STRINGS)).toEqual([]);
  });
});
