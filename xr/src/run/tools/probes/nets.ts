/**
 * From a clipped anchor to a net of the run, and from two nets to the part between them. Pure: the document, the
 * run's netlist and nothing else, so it is tested in node.
 *
 * A pin names its net in the netlist (`parts[].pins`). A breadboard hole does not: the netlist leaves the surface
 * out, so a hole is joined through its strip to the legs seated in the strip and the wires that end in it (the
 * document's breadboard view), and the net is the one those pins are on.
 */
import type { Project } from '@/project/generated/types';
import { holeToPin, stripOfHole, type SurfaceKind } from '@/project/holes';
import type { SimNetlist } from '../../../contracts/sim';

/** What a probe is clipped on: a pin of a part, or a hole of a surface (`part` is the surface's id then). */
export interface ClipTarget {
  readonly kind: 'pin' | 'hole';
  readonly part: string;
  readonly id: string;
}

export const sameTarget = (a: ClipTarget | null, b: ClipTarget | null): boolean =>
  a === b || (!!a && !!b && a.kind === b.kind && a.part === b.part && a.id === b.id);

class Joins {
  private readonly parent = new Map<string, string>();
  find(key: string): string {
    let root = this.parent.get(key) ?? key;
    if (!this.parent.has(key)) this.parent.set(key, key);
    while (root !== (this.parent.get(root) ?? root)) root = this.parent.get(root)!;
    // Path compression.
    for (let k = key; k !== root; ) {
      const next = this.parent.get(k) ?? root;
      this.parent.set(k, root);
      k = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
  keys(): IterableIterator<string> {
    return this.parent.keys();
  }
}

const pinKey = (c: string, p: string) => `P:${c}/${p}`;
const stripKey = (surface: string, strip: string) => `S:${surface}/${strip}`;

const kindOfRef = (ref: string): SurfaceKind => (ref.endsWith('full') ? 'full' : ref.endsWith('mini') ? 'mini' : 'half');

/** The nets of a document's holes and pins, built once per (document, netlist) and then looked up. */
export interface NetIndex {
  /** The netlist net a target is on, or null: a hole nothing is seated in or wired to, a pin the run does not wire. */
  netOf(target: ClipTarget): string | null;
  /** A part (not a board or a surface) with a pin on both nets: what an ammeter reads through. First by id. */
  elementBetween(a: string, b: string): string | null;
}

export function netIndex(doc: Project, nl: SimNetlist): NetIndex {
  const pinNet = new Map<string, string>();
  const partNets = new Map<string, Set<string>>();
  for (const part of nl.parts) {
    const set = new Set<string>();
    for (const [pin, net] of Object.entries(part.pins)) {
      if (net === null) continue;
      pinNet.set(pinKey(part.id, pin), net);
      set.add(net);
    }
    if (part.kind !== 'board') partNets.set(part.id, set);
  }

  const stripsOf = new Map<string, Map<string, string>>();
  const refOf = new Map<string, string>();
  for (const inst of [...doc.boards, ...doc.components]) refOf.set(inst.id, inst.definition.ref);
  const interfaces = new Map<string, Project['dependencies']['components'][number]['interface']>();
  for (const dep of doc.dependencies.components) interfaces.set(`${dep.ref}@${dep.version}`, dep.interface);
  for (const inst of doc.components) {
    const iface = interfaces.get(`${inst.definition.ref}@${inst.definition.version}`);
    if (iface?.role === 'surface') stripsOf.set(inst.id, stripOfHole(iface));
  }
  const holeKey = (surface: string, hole: string): string | null => {
    const strips = stripsOf.get(surface);
    if (!strips) return null;
    const strip = strips.get(hole) ?? strips.get(holeToPin(kindOfRef(refOf.get(surface) ?? ''), hole) ?? '');
    return strip === undefined ? null : stripKey(surface, strip);
  };

  const joins = new Joins();
  for (const view of doc.views) {
    for (const placement of view.placements) {
      if (!placement.legs || !view.surface) continue;
      for (const [pin, hole] of Object.entries(placement.legs)) {
        const strip = typeof hole === 'string' ? holeKey(view.surface, hole) : null;
        if (strip) joins.union(pinKey(placement.c, pin), strip);
      }
    }
    for (const wire of view.wires) {
      const ends = [wire.from, wire.to].map((end) => {
        if (end.kind === 'pin') return pinKey(end.c, end.p);
        if (end.kind === 'hole') return holeKey(end.surface, end.hole);
        return `J:${end.id}`;
      });
      if (ends[0] && ends[1]) joins.union(ends[0], ends[1]);
    }
  }

  // One net per joined set: the net of its first pin the run wires.
  const netOfRoot = new Map<string, string>();
  for (const key of [...joins.keys()].sort()) {
    if (!key.startsWith('P:')) continue;
    const net = pinNet.get(key);
    const root = joins.find(key);
    if (net !== undefined && !netOfRoot.has(root)) netOfRoot.set(root, net);
  }

  return {
    netOf(target) {
      if (target.kind === 'pin') return pinNet.get(pinKey(target.part, target.id)) ?? null;
      const strip = holeKey(target.part, target.id);
      return strip === null ? null : (netOfRoot.get(joins.find(strip)) ?? null);
    },
    elementBetween(a, b) {
      if (a === b) return null;
      let best: string | null = null;
      for (const [id, nets] of partNets) if (nets.has(a) && nets.has(b) && (best === null || id < best)) best = id;
      return best;
    },
  };
}
