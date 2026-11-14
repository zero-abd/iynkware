import { type PartHealth, elementHealth } from "./health.ts";
import type { BurnReason } from "./states.ts";
import type { Element, ElementId, SolveResult } from "./types.ts";

type NetId = string;
type PartId = string;

/** The power and health of a part; a burnt one carries what it failed on. */
export interface PartReadout {
  watts: number;
  state: PartHealth;
  why?: BurnReason;
}

/** What one frame of the run reads off the solver. A net or element the solver has no converged answer for is left out. */
export interface Readout {
  /** Volts by net id, relative to the ground net. */
  volts: ReadonlyMap<NetId, number>;
  /** Amps by element id, as the solver measures them (positive from the first node to the second; a source delivers). */
  amps: ReadonlyMap<ElementId, number>;
  /** Amps by part, then pin, positive into the part through that pin. */
  pinAmps: ReadonlyMap<PartId, Record<string, number>>;
  parts: ReadonlyMap<PartId, PartReadout>;
  /** By the id the instrument was set with. */
  instruments: ReadonlyMap<string, { volts: number; amps: number; limiting: boolean }>;
  /** Shaft speed in rpm by element id, for every motor that turns; positive when its first lead is the higher one. */
  rpm: ReadonlyMap<ElementId, number>;
}

/** One solved piece of the circuit: the nets its local nodes stand for (node `i + 1`), its elements and the answer. */
export interface SolvedComponent {
  nodes: readonly number[];
  elements: readonly Element[];
  last: SolveResult | null;
  ok: boolean;
}

export interface ReadoutInput {
  components: readonly SolvedComponent[];
  /** The net of each global node. */
  netOf: ReadonlyMap<number, NetId>;
  /** The pin names each part has on a net, in pin order. */
  partNets: ReadonlyMap<PartId, ReadonlyMap<NetId, readonly string[]>>;
  /** The parts latched burnt, and what each failed on. */
  burnt: ReadonlyMap<PartId, BurnReason>;
}

export const INSTRUMENT_PREFIX = "inst:";
const ELEMENT_OWNED = new Set(["pin", "rail", "logic"]);
const SEVERITY: Record<PartHealth, number> = { ok: 0, hot: 1, reversed: 2, burnt: 3 };

/** The part an element belongs to and, for a board pin or a logic output, the pin it is. `LED1:R` is part `LED1`; `pin:brd:D13` is pin `D13` of `brd`. */
function ownerOf(id: ElementId): { part: PartId; pin?: string } | null {
  const [head, second, third] = id.split(":");
  if (head === "inst") return null;
  return ELEMENT_OWNED.has(head) && second !== undefined ? { part: second, ...(third === undefined ? {} : { pin: third }) } : { part: head };
}

/** The current each node of an element takes, positive into the element. A kind with a control terminal reports only the terminals it can account for. */
function intoNodes(el: Element, amps: number): [node: number, into: number][] {
  switch (el.kind) {
    case "R":
    case "M":
    case "D":
    case "BZ":
    case "C":
    case "L":
      return [[el.a, amps], [el.b, -amps]];
    case "V":
    case "VW":
      return [[el.a, -amps], [el.b, amps]];
    case "PIN":
    case "PWM":
      return [[el.a, -amps]];
    case "Q":
      return [[el.c, amps], [el.e, -amps]];
    case "TS":
      return [[el.supplyPos, amps], [el.supplyNeg, -amps]];
    default:
      return [];
  }
}

const GROUND = 0;

export function readoutOf({ components, netOf, partNets, burnt }: ReadoutInput): Readout {
  const volts = new Map<NetId, number>();
  const amps = new Map<ElementId, number>();
  const pinAmps = new Map<PartId, Record<string, number>>();
  const parts = new Map<PartId, PartReadout>();
  const instruments = new Map<string, { volts: number; amps: number; limiting: boolean }>();
  const rpm = new Map<ElementId, number>();
  const ground = netOf.get(GROUND);
  if (ground !== undefined) volts.set(ground, 0);

  const addPin = (part: PartId, pin: string, into: number) => {
    const pins = pinAmps.get(part) ?? {};
    pins[pin] = (pins[pin] ?? 0) + into;
    pinAmps.set(part, pins);
  };

  for (const comp of components) {
    const result = comp.last;
    if (!comp.ok || !result) continue;
    comp.nodes.forEach((node, i) => {
      const net = netOf.get(node);
      if (net !== undefined) volts.set(net, result.v[i + 1]);
    });
    for (const el of comp.elements) {
      const b = result.branch[el.id];
      if (!b) continue;
      amps.set(el.id, b.amps);
      if (el.kind === "M" && el.model) rpm.set(el.id, el.rpm ?? 0);
      if (el.id.startsWith(INSTRUMENT_PREFIX)) {
        const limit = el.kind === "V" || el.kind === "VW" ? el.limit?.amps : undefined;
        instruments.set(el.id.slice(INSTRUMENT_PREFIX.length), { volts: b.volts, amps: b.amps, limiting: limit !== undefined && b.amps >= limit * (1 - 1e-3) });
        continue;
      }
      const owner = ownerOf(el.id);
      if (!owner) continue;
      const health = elementHealth(el, b);
      const seen = parts.get(owner.part);
      const why = burnt.get(owner.part);
      parts.set(owner.part, {
        watts: (seen?.watts ?? 0) + b.watts,
        state: why ? "burnt" : SEVERITY[health] > SEVERITY[seen?.state ?? "ok"] ? health : (seen?.state ?? "ok"),
        ...(why && { why }),
      });
      if (owner.pin !== undefined) {
        for (const [, into] of intoNodes(el, b.amps)) addPin(owner.part, owner.pin, into);
        continue;
      }
      for (const [node, into] of intoNodes(el, b.amps)) {
        const net = node === GROUND ? ground : netOf.get(comp.nodes[node - 1]);
        const pin = net === undefined ? undefined : partNets.get(owner.part)?.get(net)?.[0];
        if (pin !== undefined) addPin(owner.part, pin, into);
      }
    }
  }
  return { volts, amps, pinAmps, parts, instruments, rpm };
}
