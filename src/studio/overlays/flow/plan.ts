import type { Component, Project, Wire, WireEnd } from "../../../project/generated/types.ts";
import { netlist } from "../../../project/netlist.ts";
import type { PartRegistry } from "../../../parts/registry.ts";
import { buildSchematicScene } from "../../views/schematic.ts";

const JOINING = new Set(["strip", "internal-short", "plane"]);

/** An edge a flow can be drawn along: a wire of the breadboard or a link of the schematic. Its current is positive from `from` to `to`. */
export interface FlowEdge {
  /** The id of the draw item that shows it. */
  id: string;
  /** The netlist node it belongs to. */
  node: string;
  from: number;
  to: number;
}

/**
 * How current can spread over a view. A circuit view is a graph: pins, holes and junctions are vertices, wires are
 * edges, and a seated leg or a breadboard strip joins vertices without an edge you could draw on. Real wire currents
 * in a loop of ideal conductors are not unique, so one spanning tree is chosen once and each wire carries what the
 * pins beyond it inject. A wire that is the only way between two parts gets the true current.
 */
export interface FlowPlan {
  edges: readonly FlowEdge[];
  /** The index of an edge by id. */
  edgeOf: ReadonlyMap<string, number>;
  /** The vertex of a part pin, by `part/pin`. */
  pinVertex: ReadonlyMap<string, number>;
  vertexCount: number;
  /** Vertices leaves first; each has the vertex and the edge that lead towards its root, or -1 at a root. */
  order: Int32Array;
  parent: Int32Array;
  parentEdge: Int32Array;
}

type Link = { to: number; edge: number };

class Graph {
  readonly ids = new Map<string, number>();
  readonly links: Link[][] = [];
  readonly edges: FlowEdge[] = [];

  vertex(key: string): number {
    let v = this.ids.get(key);
    if (v === undefined) {
      v = this.ids.size;
      this.ids.set(key, v);
      this.links.push([]);
    }
    return v;
  }

  join(a: number, b: number, edge: number): void {
    this.links[a]!.push({ to: b, edge });
    this.links[b]!.push({ to: a, edge });
  }

  drawn(id: string, node: string, a: number, b: number): void {
    this.edges.push({ id, node, from: a, to: b });
    this.join(a, b, this.edges.length - 1);
  }

  plan(): FlowPlan {
    const n = this.links.length;
    const parent = new Int32Array(n).fill(-1);
    const parentEdge = new Int32Array(n).fill(-1);
    const seen = new Uint8Array(n);
    const bfs: number[] = [];
    for (let root = 0; root < n; root++) {
      if (seen[root]) continue;
      seen[root] = 1;
      const start = bfs.length;
      bfs.push(root);
      for (let i = start; i < bfs.length; i++) {
        const v = bfs[i]!;
        for (const { to, edge } of this.links[v]!) {
          if (seen[to]) continue;
          seen[to] = 1;
          parent[to] = v;
          parentEdge[to] = edge;
          bfs.push(to);
        }
      }
    }
    return {
      edges: this.edges,
      edgeOf: new Map(this.edges.map((e, i) => [e.id, i])),
      pinVertex: new Map([...this.ids].flatMap(([key, v]) => (key.startsWith("p:") ? [[key.slice(2), v] as const] : []))),
      vertexCount: n,
      order: Int32Array.from(bfs.reverse()),
      parent,
      parentEdge,
    };
  }
}

const NO_EDGE = -1;

function endKey(end: WireEnd): string {
  if (end.kind === "pin") return `p:${end.c}/${end.p}`;
  if (end.kind === "hole") return `h:${end.surface}/${end.hole}`;
  return `j:${end.id}`;
}

function nodeOfNet(state: Project): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of netlist(state).nodes) for (const net of node.nets) map.set(net, node.id);
  return map;
}

function wireEdge(graph: Graph, wire: Wire, nodes: ReadonlyMap<string, string>): void {
  const node = nodes.get(wire.net);
  if (node !== undefined) graph.drawn(wire.id, node, graph.vertex(endKey(wire.from)), graph.vertex(endKey(wire.to)));
}

/** Strips, planes and the pins a part shorts inside itself: every member that already is a vertex hangs off one hub. */
function joinGroups(graph: Graph, instances: readonly Component[], state: Project): void {
  const interfaces = new Map(state.dependencies.components.map((dep) => [`${dep.ref}@${dep.version}`, dep.interface]));
  for (const inst of instances) {
    const iface = interfaces.get(`${inst.definition.ref}@${inst.definition.version}`);
    if (!iface) continue;
    const prefix = iface.role === "surface" ? "h" : "p";
    for (const group of iface.groups ?? []) {
      if (!JOINING.has(group.kind)) continue;
      const members = group.pins.flatMap((pin) => graph.ids.get(`${prefix}:${inst.id}/${pin}`) ?? []);
      if (members.length < 2) continue;
      const hub = graph.vertex(`g:${inst.id}/${group.id}`);
      for (const m of members) graph.join(hub, m, NO_EDGE);
    }
  }
}

/** The plan of a breadboard view: its wires, with legs and strips as joins. Null when the view is not in the document. */
export function breadboardPlan(state: Project, viewId: string): FlowPlan | null {
  const view = state.views.find((v) => v.id === viewId);
  if (!view) return null;
  const graph = new Graph();
  const nodes = nodeOfNet(state);
  for (const wire of view.wires) wireEdge(graph, wire, nodes);
  for (const placement of view.placements) {
    for (const [leg, hole] of Object.entries(placement.legs ?? {})) {
      if (hole === undefined || view.surface === undefined) continue;
      graph.join(graph.vertex(`p:${placement.c}/${leg}`), graph.vertex(`h:${view.surface}/${hole}`), NO_EDGE);
    }
  }
  joinGroups(graph, [...state.boards, ...state.components], state);
  return graph.plan();
}

/** The plan of a schematic view: each link joins the pins it reaches, and a stub leads from its pin to a free end. */
export function schematicPlan(state: Project, viewId: string, reg: PartRegistry): FlowPlan | null {
  if (!state.views.some((v) => v.id === viewId)) return null;
  const graph = new Graph();
  const pinOf = new Map(Object.keys(netlist(state).pinNode).map((key) => [key.replace("/", "."), key]));
  buildSchematicScene(state, viewId, reg).links.forEach((link, i) => {
    const id = `${link.net}#${i}`;
    const pins = link.pins.flatMap((p) => pinOf.get(p) ?? []);
    if (pins.length !== link.pins.length) return;
    const a = graph.vertex(`p:${pins[0]}`);
    graph.drawn(id, link.net, a, pins.length > 1 ? graph.vertex(`p:${pins[1]}`) : graph.vertex(`s:${i}`));
  });
  return graph.plan();
}

/**
 * The current along each edge, from its `from` to its `to`, for the pin currents of a frame (positive into the part).
 * A pin that is not in the plan is ignored, and so is whatever the pins do not balance.
 */
export function edgeCurrents(plan: FlowPlan, pinAmps: Readonly<Record<string, Readonly<Record<string, number>>>>): Float64Array {
  const sub = new Float64Array(plan.vertexCount);
  for (const [part, pins] of Object.entries(pinAmps)) {
    for (const [pin, amps] of Object.entries(pins)) {
      const v = plan.pinVertex.get(`${part}/${pin}`);
      if (v !== undefined) sub[v]! -= amps;
    }
  }
  const out = new Float64Array(plan.edges.length);
  for (const v of plan.order) {
    const p = plan.parent[v]!;
    if (p < 0) continue;
    const edge = plan.parentEdge[v]!;
    if (edge !== NO_EDGE) out[edge] = plan.edges[edge]!.from === v ? sub[v]! : -sub[v]!;
    sub[p]! += sub[v]!;
  }
  return out;
}
