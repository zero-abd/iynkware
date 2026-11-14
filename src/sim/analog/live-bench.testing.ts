import type { SimNetlist, SimPart } from "../engine.ts";
import { PROFILES, pinElectrical } from "../boards/profiles.ts";
import { loadRegistry } from "../registry/entries.ts";
import { PWL_OPTIONS } from "./elements.ts";
import { createLiveAnalog, pinElementId, type LiveAnalog, type PartLayers } from "./live.ts";
import { solve } from "./solve.ts";
import type { AnalogOptions } from "./types.ts";

export const BOARD = "brd";

export interface BenchPart {
  part: SimPart;
  layers?: PartLayers;
}

export const resistor = (id: string, a: string, b: string, ohms: number): BenchPart => ({
  part: { id, descriptor: "part:resistor@1", params: { ohms }, pins: { a, b }, kind: "resistor" },
});

/** A part the solver builds from an element layer, as a placed descriptor would give it. */
export function layered(id: string, element: string, terminals: Record<string, string>, params: Record<string, number | string | boolean>, nets: Record<string, string>): BenchPart {
  return {
    part: { id, descriptor: `test.${element}@1`, params: {}, pins: nets, kind: "other" },
    layers: { elements: [{ kind: "element", layerId: "dc", element, terminals, params }], drives: [] },
  };
}

export const capacitor = (id: string, a: string, b: string, farads: number): BenchPart => layered(id, "capacitor", { a: "P1", b: "P2" }, { farads, esr_ohms: 0 }, { P1: a, P2: b });

/** An Uno with the pins it is wired to; `pins` maps a pin name to a net. */
export const uno = (pins: Record<string, string>): BenchPart => ({ part: { id: BOARD, descriptor: "core.uno-r3@1.0.0", params: {}, pins, kind: "board" } });

export const unoPin = (pin: string) => pinElementId(BOARD, pin);

/** The live solver on a circuit of these parts, with every net they name and ground `gnd`, solved at 0. */
export function bench(parts: BenchPart[], analog: AnalogOptions = { mode: "transient" }): LiveAnalog {
  const nets = new Set(["gnd"]);
  for (const { part } of parts) for (const net of Object.values(part.pins)) if (net !== null) nets.add(net);
  const net: SimNetlist = {
    version: 1,
    docHash: "t",
    nets: [...nets].map((id) => ({ id })),
    ground: "gnd",
    parts: parts.map((p) => p.part),
    settings: { seed: 1, toleranceMode: "nominal", analog, speed: 1 },
  };
  const live = createLiveAnalog({
    solve,
    registry: loadRegistry(),
    pins: (part) => (part.kind === "board" ? { ...pinElectrical(PROFILES["uno-r3"]), logicVolts: 5 } : null),
    power: () => null,
  });
  live.load(net, PWL_OPTIONS, new Map(parts.flatMap((p) => (p.layers ? [[p.part.id, p.layers] as const] : []))));
  live.advanceTo(0);
  return live;
}
