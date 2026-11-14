/**
 * The overlay layer: labels and pinned notes on bench targets, one layer for every owner. Contract: contracts/overlay.ts.
 * Skeleton: `pin` and `label` draw a text tag above the target, `glow` a small ring; positions follow the bench layout.
 */
import { Group, Mesh, MeshBasicMaterial, RingGeometry, Vector3, type Object3D } from "@iwsdk/core";
import type { Unsubscribe } from '../contracts/common';
import type { Tone } from '../contracts/lesson';
import type { OverlayItem, OverlayLayer } from '../contracts/overlay';
import type { BenchSpace } from '../contracts/space';
import { textLabel, type TextLabel } from './text';

export const TONE_COLOURS: Record<Tone, string> = { info: '#f2efe7', do: '#ffd23f', warn: '#f28c28', pass: '#7ccf6b', fail: '#e8695a' };

export function createOverlay(bench: BenchSpace, parent: Object3D): OverlayLayer & { dispose(): void } {
  const layer = new Group();
  layer.name = 'overlay';
  parent.add(layer);
  const items = new Set<{ item: OverlayItem; node: Group; label?: TextLabel }>();
  const ring = new RingGeometry(0.008, 0.011, 24);

  const place = (e: { item: OverlayItem; node: Group }) => {
    const p = bench.worldOf(e.item.target);
    e.node.visible = !!p;
    if (!p) return;
    const lift = e.item.style === 'glow' ? 0.002 : 0.05;
    layer.updateMatrixWorld(true);
    e.node.position.copy(layer.worldToLocal(new Vector3(p[0], p[1] + lift, p[2])));
  };
  const offLayout = bench.onLayout(() => items.forEach(place));

  return {
    show(item): Unsubscribe {
      const node = new Group();
      let label: TextLabel | undefined;
      if (item.style === 'glow') {
        const m = new Mesh(ring, new MeshBasicMaterial({ color: TONE_COLOURS[item.tone], transparent: true, opacity: 0.9 }));
        m.rotation.x = -Math.PI / 2;
        node.add(m);
      }
      if (item.text) {
        label = textLabel(0.16, 0.03, { bg: TONE_COLOURS[item.tone] });
        label.set(item.text);
        node.add(label.mesh);
      }
      layer.add(node);
      const entry = { item, node, label };
      items.add(entry);
      place(entry);
      return () => {
        if (!items.delete(entry)) return;
        node.removeFromParent();
        label?.dispose();
      };
    },
    clear(owner) {
      for (const e of [...items]) {
        if (e.item.owner !== owner) continue;
        items.delete(e);
        e.node.removeFromParent();
        e.label?.dispose();
      }
    },
    dispose() {
      offLayout();
      layer.removeFromParent();
    },
  };
}
