import type { WorldInput as LegacyWorldInput } from "@/content/schema";
import { drivesFor } from "@/lib/interp/lesson-world";
import type { WorldInput } from "@/project/generated/types";
import { boardIdOf, PROFILES } from "@/sim/boards/profiles";
import type { HostInput, SimNetlist } from "@/sim/engine";
import { deriveInputPins } from "@/sim/world-pins";

export type BuiltinInput = WorldInput & { device: LegacyWorldInput["device"] };

/** Registry devices have no interpreter model, so nothing here drives them. */
export const isBuiltin = (input: WorldInput): input is BuiltinInput => input.device.kind !== "registry";

/** The input in the shape `WorldBinding` and `drivesFor` read: the pins come from the wires, not from the lesson. */
export function legacyInput(net: SimNetlist, input: BuiltinInput): LegacyWorldInput {
  return {
    id: input.id,
    quantity: input.quantity,
    device: input.device,
    pins: deriveInputPins(net, input).pins,
    part: input.component,
    min: input.min,
    max: input.max,
    step: input.step,
    default: input.default,
    unit: input.unit,
    gesture: "tap",
    label: input.id,
  };
}

/**
 * The host inputs that put a world input at `value`: the level or the voltage on each board pin the part is wired to.
 * Inputs that are not a plain pin drive (a ranger, an I2C sensor, a network request) give none.
 */
export function inputDrives(net: SimNetlist, input: WorldInput, value: number): HostInput[] {
  if (!isBuiltin(input)) return [];
  const board = net.parts.find((p) => p.kind === "board");
  const profile = board && PROFILES[boardIdOf(board.descriptor)];
  if (!profile) return [];
  const pins = drivesFor(legacyInput(net, input), value, profile.logicV).map((drive): HostInput =>
    "volts" in drive ? { kind: "analog", target: drive.net, value: drive.volts } : { kind: "pin", target: drive.net, value: drive.level },
  );
  return [...knobDrive(net, input, value), ...pins];
}

/** A knob on a potentiometer turns the part itself, so the circuit solver sees the same wiper as the pin does. */
function knobDrive(net: SimNetlist, input: BuiltinInput, value: number): HostInput[] {
  const pot = net.parts.find((p) => p.id === input.component && p.kind === "pot");
  const span = input.max - input.min;
  if (!pot || !(span > 0)) return [];
  const pos = Math.min(1, Math.max(0, (value - input.min) / span));
  return [{ kind: "param", target: pot.id, value: { path: "pos", value: pos } }];
}
