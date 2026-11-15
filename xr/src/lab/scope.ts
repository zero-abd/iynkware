/**
 * Each workbench shows only its own things. The circuit bench's furniture (the parts shelf, the run cluster, the
 * scale and undo rail, the multimeter and scope on the tools rack, the code panel, the lesson guide and its
 * highlights, the co-builder's card, the bench overlay, the shelf's shadow; a lab's own things are all under named
 * `lab…` groups) belongs to the circuit bench; while a lab is laid out it is
 * hidden and takes no pointers, and it comes back exactly as it was when the lab is left.
 *
 * The owners keep drawing and toggling their own objects: while hidden, an object's `visible` is held at false and
 * what its owner sets is remembered and restored afterwards. Objects that appear later (a panel opened while in a lab)
 * are picked up by a rescan twice a second. Matching is by the objects' names, so no owner needs to change.
 */
import type { Object3D } from '@iwsdk/core';

type PointerEvents = 'none' | 'auto' | 'listener';
type Pointerish = Object3D & { pointerEvents?: PointerEvents };

/** Names of the circuit bench's own objects (direct children of the bench table or the scene). */
export const CIRCUIT_ONLY = /^(bench:(shelf|grip-place|rail)|run[-:]|guide:|assistant:card|scale:(rail|panel)|overlay$|mesh\.shadow$|shell-panel:run\/|panel-grip-root:shell\/run\/)/;

export interface BenchScope {
  /** Hides (true) or restores (false) the circuit bench's objects under `roots`. */
  set(hidden: boolean): void;
  /** Picks up objects that appeared since; call now and then while hidden. */
  rescan(): void;
  readonly hidden: boolean;
}

export function createBenchScope(roots: () => readonly Object3D[]): BenchScope {
  /** Hidden objects: what their owner last set `visible` to, and each descendant's pointer setting. */
  const held = new Map<Object3D, { wants: boolean; pointers: Map<Pointerish, PointerEvents | undefined> }>();
  let hidden = false;

  const hold = (o: Object3D) => {
    if (held.has(o)) return;
    const pointers = new Map<Pointerish, PointerEvents | undefined>();
    o.traverse((c) => {
      const p = c as Pointerish;
      pointers.set(p, p.pointerEvents);
      p.pointerEvents = 'none';
    });
    const entry = { wants: o.visible, pointers };
    held.set(o, entry);
    Object.defineProperty(o, 'visible', {
      configurable: true,
      get: () => false,
      set: (v: boolean) => {
        entry.wants = v;
      },
    });
  };
  const release = (o: Object3D) => {
    const entry = held.get(o);
    if (!entry) return;
    delete (o as { visible?: boolean }).visible;
    o.visible = entry.wants;
    for (const [p, v] of entry.pointers) p.pointerEvents = v;
    held.delete(o);
  };
  const scan = () => {
    for (const root of roots()) for (const c of root.children) if (c.name && CIRCUIT_ONLY.test(c.name)) hold(c);
  };

  return {
    set(h) {
      if (h === hidden) return;
      hidden = h;
      if (h) scan();
      else for (const o of [...held.keys()]) release(o);
    },
    rescan() {
      if (hidden) scan();
    },
    get hidden() {
      return hidden;
    },
  };
}
