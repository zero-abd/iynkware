import type { Descriptor } from "../../parts/descriptor.ts";
import type { SimNetlist, SimPart } from "../engine.ts";
import { ratingValue } from "../models/kinds.ts";
import { type Tol, drawAll, limitsTol } from "./tolerance.ts";

/** The descriptor rating that gives a part's value tolerance, in percent. */
export const TOLERANCE_RATING = "tolerance";
/** The descriptor rating that gives a transistor's current gain as a minimum and a maximum. */
export const GAIN_RANGE_RATING = "current_gain_range";

const VALUE_PARAMS = ["ohms", "farads", "henries"] as const;

export interface PartSpread {
  part: string;
  param: string;
  tol: Tol;
}

export interface SpreadOptions {
  /** Replaces the tolerance of every resistor, as when a build uses 1 percent parts. */
  resistorPct?: number;
}

/** What `drawBuild` drew: each spread value by part, then parameter. */
export type Drawn = Record<string, Record<string, number>>;

const descriptorOf = (id: string, describe: (ref: string, version: string) => Descriptor | undefined): Descriptor | undefined => {
  const at = id.lastIndexOf("@");
  return describe(id.slice(0, at), id.slice(at + 1));
};

function limitsOf(d: Descriptor, key: string): Tol | null {
  try {
    return limitsTol(ratingValue(d, key, "min"), ratingValue(d, key, "max"));
  } catch {
    return null;
  }
}

/** The key of the forward voltage rating the LED's colour picks, read from the layer that builds its element. */
function forwardVoltageKey(d: Descriptor, part: SimPart): string | undefined {
  for (const layer of d.behaviour.layers) {
    if (layer.model.kind !== "element") continue;
    const pick = layer.model.params?.vf?.by_parameter;
    if (!pick) continue;
    const chosen = part.params[pick.parameter] ?? d.parameters?.find((p) => p.id === pick.parameter)?.default;
    return pick.map[String(chosen)];
  }
  return undefined;
}

function spreadsOfPart(part: SimPart, d: Descriptor, o: SpreadOptions): PartSpread[] {
  const found: PartSpread[] = [];
  const add = (param: string, tol: Tol | null) => void (tol && found.push({ part: part.id, param, tol }));
  const valueParam = VALUE_PARAMS.find((p) => typeof part.params[p] === "number");
  if (valueParam && d.ratings[TOLERANCE_RATING]) {
    const pct = part.kind === "resistor" && o.resistorPct !== undefined ? o.resistorPct : ratingValue(d, TOLERANCE_RATING);
    add(valueParam, { nominal: part.params[valueParam] as number, tol: { kind: "pct", value: pct } });
  }
  const vfKey = forwardVoltageKey(d, part);
  if (vfKey) add("vf", limitsOf(d, vfKey));
  if (d.ratings[GAIN_RANGE_RATING]) add("hfe", limitsOf(d, GAIN_RANGE_RATING));
  return found;
}

/** Every value of the circuit that varies from one real part to the next, with how far. Parts whose descriptor states no spread are left out. */
export function spreadsOf(net: SimNetlist, describe: (ref: string, version: string) => Descriptor | undefined, o: SpreadOptions = {}): PartSpread[] {
  return net.parts.flatMap((part) => {
    const d = descriptorOf(part.descriptor, describe);
    return d ? spreadsOfPart(part, d, o) : [];
  });
}

/** One build: every spread value drawn from the seed, laid into a copy of the netlist. The same seed gives the same build. */
export function drawBuild(net: SimNetlist, spreads: readonly PartSpread[], seed: number): { net: SimNetlist; drawn: Drawn } {
  const values = drawAll(Object.fromEntries(spreads.map((s) => [`${s.part}:${s.param}`, s.tol])), seed);
  const drawn: Drawn = {};
  for (const s of spreads) (drawn[s.part] ??= {})[s.param] = values[`${s.part}:${s.param}`];
  const parts = net.parts.map((p) => (drawn[p.id] ? { ...p, params: { ...p.params, ...drawn[p.id] } } : p));
  return { net: { ...net, parts, settings: { ...net.settings, seed, toleranceMode: "seeded" } }, drawn };
}
