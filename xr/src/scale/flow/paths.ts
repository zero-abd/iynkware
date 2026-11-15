/**
 * Where current can be drawn: iynk's flow plan (`breadboardPlan`) laid on the bench. Each plan edge is a wire, drawn
 * along `BenchSpace.wirePath`; each join (a leg in a hole, a breadboard strip) is a short segment between the places its
 * two ends are; the inside of a two pin part is a straight segment from one pin to the other. Built when the layout or
 * the project changes, never per frame. Pure: the bench is reached through `PathEnv`.
 */
import type { Project } from '@/project/generated/types';
import { netlist } from '@/project/netlist';
import { breadboardPlan, edgeCurrents, type FlowPlan } from '@/studio/overlays/flow/plan';
import type { AnalogView } from '../kit/analog';
import type { Vec3 } from '../../contracts/common';

export interface PathEnv {
  /** A wire's drawn path in the board frame, or null when it is not on the bench. */
  wirePath(wire: string): readonly Vec3[] | null;
  /** A part pin's board frame point, or null. */
  pinAt(part: string, pin: string): Vec3 | null;
}

export type SegKind = 'wire' | 'join' | 'part';

export interface Seg {
  readonly kind: SegKind;
  readonly id: string;
  /** Points, xyz each. */
  readonly pts: Float32Array;
  /** Distance along the path at each point (cum[0] = 0). */
  readonly cum: Float32Array;
  readonly length: number;
  /** Plan edge (wire), or the vertex that leads to its parent (join), or -1. */
  readonly edge: number;
  readonly vertex: number;
  /** For a part: its id and the pin whose current enters it first. */
  readonly part: string;
  readonly first: string;
  /** Netlist nodes at the start and the end of the path, whose voltages colour the dots. */
  readonly nodeA: string | undefined;
  readonly nodeB: string | undefined;
}

export interface NodeSpot {
  readonly node: string;
  readonly name: string;
  readonly at: Vec3;
}

export interface Topology {
  readonly plan: FlowPlan;
  readonly segs: readonly Seg[];
  readonly spots: readonly NodeSpot[];
  /** The board's near edge, centre: where the "conventional current" chip hangs. */
  readonly chip: Vec3;
}

const MIN_SEG = 0.0002;

function seg(
  kind: SegKind,
  id: string,
  path: readonly Vec3[],
  extra: Partial<Pick<Seg, 'edge' | 'vertex' | 'part' | 'first' | 'nodeA' | 'nodeB'>>,
): Seg | null {
  if (path.length < 2) return null;
  const pts = new Float32Array(path.length * 3);
  const cum = new Float32Array(path.length);
  let len = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    pts[i * 3] = p[0];
    pts[i * 3 + 1] = p[1];
    pts[i * 3 + 2] = p[2];
    if (i > 0) {
      const q = path[i - 1]!;
      len += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    }
    cum[i] = len;
  }
  if (len < MIN_SEG) return null;
  return { kind, id, pts, cum, length: len, edge: -1, vertex: -1, part: '', first: '', nodeA: undefined, nodeB: undefined, ...extra };
}

/** The point halfway along a path. */
export function midpoint(path: readonly Vec3[]): Vec3 {
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const half = cum[cum.length - 1]! / 2;
  for (let i = 1; i < path.length; i++) {
    if (cum[i]! >= half) {
      const t = cum[i]! > cum[i - 1]! ? (half - cum[i - 1]!) / (cum[i]! - cum[i - 1]!) : 0;
      const a = path[i - 1]!;
      const b = path[i]!;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  return path[0] ?? [0, 0, 0];
}

const splitKey = (key: string): [string, string] => {
  const i = key.indexOf('/');
  return [key.slice(0, i), key.slice(i + 1)];
};

/** The topology of the bench view `viewId`, or null when the document has no such view. */
export function buildTopology(doc: Project, viewId: string, env: PathEnv): Topology | null {
  const plan = breadboardPlan(doc, viewId);
  if (!plan) return null;
  const view = doc.views.find((v) => v.id === viewId)!;
  const net = netlist(doc);
  const n = plan.vertexCount;
  const pos = new Float64Array(n * 3);
  const known = new Uint8Array(n);
  const node: (string | undefined)[] = new Array<string | undefined>(n).fill(undefined);
  const setPos = (v: number, p: Vec3) => {
    pos[v * 3] = p[0];
    pos[v * 3 + 1] = p[1];
    pos[v * 3 + 2] = p[2];
    known[v] = 1;
  };

  // Known places: pin vertices and the two ends of each drawn wire.
  const pinsOfPart = new Map<string, string[]>();
  for (const [key, v] of plan.pinVertex) {
    const [part, pin] = splitKey(key);
    const at = env.pinAt(part, pin);
    if (at) setPos(v, at);
    node[v] = net.pinNode[key];
    const list = pinsOfPart.get(part) ?? [];
    list.push(pin);
    pinsOfPart.set(part, list);
  }
  const wirePaths: (readonly Vec3[] | null)[] = plan.edges.map((e) => env.wirePath(e.id));
  plan.edges.forEach((e, i) => {
    const path = wirePaths[i];
    if (path && path.length >= 2) {
      if (!known[e.from]) setPos(e.from, path[0]!);
      if (!known[e.to]) setPos(e.to, path[path.length - 1]!);
    }
    node[e.from] ??= e.node;
    node[e.to] ??= e.node;
  });
  // The rest (holes without a wire, strip hubs) sit at the mean of the neighbours that are placed.
  const links: number[][] = Array.from({ length: n }, () => []);
  for (let v = 0; v < n; v++) {
    const p = plan.parent[v]!;
    if (p >= 0) {
      links[v]!.push(p);
      links[p]!.push(v);
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let v = 0; v < n; v++) {
      if (known[v]) {
        if (node[v] === undefined) for (const w of links[v]!) if (node[w] !== undefined) node[v] = node[w];
        continue;
      }
      let k = 0;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const w of links[v]!) {
        if (!known[w]) continue;
        k++;
        x += pos[w * 3]!;
        y += pos[w * 3 + 1]!;
        z += pos[w * 3 + 2]!;
        node[v] ??= node[w];
      }
      if (k > 0) {
        setPos(v, [x / k, y / k, z / k]);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const at = (v: number): Vec3 => [pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!];

  const segs: Seg[] = [];
  plan.edges.forEach((e, i) => {
    const path = wirePaths[i];
    const s = path && seg('wire', e.id, path, { edge: i, nodeA: e.node, nodeB: e.node });
    if (s) segs.push(s);
  });
  for (let v = 0; v < n; v++) {
    const p = plan.parent[v]!;
    if (p < 0 || plan.parentEdge[v] !== -1 || !known[v] || !known[p]) continue;
    const s = seg('join', `join:${v}`, [at(v), at(p)], { vertex: v, nodeA: node[v], nodeB: node[p] });
    if (s) segs.push(s);
  }
  const boards = new Set(doc.boards.map((b) => b.id));
  for (const [part, pins] of pinsOfPart) {
    if (boards.has(part) || pins.length !== 2) continue;
    pins.sort();
    const a = plan.pinVertex.get(`${part}/${pins[0]}`)!;
    const b = plan.pinVertex.get(`${part}/${pins[1]}`)!;
    if (!known[a] || !known[b]) continue;
    const s = seg('part', `part:${part}`, [at(a), at(b)], { part, first: pins[0]!, nodeA: node[a], nodeB: node[b] });
    if (s) segs.push(s);
  }

  // One spot per node: the middle of its first drawn wire, else its first placed pin.
  const refdes = new Map([...doc.boards, ...doc.components].map((c) => [c.id, c.refdes ?? c.id] as const));
  const spots: NodeSpot[] = [];
  const wireOf = new Map<string, readonly Vec3[]>();
  plan.edges.forEach((e, i) => {
    const path = wirePaths[i];
    if (path && path.length >= 2 && !wireOf.has(e.node)) wireOf.set(e.node, path);
  });
  for (const nd of net.nodes) {
    let spot: Vec3 | undefined;
    const wp = wireOf.get(nd.id);
    if (wp) spot = midpoint(wp);
    else
      for (const pin of nd.pins) {
        const v = plan.pinVertex.get(`${pin.c}/${pin.p}`);
        if (v !== undefined && known[v]) {
          spot = at(v);
          break;
        }
      }
    if (!spot) continue;
    const first = nd.pins[0];
    spots.push({ node: nd.id, name: nd.names[0] ?? (first ? `${refdes.get(first.c) ?? first.c}.${first.p}` : nd.id), at: spot });
  }

  // The chip hangs at the near edge of everything drawn.
  let minX = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const s of segs) {
    for (let i = 0; i < s.pts.length; i += 3) {
      minX = Math.min(minX, s.pts[i]!);
      maxX = Math.max(maxX, s.pts[i]!);
      maxZ = Math.max(maxZ, s.pts[i + 2]!);
    }
  }
  const chip: Vec3 = Number.isFinite(minX) ? [(minX + maxX) / 2, 0.01, maxZ + 0.02] : [0, 0.01, 0];
  return { plan, segs, spots, chip };
}

/**
 * The signed current along each segment's path (positive from its first point to its last), into `out`, which has
 * `topo.segs.length` entries. Wires use iynk's `edgeCurrents`; joins and parts read the same tree.
 */
export function segmentAmps(topo: Topology, view: AnalogView, out: Float64Array): void {
  const { plan, segs } = topo;
  const wire = edgeCurrents(plan, view.pinAmps);
  // The current leaving each vertex toward its parent (the same sums `edgeCurrents` makes).
  const sub = new Float64Array(plan.vertexCount);
  for (const [part, pins] of Object.entries(view.pinAmps)) {
    for (const [pin, amps] of Object.entries(pins)) {
      const v = plan.pinVertex.get(`${part}/${pin}`);
      if (v !== undefined) sub[v]! -= amps;
    }
  }
  for (const v of plan.order) {
    const p = plan.parent[v]!;
    if (p >= 0) sub[p]! += sub[v]!;
  }
  // `order` is leaves first, so after the loop sub[v] holds the whole subtree: current from v to its parent.
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (s.kind === 'wire') out[i] = wire[s.edge]!;
    else if (s.kind === 'join') out[i] = sub[s.vertex]!;
    else out[i] = view.pinAmps[s.part]?.[s.first] ?? 0;
  }
}
