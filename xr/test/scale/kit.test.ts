/** The scale kit: string tables, number formatting, own materials and opacity, preferences. */
import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, ShaderMaterial } from '@iwsdk/core';
import { fadeTree, ownMaterials, setOpacity } from '../../src/scale/kit/materials';
import { fadeMs, reducedMotion, setTeleport, teleportOn } from '../../src/scale/kit/prefs';
import { num, tableProblems, tr, type Strings } from '../../src/scale/kit/text';
import { createSettingsStore } from '../../src/shell/settings';

const GOOD = {
  en: { scale: 'Scale {x}x', room: 'Room size' },
  de: { scale: 'Maßstab {x}x', room: 'Raumgröße' },
  es: { scale: 'Escala {x}x', room: 'Tamaño sala' },
  fr: { scale: 'Échelle {x}x', room: 'Taille pièce' },
  hi: { scale: 'पैमाना {x}x', room: 'कमरे जितना' },
  zh: { scale: '比例 {x}x', room: '房间大小' },
} satisfies Strings<'scale' | 'room'>;

describe('string tables', () => {
  it('fill placeholders and fall back to English', () => {
    expect(tr(GOOD, 'de', 'scale', { x: 3 })).toBe('Maßstab 3x');
    const partial = { ...GOOD, fr: { scale: 'Échelle {x}x' } } as unknown as Strings<'scale' | 'room'>;
    expect(tr(partial, 'fr', 'room')).toBe('Room size');
    expect(tr(GOOD, 'en', 'scale')).toBe('Scale {x}x');
  });

  it('report missing keys, empty strings and placeholder drift', () => {
    expect(tableProblems(GOOD)).toEqual([]);
    const bad = { ...GOOD, hi: { scale: 'पैमाना', room: '' }, zh: { scale: '比例 {x}x', room: '房间', extra: 'x' } };
    expect(tableProblems(bad as never)).toEqual(['hi.scale: placeholders differ from en', 'hi.room: missing or empty', 'zh.extra: not in en']);
  });

  it('format numbers per language', () => {
    expect(num('en', 2.034)).toBe('2.03');
    expect(num('de', 2.034)).toBe('2,03');
    expect(num('fr', 14.6, 1)).toBe('14,6');
  });
});

describe('own materials', () => {
  it('clone shared materials per root and put them back', () => {
    const shared = new MeshStandardMaterial({ color: 0xff0000 });
    const geo = new BoxGeometry(1, 1, 1);
    const a = new Group();
    const b = new Group();
    const m1 = new Mesh(geo, shared);
    const m2 = new Mesh(geo, shared);
    const m3 = new Mesh(geo, shared);
    a.add(m1, m2);
    b.add(m3);
    const owned = ownMaterials(a);
    expect(m1.material).not.toBe(shared);
    expect(m1.material).toBe(m2.material);
    expect(m3.material).toBe(shared);
    fadeTree(a, 0.25);
    expect((m1.material as MeshStandardMaterial).opacity).toBe(0.25);
    expect(shared.opacity).toBe(1);
    expect(shared.transparent).toBe(false);
    // A second owner over the same meshes keeps the first owner's clones.
    const again = ownMaterials(a);
    expect(again.clones.size).toBe(0);
    owned.restore();
    owned.restore();
    expect(m1.material).toBe(shared);
  });

  it('fade a material and return it to how it was', () => {
    const m = new MeshStandardMaterial();
    const v0 = m.version;
    setOpacity(m, 0.4);
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBeCloseTo(0.4);
    expect(m.version).toBeGreaterThan(v0);
    setOpacity(m, 0.2);
    setOpacity(m, 1);
    expect(m.transparent).toBe(false);
    expect(m.opacity).toBe(1);
    const s = new ShaderMaterial({ uniforms: { opacity: { value: 1 } } });
    setOpacity(s, 0.5);
    expect(s.uniforms.opacity!.value).toBe(0.5);
  });
});

describe('preferences', () => {
  it('read reduced motion and teleport forward-compatibly', () => {
    const settings = createSettingsStore();
    const app = { settings };
    expect(reducedMotion(app)).toBe(false);
    expect(fadeMs(app, 400)).toBe(400);
    settings.setXr({ reducedMotion: true } as never);
    expect(reducedMotion(app)).toBe(true);
    expect(fadeMs(app, 400)).toBe(150);
    expect(teleportOn(app)).toBe(false);
    setTeleport(app, true);
    expect(teleportOn(app)).toBe(true);
  });
});
