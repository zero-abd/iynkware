import type { WorldInput as LegacyWorldInput } from "@/content/schema";
import { type I2CDevice, toLegacyDevice } from "@/lib/interp/devices";
import { netResolver, pinNet } from "@/lib/interp/pins";
import { WorldBinding } from "@/lib/interp/lesson-world";
import type { BoardProfile } from "@/sim/boards/profiles";
import type { WorldInput as ProjectWorldInput } from "@/project/generated/types";
import type { BusEvent } from "@/sim/bus";
import type { Descriptor } from "@/parts/descriptor";
import { type LiveAnalog, pinElementId } from "@/sim/analog/live";
import type { SimNetlist, SimPart } from "@/sim/engine";
import { bindI2c, instantiateNetlistDevices, netlistContext } from "@/sim/mcu/i2c-bind";
import { isBuiltin, legacyInput } from "../world-drive";
import type { InterpEngine } from "./interp-engine";

/**
 * Wires a project's world inputs to the engine's run through the netlist. `inputs` are the converted inputs, with the
 * pins the wires give; pass them to `binding.apply`.
 */
export function bindWorld(
  engine: InterpEngine,
  net: SimNetlist,
  inputs: ProjectWorldInput[],
  profile: BoardProfile,
): { binding: WorldBinding; inputs: LegacyWorldInput[] } {
  const converted = inputs.filter(isBuiltin).map((i) => legacyInput(net, i));
  const binding = new WorldBinding(engine.run, { inputs: converted, script: [] }, { logicV: profile.logicV, resolve: netResolver(profile) });
  return { binding, inputs: converted };
}

/** `analogRead` on the engine's board returns what the solver finds on the pin. */
export function bindAnalog(engine: InterpEngine, live: LiveAnalog, board: string, profile: BoardProfile): void {
  engine.run.world.setAnalogSource((pin) => live.pinVolts(pinElementId(board, pinNet(profile, pin))));
}

/**
 * The register-level I2C parts (MPU-6050, BME280) wired to the board's I2C pins, made ready for the interpreter's bus,
 * so a sketch that talks to them with plain `Wire` calls gets answers as well as one that uses their library. The
 * board's SDA and SCL header pins count as well as the pins they share a line with (A4 and A5 on an UNO). `nowNs` is
 * the run's clock.
 */
export function wiredI2cDevices(
  net: SimNetlist,
  board: string,
  profile: BoardProfile,
  descriptorOf: (part: SimPart) => Descriptor | undefined,
  nowNs: () => number,
): I2CDevice[] {
  const pins = profile.i2c;
  if (!pins) return [];
  const tries = [{ sda: pinNet(profile, pins.sda), scl: pinNet(profile, pins.scl) }, { sda: "SDA", scl: "SCL" }];
  const ctx = netlistContext(net, profile.logicV, nowNs, () => {}, undefined, descriptorOf);
  const seen = new Set<number>();
  const out: I2CDevice[] = [];
  for (const names of tries) {
    const bound = bindI2c(net, board, names, descriptorOf);
    if (!bound.ok) continue;
    for (const device of instantiateNetlistDevices(net, bound.binding, descriptorOf, ctx).devices) {
      const address = device.addresses[0];
      if (address === undefined || seen.has(address)) continue;
      seen.add(address);
      out.push(toLegacyDevice(device, "register", address));
    }
  }
  return out;
}

/**
 * Makes the netlist the only source of I2C devices: each `Wire.begin` binds the bus to the nets on the pins it names,
 * and only parts wired to those nets answer. A pin nothing is wired to is reported as a warning to the learner.
 */
export function bindI2cBus(
  engine: InterpEngine,
  net: SimNetlist,
  board: string,
  profile: BoardProfile,
  descriptorOf: (part: SimPart) => Descriptor | undefined,
  onEvent: (e: BusEvent) => void,
  volts?: (net: string) => number | undefined,
): void {
  const { world } = engine.run;
  world.deviceSource = "netlist";
  world.i2cBinder = (sda, scl) => {
    const bound = bindI2c(net, board, { sda: pinNet(profile, sda), scl: pinNet(profile, scl) }, descriptorOf);
    if (!bound.ok) {
      world.warn(
        bound.reason === "pins-on-one-net"
          ? `Wire.begin(${sda}, ${scl}): both pins are on the same wire`
          : `Wire.begin(${sda}, ${scl}): ${bound.pin} is not wired to anything`,
      );
      world.bus.bindNetlist({ sdaNet: "", sclNet: "", speedHz: 100_000, pullup: { kind: "assumed" } }, []);
      return;
    }
    const ctx = netlistContext(net, profile.logicV, () => Math.round(world.clock.now * 1000), onEvent, volts, descriptorOf);
    const { devices, events } = instantiateNetlistDevices(net, bound.binding, descriptorOf, ctx);
    for (const e of events) onEvent(e);
    world.bus.bindNetlist(bound.binding, devices);
  };
}
