/**
 * Invisible hit rectangles over a canvas-drawn panel: each region is a quad with an invisible material (no draw call),
 * bound once through `app.input.bind` for ray and poke, moved and resized when the panel redraws. A region that is not
 * in the current drawing stops taking pointers (`pointerEvents = 'none'`). Hover pulses 0.08 for 8 ms and a press 0.35
 * for 12 ms on a controller (design 4); hands get no haptics.
 *
 * Usage: const hits = createHits(app, parent, 'guide'); hits.set([{ id: 'next', x, y, w, h, onSelect }]);
 */
import { Mesh, MeshBasicMaterial, PlaneGeometry, type Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import type { InteractionEvent } from '../../contracts/input';

export interface HitRegion {
  readonly id: string;
  /** Panel-local metres: centre and size. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly disabled?: boolean;
  /** Fingertips may poke it (default true). */
  readonly poke?: boolean;
  onSelect?(e: InteractionEvent): void;
  /** Every event, for drags (select-start, drag-move, select-end) and hover. */
  onEvent?(e: InteractionEvent): void;
}

export interface Hits {
  set(regions: readonly HitRegion[]): void;
  /** Ids of regions a pointer hovers now, with the pointer ids. */
  readonly hovered: ReadonlyMap<number, string>;
  readonly pressed: ReadonlyMap<number, string>;
  /** Called when hover or press changes. */
  onChange(fn: () => void): Unsubscribe;
  dispose(): void;
}

/** In front of the plate so rays and fingertips meet the hit before the drawing. */
const HIT_Z = 0.0008;

export function createHits(app: Pick<XrApp, 'input'>, parent: Object3D, prefix: string): Hits {
  const geometry = new PlaneGeometry(1, 1);
  const material = new MeshBasicMaterial({ visible: false });
  const meshes = new Map<string, { mesh: Mesh; off: Unsubscribe; region: HitRegion }>();
  const hovered = new Map<number, string>();
  const pressed = new Map<number, string>();
  const fns = new Set<() => void>();
  const changed = () => fns.forEach((fn) => fn());

  const handler = (id: string) => (e: InteractionEvent) => {
    const entry = meshes.get(id);
    if (!entry) return;
    const r = entry.region;
    const hand = e.pointer.hand;
    switch (e.type) {
      case 'hover-start':
        hovered.set(e.pointer.id, id);
        if (hand && !r.disabled) app.input.pulse(hand, 0.08, 8);
        changed();
        break;
      case 'hover-end':
        hovered.delete(e.pointer.id);
        pressed.delete(e.pointer.id);
        changed();
        break;
      case 'select-start':
        if (!r.disabled) {
          pressed.set(e.pointer.id, id);
          changed();
        }
        break;
      case 'select-end':
        if (pressed.delete(e.pointer.id)) changed();
        break;
      case 'select':
        if (r.disabled) break;
        if (hand) app.input.pulse(hand, 0.35, 12);
        r.onSelect?.(e);
        break;
      default:
        break;
    }
    if (!r.disabled) r.onEvent?.(e);
  };

  return {
    hovered,
    pressed,
    set(regions) {
      const seen = new Set<string>();
      for (const r of regions) {
        seen.add(r.id);
        let entry = meshes.get(r.id);
        if (!entry) {
          const mesh = new Mesh(geometry, material);
          mesh.name = `${prefix}:${r.id}`;
          parent.add(mesh);
          const off = app.input.bind(mesh, { id: `${prefix}:${r.id}`, ray: true, poke: r.poke ?? true }, handler(r.id));
          entry = { mesh, off, region: r };
          meshes.set(r.id, entry);
        }
        entry.region = r;
        entry.mesh.position.set(r.x, r.y, HIT_Z);
        entry.mesh.scale.set(Math.max(1e-4, r.w), Math.max(1e-4, r.h), 1);
        entry.mesh.visible = true;
        (entry.mesh as unknown as { pointerEvents: string }).pointerEvents = 'auto';
      }
      for (const [id, entry] of meshes) {
        if (seen.has(id)) continue;
        (entry.mesh as unknown as { pointerEvents: string }).pointerEvents = 'none';
        entry.mesh.visible = false;
        for (const [p, h] of hovered) if (h === id) hovered.delete(p);
        for (const [p, h] of pressed) if (h === id) pressed.delete(p);
      }
    },
    onChange(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    dispose() {
      for (const { mesh, off } of meshes.values()) {
        off();
        mesh.removeFromParent();
      }
      meshes.clear();
      geometry.dispose();
      material.dispose();
      fns.clear();
    },
  };
}
