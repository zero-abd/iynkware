import { LIMITS } from "../../core/battery.ts";
import type { Rating } from "../../parts/generated/types.ts";
import { boardPower } from "../registry/power-models.ts";
import type { RegulatorModel } from "../analog/types.ts";
import type { SimNetlist } from "../engine.ts";
import type { ComponentDescriptor } from "./ports.ts";

export interface RobotNets {
  /** The positive terminal of the pack. */
  pack: string;
  /** The board's supply input, which the on-board regulator turns into the logic rail. */
  regulator: string;
  /** The board's logic rail. */
  rail: string;
}

export interface Minimum {
  v: number;
  /** The part whose declared minimum it is; the pack's own cut-off names the battery. */
  part: string;
}

export interface RobotRails {
  /** Empty strings where the netlist has no such pin. */
  nets: RobotNets;
  /**
   * The board's regulator when the pack feeds it directly; the rail is what `regulatorOut` gives at the pack voltage.
   * `described` is false when no power model of the board exists: it is then taken to hold the logic level with no dropout.
   */
  regulator?: { model: RegulatorModel; described: boolean };
  /** The highest minimum supply any part on the pack declares, or the pack's own cut-off under load. */
  packMin?: Minimum;
  /** The highest minimum supply any part on the logic rail declares; unknown when none declares one. */
  logicMin?: Minimum;
}

type Describe = (ref: string) => ComponentDescriptor | undefined;

const refOf = (descriptor: string): string => descriptor.split("@")[0] ?? "";

/** The number a voltage rating states, from the slot a model reads, else the stated one, else the assumed one. */
function volts(rating: Rating): number | undefined {
  if (rating.measure !== "voltage") return undefined;
  const slot = rating.used_by_model === "none" ? (rating.manufacturer ?? rating.simulation) : rating[rating.used_by_model];
  return slot?.unit === "V" ? ((slot.min ?? slot.value) as number | undefined) : undefined;
}

/**
 * The lowest supply a part works on at these pins: the highest minimum of its operating and recommended ranges, or
 * its brown-out threshold when it states no range.
 */
export function minSupplyV(d: ComponentDescriptor, pins: readonly string[]): number | undefined {
  const on = Object.values(d.ratings).filter((r): r is Rating => !!r && !!r.scope?.pins?.some((p) => pins.includes(p)));
  const highest = (roles: Rating["role"][]): number | undefined => {
    const found = on.filter((r) => roles.includes(r.role)).flatMap((r) => volts(r) ?? []);
    return found.length > 0 ? Math.max(...found) : undefined;
  };
  return highest(["operating", "recommended"]) ?? highest(["threshold"]);
}

function highest(a: Minimum | undefined, b: Minimum): Minimum {
  return a && a.v >= b.v ? a : b;
}

/**
 * Reads the supply side of a robot from its netlist: which nets carry the pack, the regulator input and the logic
 * rail, and the lowest voltage the parts on the pack and on the rail declare they work at.
 */
export function railsOf(net: SimNetlist, describe: Describe, logicV: number): RobotRails {
  const board = net.parts.find((p) => p.kind === "board");
  const batteryPart = net.parts.find((p) => describe(refOf(p.descriptor))?.mechanics?.battery);
  const battery = batteryPart && describe(refOf(batteryPart.descriptor))?.mechanics?.battery;
  const plus = batteryPart && Object.keys(batteryPart.pins).find((pin) => describe(refOf(batteryPart.descriptor))?.pins.find((p) => p.id === pin)?.polarity === "positive");
  const regulatorPin = ["VIN", "VSYS"].find((pin) => board?.pins[pin]);
  const railPin = logicV < 4.5 ? "P3V3" : "P5V";
  const nets: RobotNets = {
    pack: (batteryPart && plus && batteryPart.pins[plus]) || "",
    regulator: (board && regulatorPin && board.pins[regulatorPin]) || "",
    rail: board?.pins[railPin] || "",
  };

  const minimumOn = (target: string): Minimum | undefined => {
    let found: Minimum | undefined;
    if (!target) return found;
    for (const part of net.parts) {
      const d = describe(refOf(part.descriptor));
      if (!d || part === batteryPart) continue;
      const pins = Object.entries(part.pins).flatMap(([pin, n]) => (n === target ? pin : []));
      const v = pins.length > 0 ? minSupplyV(d, pins) : undefined;
      if (v !== undefined) found = highest(found, { v, part: part.id });
    }
    return found;
  };

  const model = board ? boardPower(`board-power:${refOf(board.descriptor).replace(/^core\./, "")}@1`) : undefined;
  const regulated = nets.pack !== "" && nets.pack === nets.regulator;
  const declared = minimumOn(nets.pack);
  const cutV = battery && batteryPart ? battery.cells * LIMITS[battery.chemistry ?? "lipo"].cut : undefined;
  const packMin = cutV === undefined ? declared : highest(declared, { v: cutV, part: batteryPart!.id });
  const logicMin = minimumOn(nets.rail);
  return {
    nets,
    ...(regulated ? { regulator: model ? { model: model.regulator, described: true } : { model: { kind: "linear", voutVolts: logicV, dropoutVolts: 0 }, described: false } } : {}),
    ...(packMin ? { packMin } : {}),
    ...(logicMin ? { logicMin } : {}),
  };
}
