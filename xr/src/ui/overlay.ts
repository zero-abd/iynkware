/**
 * The overlay layer: labels and pinned notes on bench targets, one layer for every owner. Contract: contracts/overlay.ts.
 * Drawn as the figures draw them (look kit, `xr/src/look/callout.ts`): `pin` and `label` are a callout (an ink dot on
 * the target, an ink leader, a cream tag or a paper card sized in dmm), `glow` an ink ring around a tone ring flat on
 * the target. Positions follow the bench layout.
 */
import { Group, Mesh, MeshBasicMaterial, RingGeometry, Vector3, type Object3D } from '@iwsdk/core';
import type { Unsubscribe } from '../contracts/common';
import type { Tone } from '../contracts/lesson';
import type { OverlayItem, OverlayLayer } from '../contracts/overlay';
import type { BenchSpace } from '../contracts/space';
import { createCallout, type Callout } from '../look/callout';
import { ACCENT, hexNum, INK, STATE, TONE_FILL } from '../look/palette';

/** Fills by tone, from the look kit's palette (XR_DESIGN.md 9.3). */
export const TONE_COLOURS: Record<Tone, string> = { ...TONE_FILL };

/** The ring's colour by tone: the accent for a target, the state colours otherwise. */
const RING: Record<Tone, string> = { do: ACCENT, pass: STATE.good, fail: STATE.bad, warn: '#c98a00', info: STATE.info };

export function createOverlay(bench: BenchSpace, parent: Object3D): OverlayLayer & { dispose(): void } {
  const layer = new Group();
  layer.name = 'overlay';
  parent.add(layer);
  const items = new Set<{ item: OverlayItem; node: Group; callout?: Callout }>();
  const ring = new RingGeometry(0.0085, 0.0115, 40);
  const rim = new RingGeometry(0.0115, 0.0132, 40);
  const inkMat = new MeshBasicMaterial({ color: hexNum(INK), toneMapped: false });
  const toneMats = new Map<Tone, MeshBasicMaterial>();
  const toneMat = (t: Tone) => {
    let m = toneMats.get(t);
    if (!m) {
      m = new MeshBasicMaterial({ color: hexNum(RING[t]), toneMapped: false });
      toneMats.set(t, m);
    }
    return m;
  };

  const baseLift = (item: OverlayItem) => (item.style === 'glow' ? 0.035 : item.style === 'pin' ? 0.06 : 0.04);
  const place = (e: { item: OverlayItem; node: Group }) => {
    const p = bench.worldOf(e.item.target);
    e.node.visible = !!p;
    if (!p) return;
    const lift = e.item.style === 'glow' ? 0.002 : 0.001;
    layer.updateMatrixWorld(true);
    e.node.position.copy(layer.worldToLocal(new Vector3(p[0], p[1] + lift, p[2])));
  };
  /** Callouts whose labels would overlap climb their leaders in turn, so no label covers another. */
  const GAP = 0.016;
  const stack = () => {
    const placed: Array<{ x: number; w: number; bottom: number; top: number }> = [];
    for (const e of items) {
      if (!e.callout || !e.node.visible) continue;
      const c = e.callout;
      const x = e.node.position.x, y = e.node.position.y;
      let bottom = y + baseLift(e.item);
      // labels lean back a little, so their vertical extent is a bit less than their height
      const h = c.height * 0.96;
      for (let moved = true; moved; ) {
        moved = false;
        for (const q of placed) {
          const sideBySide = Math.abs(q.x - x) > (q.w + c.width) / 2;
          if (sideBySide || bottom >= q.top + GAP || bottom + h <= q.bottom - GAP) continue;
          bottom = q.top + GAP;
          moved = true;
        }
      }
      c.setLift(bottom - y);
      placed.push({ x, w: c.width, bottom, top: bottom + h });
    }
  };
  const offLayout = bench.onLayout(() => {
    items.forEach(place);
    stack();
  });

  return {
    show(item): Unsubscribe {
      const node = new Group();
      let callout: Callout | undefined;
      if (item.style === 'glow') {
        const a = new Mesh(ring, toneMat(item.tone));
        const b = new Mesh(rim, inkMat);
        a.rotation.x = b.rotation.x = -Math.PI / 2;
        node.add(a, b);
      }
      if (item.text) {
        callout = createCallout(item.text, { tone: item.tone, lift: baseLift(item) });
        node.add(callout.group);
      }
      layer.add(node);
      const entry = { item, node, callout };
      items.add(entry);
      place(entry);
      stack();
      return () => {
        if (!items.delete(entry)) return;
        node.removeFromParent();
        callout?.dispose();
      };
    },
    clear(owner) {
      for (const e of [...items]) {
        if (e.item.owner !== owner) continue;
        items.delete(e);
        e.node.removeFromParent();
        e.callout?.dispose();
      }
    },
    dispose() {
      offLayout();
      layer.removeFromParent();
    },
  };
}
