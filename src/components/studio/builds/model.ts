import type { Op, Project } from "@/project/generated/types";
import type { BuildResult, Quantity } from "@/sim-host/montecarlo/protocol";
import { setToleranceOp, listProbePoints, nodeIdOf } from "@/studio/instruments/placement";
import type { Quantity as Unit } from "@/studio/units";

export const BUILDS = 100;
export const BINS = 12;
export const DEFAULT_SECONDS = 2;
export const SECONDS_LIMITS = { min: 0.1, max: 30 };

export interface TargetOption {
  /** What the list keys on: a pin and the net it is on share a node, so the node alone would not tell them apart. */
  value: string;
  label: string;
  /** The node, or the part, the measure reads. */
  target: string;
}

export const UNIT_OF: Record<Quantity, Unit> = { volts: "volt", amps: "amp", hz: "hertz" };

const THREE_DIGITS = 3;

/** For each quantity, from the size at which a unit takes over: how many of it make one base unit. */
const STEPS: Record<Quantity, readonly (readonly [from: number, scale: number, symbol: string])[]> = {
  volts: [[0.1, 1, "V"], [0, 1e3, "mV"]],
  amps: [[1, 1, "A"], [1e-3, 1e3, "mA"], [0, 1e6, "µA"]],
  hz: [[1000, 1e-3, "kHz"], [0.1, 1, "Hz"], [0, 1e3, "mHz"]],
};

/** A reading to three digits in the unit a person reads it in: 1.09 Hz, 893 mHz, 12.4 mA. */
export function formatReading(value: number, quantity: Quantity): string {
  const size = Math.abs(value);
  const steps = STEPS[quantity];
  const [, scale, symbol] = (size === 0 ? steps.find(([, s]) => s === 1) : steps.find(([from]) => size >= from)) ?? steps[0];
  return `${Number((value * scale).toPrecision(THREE_DIGITS))} ${symbol}`;
}

/** What a person can point a measurement at: the pins and named nets for a voltage or a frequency, the parts for a current. */
export function targetsOf(doc: Project, quantity: Quantity): TargetOption[] {
  if (quantity === "amps") {
    return doc.components.filter((c) => !c.definition.ref.startsWith("core.breadboard")).map((c) => ({ value: c.id, label: c.refdes, target: c.id }));
  }
  const nodes = nodeIdOf(doc);
  return listProbePoints(doc).flatMap((point) => {
    const node = nodes.ofTarget(point.target);
    return node === undefined ? [] : [{ value: point.id, label: point.label, target: node }];
  });
}

/** The pin a meter, probe or scope of the project already sits on, so the first measure is what the person was already watching. */
export function watchedNode(doc: Project): string | undefined {
  const nodes = nodeIdOf(doc);
  for (const instrument of doc.simulation.instruments ?? []) {
    const node = instrument.target ? nodes.ofTarget(instrument.target) : undefined;
    if (node !== undefined) return node;
  }
  return undefined;
}

/** The edits that make the normal run use build `seed`: its seed on the project and the seeded tolerance mode. */
export function openBuildOps(doc: Project, seed: number): Op[] {
  return [{ k: "sim.set", key: "seed", value: seed }, setToleranceOp(doc, "seeded")];
}

/** The edit that goes back to the placed values. */
export const nominalOps = (doc: Project): Op[] => [setToleranceOp(doc, "nominal")];

export interface PartBurn {
  part: string;
  count: number;
  /** The first build in which the part burnt. */
  first: number;
}

/** Which parts burnt and in how many builds, the most often first. */
export function burnsOf(results: readonly BuildResult[]): PartBurn[] {
  const byPart = new Map<string, PartBurn>();
  for (const r of results) {
    for (const { part } of r.burnt) {
      const seen = byPart.get(part);
      if (seen) seen.count++;
      else byPart.set(part, { part, count: 1, first: r.index });
    }
  }
  return [...byPart.values()].sort((a, b) => b.count - a.count || a.part.localeCompare(b.part));
}
