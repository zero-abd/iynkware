import type { PartStateProvider } from "./types.ts";

/** Volts between two pins, as the part's own display or tag shows them; nothing with no solver. */
const voltsBetween =
  (plus: string, minus: string, label = ""): PartStateProvider =>
  (ctx) => {
    const v = ctx.across(plus, minus);
    return v === null ? null : { kind: "reading", value: Math.round(v * 100) / 100, unit: "V", label };
  };

/** A pack's terminal volts: they sag under load and fall as the pack drains. */
export const packVolts = voltsBetween("PLUS", "MINUS");

/** The LM2596 module's three-digit display, set to show the output. */
export const buckVolts = voltsBetween("VOUT", "GND_OUT", "out");

/** The meter's display: the red probe against the black one. */
export const meterVolts = voltsBetween("V", "COM");
