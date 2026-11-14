import type { NetEdge, PinSignal, SimPart } from "../engine.ts";
import type { DisplayView, PartPeer, PartStateCtx } from "./types.ts";

export const QUIET: PinSignal = { level: 0, duty: 1, hz: null, servoUs: null, highNs: null, periodNs: null, lastRiseAt: null, lastEdgeAt: null };

interface Given {
  at?: number;
  params?: SimPart["params"];
  volts?: Record<string, number>;
  signals?: Record<string, Partial<PinSignal>>;
  /** Currents by element id; a bare number is any element's. */
  amps?: number | Record<string, number> | null;
  /** Shaft speeds by element id; a bare number is the part's own motor. */
  rpm?: number | Record<string, number> | null;
  health?: PartStateCtx["health"] extends () => infer H ? H : never;
  memory?: PartStateCtx["memory"];
  display?: DisplayView | null;
  /** Level changes by pin, with their sequence numbers. */
  edges?: Record<string, NetEdge[]>;
  /** Peers by pin. */
  peers?: Record<string, PartPeer[]>;
}

/** A part context built from plain values, for testing a provider alone. The same `memory` object across calls makes a run. */
export function ctxOf(descriptor: string, given: Given = {}): PartStateCtx {
  const volts = given.volts ?? {};
  const level = (pin: string): number | null => volts[pin] ?? null;
  return {
    part: { id: "p1", descriptor, params: given.params ?? {}, pins: {}, kind: "other" },
    at: given.at ?? 0,
    memory: given.memory ?? {},
    net: (pin) => `n:${pin}`,
    signal: (pin) => (given.signals?.[pin] ? { ...QUIET, ...given.signals[pin] } : null),
    edges: (pin, after) => (given.edges?.[pin] ?? []).filter((e) => e.seq > after),
    peers: (pin) => given.peers?.[pin] ?? [],
    volts: level,
    across: (plus, minus) => {
      const [a, b] = [level(plus), level(minus)];
      return a === null || b === null ? null : a - b;
    },
    amps: (element) => (typeof given.amps === "number" || given.amps == null ? given.amps ?? null : given.amps[element ?? "p1"] ?? null),
    rpm: (element = "p1") => (typeof given.rpm === "number" ? (element === "p1" ? given.rpm : null) : given.rpm?.[element] ?? null),
    pinAmps: () => null,
    health: () => given.health ?? null,
    display: () => given.display ?? null,
  };
}
