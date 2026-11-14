// @vitest-environment node
import { describe, expect, it } from "vitest";
import { motorProvider } from "./motor.ts";
import { ctxOf } from "./testing.ts";

const dc = motorProvider("dc-motor");
const ID = "core.dc-motor@1.0.0";

describe("motor provider", () => {
  it("shows the shaft speed the solver turned it to, signed for direction", () => {
    expect(dc(ctxOf(ID, { volts: { PLUS: 4, MINUS: 0 }, rpm: 12000.4 }))).toEqual({ kind: "motor", rpm: 12000, stalled: false, powered: true });
    expect(dc(ctxOf(ID, { volts: { PLUS: 0, MINUS: 4 }, rpm: -11999.6 }))).toMatchObject({ rpm: -12000, powered: true });
  });

  it("is stalled while powered with the shaft still", () => {
    expect(dc(ctxOf(ID, { volts: { PLUS: 0.8, MINUS: 0 }, rpm: 0 }))).toEqual({ kind: "motor", rpm: 0, stalled: true, powered: true });
  });

  it("is unpowered under the stop voltage, with no solver and when the winding is burnt", () => {
    expect(dc(ctxOf(ID, { volts: { PLUS: 0.2, MINUS: 0 }, rpm: 0 }))).toMatchObject({ powered: false, stalled: false });
    expect(dc(ctxOf(ID, { volts: { PLUS: 4 } }))).toMatchObject({ powered: false });
    expect(dc(ctxOf(ID, { volts: { PLUS: 5, MINUS: 0 }, rpm: 9000, health: "burnt" }))).toMatchObject({ rpm: 0, powered: false });
  });

  it("uses each motor's own stop voltage", () => {
    const fan = motorProvider("fan");
    expect(fan(ctxOf("core.fan@1.0.0", { volts: { PLUS: 1.5, MINUS: 0 }, rpm: 0 }))).toMatchObject({ powered: false });
    expect(fan(ctxOf("core.fan@1.0.0", { volts: { PLUS: 2, MINUS: 0 }, rpm: 0 }))).toMatchObject({ powered: true, stalled: true });
  });
});
