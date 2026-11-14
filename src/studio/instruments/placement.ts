import { newId } from "../../core/ids.ts";
import { netlist, probedPins } from "../../project/netlist.ts";
import type { Instrument, Op, PinRef, Project } from "../../project/generated/types.ts";
import type { ToleranceMode } from "../../sim/analog/tolerance.ts";

export interface ProbePoint {
  id: string;
  label: string;
  /** The reference designator of the part a pin belongs to; null for a net. */
  part: string | null;
  target: NonNullable<Instrument["target"]>;
}

/** A net of the document a lead or a line can go on. */
export interface NetChoice {
  value: string;
  label: string;
}

export type InstrumentKind = Instrument["kind"];

export const MAX_INSTRUMENTS = 64;

const pinKey = ({ c, p }: PinRef): string => `${c}\u0000${p}`;

/**
 * Every named net and every pin of a board or part, as a label a person can pick from a list. The holes of a
 * breadboard are left out: they are hundreds of points that carry no meaning of their own, and a part pinned in one
 * is reached by its own pin. Nets come first, then the pins of each part.
 */
export function listProbePoints(doc: Project): ProbePoint[] {
  const netOf = new Map<string, Project["nets"][number]>();
  for (const net of doc.nets) for (const pin of net.connections) netOf.set(pinKey(pin), net);

  const pins = [...doc.boards, ...doc.components].flatMap((item) => {
    const iface = doc.dependencies.components.find((d) => d.ref === item.definition.ref && d.version === item.definition.version)?.interface;
    if (!iface || iface.role === "surface") return [];
    return iface.pins
      .filter((pin) => pin.type !== "mechanical" && pin.class !== "mechanical")
      .map((pin): ProbePoint => {
        const at: PinRef = { c: item.id, p: pin.id };
        const net = netOf.get(pinKey(at));
        const name = `${item.refdes} ${pin.designator ?? pin.id}`;
        return {
          id: `pin:${item.id}.${pin.id}`,
          label: net?.name ? `${name} (${net.name})` : name,
          part: item.refdes,
          target: { pin: at, ...(net && { net: net.id }), component: item.id },
        };
      });
  });
  const nets = doc.nets.flatMap((net): ProbePoint[] => (net.name ? [{ id: `net:${net.id}`, label: net.name, part: null, target: { net: net.id } }] : []));

  const order = (point: ProbePoint) => (point.part === null ? "" : point.part);
  return [...pins, ...nets]
    .map((point) => ({ ...point, label: point.label.normalize("NFC") }))
    .sort((a, b) => order(a).localeCompare(order(b), undefined, { numeric: true }) || a.label.localeCompare(b.label, undefined, { numeric: true }) || a.id.localeCompare(b.id));
}

/** The nets the points sit on, one entry per net; the net's own name when it has one, else the first pin found on it. */
export function netChoices(points: readonly ProbePoint[]): NetChoice[] {
  const seen = new Set<string>();
  return points.flatMap((p) => {
    const net = p.target.net;
    if (net === undefined || seen.has(net)) return [];
    seen.add(net);
    return [{ value: net, label: p.label }];
  });
}

export interface NodeLookup {
  /** The node a document net is on. */
  ofNet(net: string | undefined): string | undefined;
  /** The node a probe point is on: its pin when it has one, since a net id does not outlive a rewiring, else its net. */
  ofTarget(target: Instrument["target"]): string | undefined;
}

/**
 * The simulator's name for the electrical node a document net is on. The simulator numbers nodes, not nets, and a
 * node joins every net that touches (a breadboard strip), so a probe has to be asked for by node. A pin that no net
 * reaches is a node of its own while an instrument is on it.
 */
export function nodeIdOf(doc: Project): NodeLookup {
  const nl = netlist(doc, probedPins(doc));
  const ofNet = (net: string | undefined) => (net === undefined ? undefined : nl.nodes.find((node) => node.nets.includes(net))?.id);
  return {
    ofNet,
    ofTarget: (target) => (target?.pin ? nl.pinNode[`${target.pin.c}/${target.pin.p}`] : ofNet(target?.net)),
  };
}

export function makeInstrumentOp(kind: InstrumentKind, target: ProbePoint["target"], settings?: Record<string, unknown>): Op {
  return { k: "instrument.set", instrument: { id: newId("ins"), kind, target, ...(settings && { settings }) } };
}

export function removeInstrumentOp(id: string): Op {
  return { k: "instrument.remove", id };
}

/** `sim.set` has no key for the tolerance mode, so the whole solver value goes back with one option changed. */
export function setToleranceOp(doc: Project, mode: ToleranceMode): Op {
  const { solver } = doc.simulation;
  return { k: "sim.set", key: "solver", value: { ...solver, options: { ...solver.options, toleranceMode: mode } } };
}
