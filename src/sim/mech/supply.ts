import { nominalCell } from "../../core/battery.ts";
import type { Mechanics } from "../../parts/generated/types.ts";
import { createPack } from "./pack.ts";

export type MechanicsBattery = NonNullable<Mechanics["battery"]>;

export interface Supply {
  /** The pack voltage the motors see now: open-circuit from the charge left, less the sag at the last current drawn. */
  volts(): number;
  /** Takes `totalA` out of the pack for one step of `hS` seconds; the sag it causes shows from the next step on. */
  draw(totalA: number, hS: number): void;
}

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * The motor supply of a robot with no analog solver. The pack follows its own charge and sags under the current
 * the motors drew in the step before, so it needs no iteration inside a step and replays the same every run.
 * A pack the model cannot be built from keeps its nominal voltage and never drains.
 */
export function createSupply(battery: MechanicsBattery): Supply {
  const pack = positive(battery.cells) && positive(battery.capacity_mah) && positive(battery.r_cell_ohm)
    ? createPack({
        cells: battery.cells,
        parallel: battery.parallel ?? 1,
        capacityMah: battery.capacity_mah,
        rCellOhm: battery.r_cell_ohm,
        ...(battery.chemistry && { chemistry: battery.chemistry }),
        ...(battery.ocv_table && { ocvTable: battery.ocv_table }),
      })
    : undefined;
  if (!pack?.ok) {
    const nominal = positive(battery.cells) ? battery.cells * nominalCell(battery.chemistry) : 0;
    return { volts: () => nominal, draw() {} };
  }
  let iA = 0;
  return {
    volts: () => Math.max(0, pack.value.terminalV(iA)),
    draw(totalA, hS) {
      iA = totalA;
      pack.value.step(totalA, hS);
    },
  };
}
