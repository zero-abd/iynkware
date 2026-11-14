// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buckVolts, meterVolts, packVolts } from "./power.ts";
import { ctxOf } from "./testing.ts";

describe("power readings", () => {
  it("show the volts across the part's own pins, to a hundredth", () => {
    expect(packVolts(ctxOf("core.aa-holder-4@1.0.0", { volts: { PLUS: 6.3712, MINUS: 0 } }))).toEqual({ kind: "reading", value: 6.37, unit: "V", label: "" });
    expect(buckVolts(ctxOf("core.lm2596-module@1.0.0", { volts: { VOUT: 5.004, GND_OUT: 0 } }))).toMatchObject({ value: 5, label: "out" });
    expect(meterVolts(ctxOf("core.multimeter@1.0.0", { volts: { V: 1.2, COM: 3.3 } }))).toMatchObject({ value: -2.1 });
  });

  it("say nothing with no solver", () => {
    expect(meterVolts(ctxOf("core.multimeter@1.0.0"))).toBeNull();
  });
});
