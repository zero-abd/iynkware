import { type CellChemistry, OCV, cellResistance, ocvAt } from "../../../core/battery.ts";
import type { ElementId } from "../types.ts";
import { type Control, across } from "./control.ts";

/** A battery pack the live solver stamps as a voltage source with its internal resistance, and drains. */
export interface Pack {
  chem: CellChemistry;
  cells: number;
  mah: number;
  /** Ohms per cell. */
  rCell: number;
  /** State of charge at the start of the run, 0 to 1. */
  soc0: number;
}

/** What the placed part's `demo` setting starts the pack at. */
const LIPO_START: Record<string, number> = { full: 1, nominal: 0.2, low: 0.02 };
const AA_START: Record<string, number> = { fresh: 1, running: 0.8 };

/**
 * The packs, from the descriptors' mechanics.battery blocks: 4 alkaline AA at 2500 mAh and 0.15 ohm a cell, a 2S LiPo at
 * 1000 mAh and 0.0066 ohm a cell. The Li-ion option is four 14500 cells at an assumed 800 mAh. `soc0` follows the
 * figure's own numbers: full 8.4 V, nominal 7.4 V, low about 6.2 V; fresh alkaline 6.4 V.
 */
export function packOf(name: "aa-holder-4" | "lipo-2s", demo: unknown): Pack {
  if (name === "lipo-2s") return { chem: "lipo", cells: 2, mah: 1000, rCell: 0.0066, soc0: LIPO_START[String(demo)] ?? 1 };
  if (demo === "li-ion") return { chem: "liion", cells: 4, mah: 800, rCell: cellResistance("liion", 800), soc0: 1 };
  return { chem: "alkaline", cells: 4, mah: 2500, rCell: 0.15, soc0: AA_START[String(demo)] ?? 1 };
}

export const packOhms = (p: Pack): number => p.cells * p.rCell;

/** Open-circuit volts of the whole pack at a state of charge. */
export const packVolts = (p: Pack, soc: number): number => p.cells * ocvAt(OCV[p.chem], soc);

/** State of charge after `coulombs` have left the pack. */
export const socAfter = (p: Pack, coulombs: number): number => Math.max(0, p.soc0 - coulombs / (p.mah * 3.6));

/** The LM2596 module's numbers, from figures/modules/lm2596.js (TI datasheet SNVS124G figures 7-3 to 7-6, with its assumptions). */
const VFB = 1.23;
const R1 = 330;
const OHM_TURN = 400;
const DCR = 0.08;
const IQ = 0.005;
const IMETER = 0.015;
export const BUCK_ILIM = 4.2;
const VMIN = 3.6;
const dropout = (i: number) => 0.745 + 0.175 * i + DCR * i;
const vsat = (i: number) => 0.65 + 0.17 * i;
const vf = (i: number) => 0.35 + 0.05 * i;

/** The voltage the trimmer asks for: 25 turns of 400 ohm in series with the 330 ohm feedback leg. */
export const buckSetVolts = (turns: number): number => VFB * (1 + (Math.max(0, Math.min(25, turns)) * OHM_TURN) / R1);

export interface BuckPoint {
  /** The output the converter holds at this load: the setting, or the input less the dropout. */
  vout: number;
  /** Amps the input takes, losses included. */
  iin: number;
  /** In dropout: the output follows the input down. */
  dropout: boolean;
}

/** The converter at input volts `vin`, set to `vset`, delivering `iout`. Below 3.6 V in it is off. */
export function buckPoint(vin: number, vset: number, iout: number): BuckPoint {
  if (vin < VMIN) return { vout: 0, iin: vin > 0.5 ? IQ : 0, dropout: false };
  const i = Math.max(0, iout);
  const vmax = vin - dropout(i);
  const sat = vset >= vmax;
  const vout = Math.max(0, Math.min(vset, vmax));
  const d = sat ? 1 : Math.min(1, (vout + vf(i)) / Math.max(0.1, vin - vsat(i) + vf(i)));
  const lost = vsat(i) * i * d + 0.012 * vin * i + vin * IQ + vf(i) * i * (1 - d) + DCR * i * i;
  return { vout, iin: (vout * i + lost) / vin + IMETER, dropout: sat };
}

/**
 * Drains a pack by the charge the circuit takes from it, and lowers its open-circuit volts along the cell's discharge
 * curve. The current is worked out from the drop across the internal resistance, so it needs no sign convention.
 */
export function packControl(id: ElementId, plus: number, minus: number, pack: Pack): Control {
  let coulombs = 0;
  return {
    step(io, dtS) {
      const ocvNow = packVolts(pack, socAfter(pack, coulombs));
      const terminal = across(io, plus, minus);
      const amps = Math.max(0, (ocvNow - terminal) / packOhms(pack));
      coulombs += amps * dtS;
      io.set(id, { volts: packVolts(pack, socAfter(pack, coulombs)) });
    },
  };
}

/**
 * The LM2596 module: the output source holds the trimmer's setting, or the input less the dropout, and the input takes
 * what the output delivers plus the losses, as a resistor retuned after every solve.
 */
export function buckControl(w: { out: ElementId; outOhms: number; load: ElementId; vin: number; gnd: number; vout: number; gndOut: number; vset: number }): Control {
  return {
    step(io) {
      const vin = across(io, w.vin, w.gnd);
      const held = io.volts(w.vout) === null ? 0 : across(io, w.vout, w.gndOut);
      const last = io.sourceVolts(w.out) ?? 0;
      const iout = Math.max(0, (last - held) / w.outOhms);
      const point = buckPoint(vin, w.vset, iout);
      io.set(w.out, { volts: point.vout });
      io.set(w.load, { ohms: point.iin > 0 ? Math.min(1e9, Math.max(0.1, vin / point.iin)) : 1e9 });
    },
  };
}
