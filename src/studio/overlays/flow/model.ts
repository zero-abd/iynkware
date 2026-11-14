import type { AnalogView } from "../../run/analog.ts";
import type { PinSpots, Stroke } from "./geometry.ts";
import { edgeCurrents } from "./plan.ts";
import type { FlowPlan } from "./plan.ts";
import { MIN_FLOW_AMPS, rampColour, rampStep } from "./scale.ts";
import type { RampTokens } from "./scale.ts";

/** One thing the flow layer draws: a polyline, coloured by the voltage of its node, with dots that move by `amps`. */
export interface FlowItem {
  /** Stable across frames, so a dot keeps its place while the current changes. */
  key: string;
  xy: Float64Array;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Along the polyline from its first point to its last; 0 draws no dots. */
  amps: number;
  /** The colour of the line, or null for a line that is not drawn (the inside of a part). */
  colour: string | null;
}

/** The inside of a two pin part has no wire to colour; the current runs straight from one pin to the other. */
function through(snapshot: AnalogView, spots: PinSpots): FlowItem[] {
  const items: FlowItem[] = [];
  for (const [part, pins] of Object.entries(snapshot.pinAmps)) {
    const names = Object.keys(pins);
    if (names.length !== 2) continue;
    const a = spots.get(`${part}/${names[0]}`);
    const b = spots.get(`${part}/${names[1]}`);
    if (!a || !b) continue;
    items.push({
      key: `part:${part}`,
      xy: Float64Array.of(a.x, a.y, b.x, b.y),
      x0: Math.min(a.x, b.x),
      y0: Math.min(a.y, b.y),
      x1: Math.max(a.x, b.x),
      y1: Math.max(a.y, b.y),
      amps: pins[names[0]!]!,
      colour: null,
    });
  }
  return items;
}

/**
 * The items of one frame. A wire takes the colour of its node's voltage (grey when the frame has none for it) and
 * the current the plan finds for it; the inside of each two pin part gets the current that enters its first pin.
 */
export function flowItems(
  plan: FlowPlan,
  strokes: readonly Stroke[],
  spots: PinSpots,
  snapshot: AnalogView,
  max: number,
  tokens: RampTokens,
): FlowItem[] {
  const currents = edgeCurrents(plan, snapshot.pinAmps);
  const items: FlowItem[] = strokes.map((s) => {
    const edge = plan.edges[s.edge]!;
    const volts = snapshot.volts[edge.node];
    const amps = currents[s.edge]!;
    return {
      key: `wire:${edge.id}`,
      xy: s.xy,
      x0: s.x0,
      y0: s.y0,
      x1: s.x1,
      y1: s.y1,
      amps: Math.abs(amps) < MIN_FLOW_AMPS ? 0 : amps,
      colour: rampColour(volts === undefined ? 0 : rampStep(volts, max), tokens),
    };
  });
  return items.concat(through(snapshot, spots).filter((i) => Math.abs(i.amps) >= MIN_FLOW_AMPS));
}
