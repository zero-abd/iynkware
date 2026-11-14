import type { Project } from "../../../project/generated/types.ts";
import { netlist } from "../../../project/netlist.ts";
import type { Hit } from "../../engine/types.ts";
import type { PartHealth } from "../../../sim-host/analog-protocol.ts";
import { edgeCurrents } from "./plan.ts";
import type { FlowPlan } from "./plan.ts";
import type { AnalogView } from "../../run/analog.ts";

/** What the hover readout of the current flow lens shows for the thing under the pointer. A missing number is one the solver did not report. */
export type FlowReading =
  | {
      kind: "part";
      /** The reference designator, U1 or R2. */
      part: string;
      /** Volts across a two pin part, from its first pin to its second. */
      volts?: number;
      /** Amps through a two pin part, entering at its first pin. */
      amps?: number;
      watts?: number;
      state?: PartHealth;
      /** The pin the pointer is on, with its voltage and the current into it. */
      pin?: { name: string; volts?: number; amps?: number };
    }
  | { kind: "wire"; net: string; volts?: number; amps?: number };

const CACHE = new WeakMap<Project, ReturnType<typeof netlist>>();
const netlistOf = (state: Project) => {
  let nl = CACHE.get(state);
  if (!nl) CACHE.set(state, (nl = netlist(state)));
  return nl;
};

/** The reading for `hit`, or null when it is not a part, a pin or a wire the frame has numbers for. */
export function readingFor(state: Project, snapshot: AnalogView, plan: FlowPlan | null, hit: Hit | null): FlowReading | null {
  if (hit === null) return null;
  const nl = netlistOf(state);
  const voltsOfPin = (c: string, p: string): number | undefined => {
    const node = nl.pinNode[`${c}/${p}`];
    return node === undefined ? undefined : snapshot.volts[node];
  };
  if (hit.kind === "wire") {
    const edge = plan?.edgeOf.get(hit.id);
    if (plan === null || edge === undefined) return null;
    const { node } = plan.edges[edge]!;
    const amps = Object.keys(snapshot.pinAmps).length === 0 ? undefined : edgeCurrents(plan, snapshot.pinAmps)[edge];
    const name = nl.nodes.find((n) => n.id === node)?.names[0] ?? node;
    const volts = snapshot.volts[node];
    return volts === undefined && amps === undefined ? null : { kind: "wire", net: name, ...(volts === undefined ? {} : { volts }), ...(amps === undefined ? {} : { amps }) };
  }
  if (hit.kind !== "part" && hit.kind !== "pin") return null;
  const part = hit.c;
  const name = [...state.boards, ...state.components].find((item) => item.id === part)?.refdes ?? part;
  const pins = snapshot.pinAmps[part];
  const names = pins ? Object.keys(pins) : [];
  const frame = snapshot.parts[part];
  const reading: FlowReading = { kind: "part", part: name };
  if (names.length === 2) {
    const [a, b] = names as [string, string];
    const va = voltsOfPin(part, a);
    const vb = voltsOfPin(part, b);
    if (va !== undefined && vb !== undefined) reading.volts = va - vb;
    reading.amps = pins![a];
  }
  if (frame) {
    reading.watts = frame.watts;
    reading.state = frame.state;
  }
  if (hit.kind === "pin") reading.pin = { name: hit.p, volts: voltsOfPin(hit.c, hit.p), amps: pins?.[hit.p] };
  const known = reading.volts !== undefined || reading.amps !== undefined || reading.watts !== undefined || reading.pin?.volts !== undefined || reading.pin?.amps !== undefined;
  return known ? reading : null;
}
