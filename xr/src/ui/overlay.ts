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
import { onFontsReady } from '../look/type';

/** Fills by tone, from the look kit's palette (XR_DESIGN.md 9.3). */
export const TONE_COLOURS: Record<Tone, string> = { ...TONE_FILL };

/** The ring's colour by tone: the accent for a target, the state colours otherwise. */
const RING: Record<Tone, string> = { do: ACCENT, pass: STATE.good, fail: STATE.bad, warn: '#c98a00', info: STATE.info };

export function createOverlay(bench: BenchSpace, parent: Object3D): OverlayLayer & { dispose(): void } {
  const layer = new Group();
  layer.name = 'overlay';
  parent.add(layer);
  const items = new Set<{ item: OverlayItem; node: Group; callout?: Callout; offFonts?: () => void }>();
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

  // High enough that a label never covers the part it names, nor a lit LED's halo.
  const baseLift = (item: OverlayItem) => (item.style === 'glow' ? 0.05 : item.style === 'pin' ? 0.07 : 0.06);
  const place = (e: { item: OverlayItem; node: Group }) => {
    const p = bench.worldOf(e.item.target);
    e.node.visible = !!p;
    if (!p) return;
    const lift = e.item.style === 'glow' ? 0.002 : 0.001;
    layer.updateMatrixWorld(true);
    e.node.position.copy(layer.worldToLocal(new Vector3(p[0], p[1] + lift, p[2])));
  };
  /**
   * Callouts whose labels would overlap climb their leaders in turn, so no label covers another. Overlap is judged as
   * the person sees the bench, from above and in front (about 38 degrees down): a label nearer the person shows lower,
   * by its nearness times tan 38 (the flat view), so heights are compared after that shift.
   */
  const GAP = 0.016;
  const SEEN_FROM_ABOVE = Math.tan((38 * Math.PI) / 180);
  const LEAN = 0.3;
  const stack = () => {
    const placed: Array<{ x: number; w: number; bottom: number; top: number }> = [];
    for (const e of items) {
      if (!e.callout || !e.node.visible) continue;
      const c = e.callout;
      const x = e.node.position.x, y = e.node.position.y - e.node.position.z * SEEN_FROM_ABOVE;
      let bottom = y + baseLift(e.item);
      // A label leans back 0.3 rad (look/callout.ts): its top is lower but further away, which from above shows higher.
      const h = c.height * (Math.cos(LEAN) + Math.sin(LEAN) * SEEN_FROM_ABOVE);
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
      let offFonts: (() => void) | undefined;
      if (item.text) {
        callout = createCallout(item.text, { tone: item.tone, lift: baseLift(item) });
        node.add(callout.group);
        // The label grows or shrinks when the faces load (after its own redraw, registered first): stack again.
        offFonts = onFontsReady(stack);
      }
      layer.add(node);
      const entry = { item, node, callout, offFonts };
      items.add(entry);
      place(entry);
      stack();
      return () => {
        if (!items.delete(entry)) return;
        node.removeFromParent();
        offFonts?.();
        callout?.dispose();
      };
    },
    clear(owner) {
      for (const e of [...items]) {
        if (e.item.owner !== owner) continue;
        items.delete(e);
        e.node.removeFromParent();
        e.offFonts?.();
        e.callout?.dispose();
      }
    },
    dispose() {
      offLayout();
      layer.removeFromParent();
    },
  };
}
