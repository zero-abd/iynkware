import { stateHash } from "../project/hash.ts";
import type { Project } from "../project/generated/types.ts";
import { netlist, probedPins } from "../project/netlist.ts";
import type { InterfaceSnapshot } from "../parts/pins.ts";
import { interfaceOf } from "../parts/pins.ts";
import type { PartRegistry } from "../parts/registry.ts";
import type { Descriptor } from "../parts/descriptor.ts";
import { type SimDiagnostic, simDiag } from "./core/diagnostic.ts";
import type { AnalogOptions } from "./analog/types.ts";
import { drawBuild, spreadsOf } from "./analog/part-tolerance.ts";
import type { PartKind, SimNetlist, SimPart } from "./engine.ts";

const MAX_PARTS = 2000;
const GENERATOR_STEP_NS = 10_000;

/** The solver options of the document: what it asks for under `simulation.solver.options`, and transient when a function generator is on the bench. */
export function analogOptions(doc: Project): AnalogOptions {
  const asked: { mode?: unknown; stepNs?: unknown } = doc.simulation.solver.options ?? {};
  const stepNs = typeof asked.stepNs === "number" && Number.isInteger(asked.stepNs) && asked.stepNs > 0 ? asked.stepNs : null;
  const generator = doc.simulation.instruments?.some((i) => i.kind === "function-generator") === true;
  const step = stepNs ?? (generator ? GENERATOR_STEP_NS : undefined);
  return { mode: asked.mode === "transient" || generator ? "transient" : "dc-event", ...(step !== undefined && { stepNs: step }) };
}

const KIND_OF_ELEMENT: Record<string, PartKind> = {
  led: "led",
  res: "resistor",
  button: "button",
  buzzer: "buzzer",
  pot: "pot",
};

function kindOf(d: Descriptor): PartKind {
  if (d.identity.kind === "board") return "board";
  for (const layer of d.behaviour.layers) {
    if (layer.model.kind === "element") return KIND_OF_ELEMENT[layer.model.element] ?? "other";
  }
  return "other";
}

/**
 * The node the circuit measures against: the net classed as ground, or failing that one that holds a ground pin, since
 * a wire the editor draws makes a net without a class. `ground` is "" and `present` false for a document with none.
 */
export function groundOf(doc: Project, reg: Pick<PartRegistry, "get">, nl = netlist(doc)): { ground: string; present: boolean } {
  const pinned = new Map<string, InterfaceSnapshot>();
  for (const dep of doc.dependencies.components) pinned.set(`${dep.ref}@${dep.version}`, dep.interface);
  const groundPinIds = new Set(
    [...doc.boards, ...doc.components].flatMap((inst) => {
      const { ref, version } = inst.definition;
      const known = reg.get(ref, version);
      const iface = pinned.get(`${ref}@${version}`) ?? (known ? interfaceOf(known) : undefined);
      return (iface?.pins ?? []).filter((p) => p.type === "ground" || p.class === "ground").map((p) => `${inst.id}/${p.id}`);
    }),
  );
  const groundNet = doc.nets.find((n) => n.class === "ground") ?? doc.nets.find((n) => n.connections.some((pin) => groundPinIds.has(`${pin.c}/${pin.p}`)));
  const groundPin = groundNet?.connections[0];
  return { ground: groundPin ? (nl.pinNode[`${groundPin.c}/${groundPin.p}`] ?? "") : "", present: groundNet !== undefined };
}

/**
 * The simulator's view of a document: electrical nodes from `netlist(doc)` and one part per board and component. A
 * wiring surface such as a breadboard is left out. A reference the registry cannot resolve still counts as a surface
 * when the document pinned it as one; any other becomes a part of kind `other` with `unknown-part`.
 */
export function buildSimNetlist(doc: Project, reg: Pick<PartRegistry, "get">): { net: SimNetlist; diagnostics: SimDiagnostic[] } {
  const nl = netlist(doc, probedPins(doc));
  const diagnostics: SimDiagnostic[] = [];
  const pinned = new Map<string, InterfaceSnapshot>();
  for (const dep of doc.dependencies.components) pinned.set(`${dep.ref}@${dep.version}`, dep.interface);

  const instances = [...doc.boards, ...doc.components];
  const { ground, present } = groundOf(doc, reg, nl);
  if (!present) diagnostics.push(simDiag("no-ground", "warning", {}));

  const parts: SimPart[] = [];
  if (instances.length > MAX_PARTS) {
    diagnostics.push(simDiag("netlist-too-large", "error", {}, { parts: instances.length, max: MAX_PARTS }));
  } else {
    for (const inst of instances) {
      const { ref, version } = inst.definition;
      const descriptor = reg.get(ref, version);
      const iface = pinned.get(`${ref}@${version}`) ?? (descriptor ? interfaceOf(descriptor) : undefined);
      if (iface?.role === "surface") continue;
      if (!descriptor) diagnostics.push(simDiag("unknown-part", "warning", { part: inst.id }, { ref: `${ref}@${version}` }));

      const params: SimPart["params"] = {};
      for (const p of iface?.params ?? []) params[p.id] = p.default;
      Object.assign(params, inst.params);

      const pins: SimPart["pins"] = {};
      for (const p of iface?.pins ?? []) pins[p.id] = nl.pinNode[`${inst.id}/${p.id}`] ?? null;
      parts.push({ id: inst.id, descriptor: `${ref}@${version}`, params, pins, kind: descriptor ? kindOf(descriptor) : "other" });
    }
  }

  let net: SimNetlist = {
    version: 1,
    docHash: stateHash(doc),
    nets: nl.nodes.map((node) => (node.names[0] === undefined ? { id: node.id } : { id: node.id, name: node.names[0] })),
    ground,
    parts: diagnostics.some((d) => d.id === "netlist-too-large") ? [] : parts,
    settings: { seed: doc.simulation.seed, toleranceMode: "nominal", analog: analogOptions(doc), speed: 1 },
  };
  const asked: { toleranceMode?: unknown } = doc.simulation.solver.options ?? {};
  if (asked.toleranceMode === "seeded") {
    net = drawBuild(net, spreadsOf(net, (ref, version) => reg.get(ref, version)), doc.simulation.seed).net;
  }
  return { net, diagnostics };
}
