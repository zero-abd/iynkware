import type { Component, Project as ProjectState } from "../../project/generated/types.ts";
import { netlist } from "../../project/netlist.ts";
import type { Netlist, NetlistNode } from "../../project/netlist.ts";
import { builtinRegistry } from "../../parts/builtin.ts";
import type { PartRegistry } from "../../parts/registry.ts";
import type { PartStateEntry, PartStateFrame } from "../stores/run.ts";

export type PinLevel = 0 | 1 | null;

export type PartVisualState =
  | { kind: "led"; on: boolean; duty: number; /** The lit lamps of a part with several, by pin name. */ lamps?: string[] }
  | { kind: "button"; pressed: boolean }
  | { kind: "pot"; position: number }
  | { kind: "buzzer"; tone: number | null }
  | { kind: "servo"; angle: number; powered: boolean }
  | { kind: "motor"; rpm: number; stalled: boolean; powered: boolean }
  | { kind: "stepper"; angle: number; steps: number; powered: boolean }
  | { kind: "reading"; value: number; unit: string; label: string }
  | { kind: "display"; w: number; h: number; on: boolean; inverted: boolean; rows: string[]; texts: DisplayText[] }
  | { kind: "none"; reason: "not-modelled-yet" };

export interface DisplayText {
  x: number;
  y: number;
  size: number;
  text: string;
}

type Lookup = Pick<PartRegistry, "get">;
/** `quiet` is a modelled part with no state of its own on the canvas: a driver, a bus chip, a mechanical part. */
type Element = "led" | "res" | "button" | "pot" | "buzzer" | "analog" | "quiet";

/** Parts the analog solver models and that have no state of their own to show: their numbers and health come from the analog frame. */
const ANALOG_ONLY = new Set(["capacitor", "inductor", "opamp", "timer_555", "zener", "waveform_source", "diode"]);

const NONE: PartVisualState = { kind: "none", reason: "not-modelled-yet" };
const ANODE = "A";
const CATHODE = "K";
const DEFAULT_POT_POSITION = 0.5;

let shipped: PartRegistry | undefined;
const shippedParts = (): PartRegistry => (shipped ??= builtinRegistry());

let cached: { state: ProjectState; nl: Netlist } | undefined;
function netlistOf(state: ProjectState): Netlist {
  if (cached?.state !== state) cached = { state, nl: netlist(state) };
  return cached.nl;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function elementOf(registry: Lookup, c: Component): Element | "surface" | "unknown" {
  const descriptor = registry.get(c.definition.ref, c.definition.version);
  if (!descriptor) return "unknown";
  if (descriptor.identity.tags?.includes("surface")) return "surface";
  if (descriptor.identity.tags?.includes("mechanical")) return "quiet";
  if (descriptor.simulation.status === "not-modelled-yet") return "unknown";
  for (const layer of descriptor.behaviour.layers) {
    if (layer.model.kind !== "element") continue;
    const e = layer.model.element;
    if (ANALOG_ONLY.has(e)) return "analog";
    if (e === "led" || e === "res" || e === "button" || e === "pot" || e === "buzzer") return e;
  }
  return "quiet";
}

function levelOf(frame: PartStateFrame, node: NetlistNode | undefined): PinLevel {
  if (!node) return null;
  const raw = frame.pins[node.id] ?? (node.names[0] === undefined ? undefined : frame.pins[node.names[0]]);
  return raw === 0 || raw === 1 ? raw : null;
}

/** The level of every pin that sits on a net, as `c/p`. A pin whose node the frame does not report, or reports as `Z` or `X`, is `null`. */
export function pinLevels(state: ProjectState, frame: PartStateFrame): Map<string, PinLevel> {
  const nl = netlistOf(state);
  const byId = new Map(nl.nodes.map((n) => [n.id, n]));
  return new Map(Object.entries(nl.pinNode).map(([key, id]) => [key, levelOf(frame, byId.get(id))]));
}

/** Nodes joined by a resistor, so an LED behind a series resistor sees the pin that drives the resistor. */
function resistorLinks(state: ProjectState, registry: Lookup, nl: Netlist): Map<string, Set<string>> {
  const links = new Map<string, Set<string>>();
  for (const c of state.components) {
    if (elementOf(registry, c) !== "res") continue;
    const nodes = Object.entries(nl.pinNode)
      .filter(([key]) => key.startsWith(`${c.id}/`))
      .map(([, node]) => node);
    for (const a of nodes) {
      const set = links.get(a) ?? new Set<string>();
      for (const b of nodes) set.add(b);
      links.set(a, set);
    }
  }
  return links;
}

function ledFromPins(c: Component, frame: PartStateFrame, nl: Netlist, links: Map<string, Set<string>>): PartVisualState {
  const byId = new Map(nl.nodes.map((n) => [n.id, n]));
  const anode = nl.pinNode[`${c.id}/${ANODE}`];
  const cathode = nl.pinNode[`${c.id}/${CATHODE}`];
  if (anode === undefined) return { kind: "led", on: false, duty: 0 };
  const seen = new Set([anode]);
  const queue = [anode];
  let driven = false;
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (levelOf(frame, byId.get(id)) === 1) driven = true;
    for (const next of links.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const on = driven && levelOf(frame, cathode === undefined ? undefined : byId.get(cathode)) !== 1;
  return { kind: "led", on, duty: on ? 1 : 0 };
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** The state a provider on the worker side reported, or undefined for an entry that is not one (or is malformed). */
function reported(entry: PartStateEntry): PartVisualState | undefined {
  switch (entry.kind) {
    case "servo":
      return finite(entry.angle) ? { kind: "servo", angle: Math.min(180, Math.max(0, entry.angle)), powered: entry.powered === true } : undefined;
    case "motor":
      return finite(entry.rpm) ? { kind: "motor", rpm: entry.rpm, stalled: entry.stalled === true, powered: entry.powered === true } : undefined;
    case "stepper":
      return finite(entry.angle) && finite(entry.steps) ? { kind: "stepper", angle: entry.angle, steps: entry.steps, powered: entry.powered === true } : undefined;
    case "reading":
      return finite(entry.value) && typeof entry.unit === "string" ? { kind: "reading", value: entry.value, unit: entry.unit, label: typeof entry.label === "string" ? entry.label : "" } : undefined;
    case "display": {
      const { w, h, rows, texts } = entry;
      if (!finite(w) || !finite(h) || !Array.isArray(rows) || !rows.every((r) => typeof r === "string")) return undefined;
      const shown = Array.isArray(texts) ? texts.filter((t): t is DisplayText => !!t && finite(t.x) && finite(t.y) && finite(t.size) && typeof t.text === "string") : [];
      return { kind: "display", w, h, on: entry.on === true, inverted: entry.inverted === true, rows: rows as string[], texts: shown };
    }
    default:
      return undefined;
  }
}

function fromEntry(entry: PartStateEntry, c: Component): PartVisualState {
  switch (entry.kind) {
    case "led": {
      const lamps = Array.isArray(entry.lamps) ? entry.lamps.filter((l): l is string => typeof l === "string") : undefined;
      if (entry.lit !== true) return { kind: "led", on: false, duty: 0, ...(lamps ? { lamps } : {}) };
      return { kind: "led", on: true, duty: typeof entry.brightness === "number" ? clamp01(entry.brightness) : 1, ...(lamps ? { lamps } : {}) };
    }
    case "button":
      return { kind: "button", pressed: entry.pressed === true };
    case "buzzer":
      return { kind: "buzzer", tone: entry.on === true && typeof entry.hz === "number" ? entry.hz : null };
    case "pot":
      return { kind: "pot", position: typeof entry.position === "number" ? clamp01(entry.position) : potParam(c) };
    default:
      return NONE;
  }
}

function potParam(c: Component): number {
  const pos = c.params?.pos;
  return typeof pos === "number" ? clamp01(pos) : DEFAULT_POT_POSITION;
}

/**
 * What each part of the document looks like in `frame`. The part kind comes from the descriptor's element model, not
 * from the part id. A part that reports a servo, motor, stepper or reading state is shown by it whatever its descriptor
 * says. The simulator's own entry for a part wins; an LED it did not report is read from the pin levels
 * through the netlist and any series resistors. A part whose descriptor says it is not modelled, or has no model, is
 * `none`. Boards, wiring surfaces, resistors and the parts only the analog solver models have no visual state and are left out. Parts that left the document
 * while a frame was in flight are never visited, so their entries drop out.
 */
export function derivePartStates(
  state: ProjectState,
  frame: PartStateFrame,
  registry: Lookup = shippedParts(),
): Map<string, PartVisualState> {
  const nl = netlistOf(state);
  // the pin layer marks every part it has no rule for as not modelled; the part's own element says more than that
  const entries = new Map(frame.parts.filter((p) => p.kind !== "not-modelled").map((p) => [p.part, p]));
  const links = resistorLinks(state, registry, nl);
  const out = new Map<string, PartVisualState>();
  for (const c of state.components) {
    const entry = entries.get(c.id);
    const own = entry && reported(entry);
    if (own) {
      out.set(c.id, own);
      continue;
    }
    const element = elementOf(registry, c);
    if (element === "surface" || element === "res" || element === "analog" || (element === "quiet" && entry?.kind !== "led")) continue;
    if (element === "unknown") {
      out.set(c.id, NONE);
      continue;
    }
    if (entry) {
      out.set(c.id, fromEntry(entry, c));
    } else if (element === "led") {
      out.set(c.id, ledFromPins(c, frame, nl, links));
    } else if (element === "button") {
      out.set(c.id, { kind: "button", pressed: false });
    } else if (element === "pot") {
      // the canvas's knob ring shows a pot's turn during a run; a tag from the document's value would show it twice
      continue;
    } else {
      out.set(c.id, NONE);
    }
  }
  return out;
}
