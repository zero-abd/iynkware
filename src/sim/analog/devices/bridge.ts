import type { ElementId } from "../types.ts";
import { type Control, type ControlIO, across, inputLevel } from "./control.ts";

/**
 * One output of a bridge as the solver sees it: a source from the bridge ground to a private node (`id`, its series
 * resistance is the switch) and a switch from there to the pin (`switchId`), open when the output floats.
 */
export interface BridgeOutput {
  id: ElementId;
  switchId: ElementId;
}

export interface BridgeChannel {
  /** Null when the pin is not wired. */
  enable: number | null;
  in1: number | null;
  in2: number | null;
  out1: BridgeOutput;
  out2: BridgeOutput;
}

export interface SwitchOhms {
  closed: number;
  open: number;
}

/** How much of the time an output is high (`high`), or null when it floats. */
type Drive = { high: number } | null;

/** The output is high for `high` of the time and low the rest, averaged over the PWM period, with `dropV` lost in each switch. */
function driveOutput(io: ControlIO, out: BridgeOutput, drive: Drive, supplyV: number, dropV: number, ohms: SwitchOhms): number {
  if (!drive) {
    io.set(out.switchId, { ohms: ohms.open });
    return 0;
  }
  const low = Math.min(dropV, supplyV / 2);
  const volts = Math.max(0, drive.high * (supplyV - low) + (1 - drive.high) * low);
  io.set(out.id, { volts });
  io.set(out.switchId, { ohms: ohms.closed });
  const amps = io.amps(out.switchId) ?? 0;
  return drive.high * Math.max(0, amps);
}

/** The supply pin draws what the high switches pass, as a resistor to the bridge ground, so a battery sags under the load. */
function drawFromSupply(io: ControlIO, load: ElementId, supplyV: number, amps: number): void {
  io.set(load, { ohms: supplyV > 0.1 ? Math.min(1e9, supplyV / amps) : 1e9 });
}

/** L298 numbers from figures/modules/l298n.js: inputs are TTL, the two switches lose 1.4 V + 1.15 ohm x I between them. */
export const L298N = {
  vil: 1.5,
  vih: 2.3,
  dropV: 0.7,
  ronOhms: 0.575,
  /** The chip's logic supply (VSS) works from 4.5 V. */
  logicMinV: 4.5,
  /** The 78M05 on the board needs about 2 V of headroom; the figure rounds the lowest motor supply that still gives 5 V to 6.5 V. */
  regulatorMinV: 6.5,
  quiescentAmps: 0.013,
} as const;

export interface L298nWiring {
  vs: number;
  gnd: number;
  p5v: number;
  /** The regulator input; null when REGIN is not wired, which is the 5V-EN jumper on VS. */
  regin: number | null;
  regulator: BridgeOutput;
  load: ElementId;
  channels: readonly BridgeChannel[];
}

/**
 * Enable low lets both outputs float (the motor coasts). Enable high drives each output to its input, so IN1 high and
 * IN2 low turns the motor one way, the other way round turns it back, and equal inputs brake it. PWM on the enable or
 * on an input is averaged: the output is high for that share of the time. An enable pin left unwired has its jumper cap.
 */
export function l298nControl(w: L298nWiring, ohms: SwitchOhms): Control {
  return {
    step(io) {
      const vs = across(io, w.vs, w.gnd);
      const regIn = w.regin === null ? vs : across(io, w.regin, w.gnd);
      const regulating = regIn >= L298N.regulatorMinV;
      if (regulating) io.set(w.regulator.id, { volts: 5 });
      io.set(w.regulator.switchId, { ohms: regulating ? ohms.closed : ohms.open });
      const logic = across(io, w.p5v, w.gnd) >= L298N.logicMinV;
      let amps = L298N.quiescentAmps;
      for (const ch of w.channels) {
        const enable = logic ? inputLevel(io, ch.enable, L298N.vil, L298N.vih, 1) : 0;
        const on = enable > 0.005 && vs > 0;
        const a = inputLevel(io, ch.in1, L298N.vil, L298N.vih);
        const b = inputLevel(io, ch.in2, L298N.vil, L298N.vih);
        amps += driveOutput(io, ch.out1, on ? { high: enable * a } : null, vs, L298N.dropV, ohms);
        amps += driveOutput(io, ch.out2, on ? { high: enable * b } : null, vs, L298N.dropV, ohms);
      }
      drawFromSupply(io, w.load, vs, amps);
    },
  };
}

/** TB6612FNG numbers from figures/modules/tb6612fng.js and the fact sheet: 0.5 ohm across both switches, CMOS inputs on VCC. */
export const TB6612 = {
  ronOhms: 0.25,
  vilFrac: 0.3,
  vihFrac: 0.7,
  /** Under-voltage lockout lets go at 2.2 V on VCC. */
  logicMinV: 2.2,
  quiescentAmps: 0.001,
} as const;

export interface Tb6612Wiring {
  vm: number;
  vcc: number;
  gnd: number;
  stby: number | null;
  load: ElementId;
  channels: readonly BridgeChannel[];
}

/**
 * STBY low, or both inputs low, lets the outputs float. IN1 high and IN2 low drives OUT1 high while PWM is high and
 * brakes while it is low; the other way round turns the motor back; both high brakes. Every input has a pull-down.
 */
export function tb6612Control(w: Tb6612Wiring, ohms: SwitchOhms): Control {
  return {
    step(io) {
      const vm = across(io, w.vm, w.gnd);
      const vcc = across(io, w.vcc, w.gnd);
      const vil = TB6612.vilFrac * vcc;
      const vih = TB6612.vihFrac * vcc;
      const awake = vcc >= TB6612.logicMinV && inputLevel(io, w.stby, vil, vih) >= 0.5;
      let amps = TB6612.quiescentAmps;
      for (const ch of w.channels) {
        const a = awake ? inputLevel(io, ch.in1, vil, vih) : 0;
        const b = awake ? inputLevel(io, ch.in2, vil, vih) : 0;
        const pwm = inputLevel(io, ch.enable, vil, vih);
        const on = (a > 0.005 || b > 0.005) && vm > 0;
        amps += driveOutput(io, ch.out1, on ? { high: pwm * a * (1 - b) } : null, vm, 0, ohms);
        amps += driveOutput(io, ch.out2, on ? { high: pwm * b * (1 - a) } : null, vm, 0, ohms);
      }
      drawFromSupply(io, w.load, vm, amps);
    },
  };
}
