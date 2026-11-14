// @vitest-environment node
import { describe, expect, it } from "vitest";
import { OCV } from "../../core/battery.ts";
import { createSupply, type MechanicsBattery } from "./supply.ts";
import { stepMotorDc, type MotorParams } from "./motor.ts";

const lipo2s: MechanicsBattery = { cells: 2, capacity_mah: 1000, r_cell_ohm: 0.0066, chemistry: "lipo", mass_g: 50 } as MechanicsBattery;
const motor: MotorParams = { rOhm: 2, lHenry: 0, keVsPerRad: 0.02, jKgM2: 0, bNmsPerRad: 0, iNoLoadA: 0 };
const H = 1 / 240;

/** Runs the motor on the supply for `steps` steps at wheel speed `w` and returns the voltage at the end. */
function run(battery: MechanicsBattery, w: number, steps: number): number {
  const supply = createSupply(battery);
  for (let n = 0; n < steps; n++) supply.draw(stepMotorDc(motor, w, supply.volts()).supplyAvgA * 2, H);
  return supply.volts();
}

describe("createSupply", () => {
  it("is the open-circuit voltage of a full pack before anything is drawn", () => {
    expect(createSupply(lipo2s).volts()).toBeCloseTo(2 * OCV.lipo[10]!, 10);
  });

  it("sags under the current that flows", () => {
    const supply = createSupply(lipo2s);
    const open = supply.volts();
    supply.draw(10, H);
    expect(supply.volts()).toBeLessThan(open);
    expect(open - supply.volts()).toBeCloseTo(10 * 2 * 0.0066, 3);
  });

  it("drains over simulated time and no faster than the current says", () => {
    const supply = createSupply(lipo2s);
    const open = supply.volts();
    for (let n = 0; n < 240 * 60; n++) supply.draw(1, H);
    supply.draw(0, H);
    expect(supply.volts()).toBeLessThan(open);
    // One amp for a minute is 1/60 Ah of a 1 Ah pack: well under a tenth of the span.
    expect(open - supply.volts()).toBeLessThan(0.1);
  });

  it("sags lower under stalled motors than free-running ones", () => {
    expect(run(lipo2s, 0, 240)).toBeLessThan(run(lipo2s, 300, 240));
  });

  it("is the same on every run", () => {
    expect(run(lipo2s, 0, 500)).toBe(run(lipo2s, 0, 500));
  });

  it("keeps the nominal voltage, with no sag, for a pack it cannot model", () => {
    const supply = createSupply({ cells: 4, mass_g: 90 } as MechanicsBattery);
    supply.draw(50, H);
    expect(supply.volts()).toBeCloseTo(4 * 3.7, 10);
  });

  it("models a four-cell AA alkaline holder: 6.4 V fresh, sagging under a load", () => {
    const aa: MechanicsBattery = { cells: 4, capacity_mah: 2500, r_cell_ohm: 0.15, chemistry: "alkaline", mass_g: 100 } as MechanicsBattery;
    const supply = createSupply(aa);
    expect(supply.volts()).toBeCloseTo(4 * OCV.alkaline[10]!, 10);
    supply.draw(1, H);
    expect(supply.volts()).toBeCloseTo(4 * OCV.alkaline[10]! - 4 * 0.15, 2);
  });

  it("falls back to the chemistry's own nominal volts, not lithium's, when a NiMH pack lacks capacity", () => {
    expect(createSupply({ cells: 4, chemistry: "nimh" } as MechanicsBattery).volts()).toBeCloseTo(4.8, 10);
  });
});
