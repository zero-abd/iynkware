// @vitest-environment node
import { describe, expect, it } from "vitest";
import { boardPower, mcuPowered, regulatorOut } from "./power-models.ts";
import type { BoardPowerModel } from "./power-models.ts";

const esp32 = (): BoardPowerModel => {
  const m = boardPower("board-power:esp32-devkitc@1");
  if (!m) throw new Error("missing entry");
  return m;
};

describe("board power models", () => {
  it("follows min(3.3, vin - 1.1) clamped at 0 from 0 to 6 V", () => {
    const { regulator } = esp32();
    for (let i = 0; i <= 60; i++) {
      const vin = i / 10;
      expect(regulatorOut(regulator, vin)).toBeCloseTo(Math.max(0, Math.min(3.3, vin - 1.1)), 9);
    }
  });

  it("gives the stated acceptance values", () => {
    const m = esp32();
    expect(regulatorOut(m.regulator, 5)).toBe(3.3);
    expect(regulatorOut(m.regulator, 3.8)).toBeCloseTo(2.7, 9);
    expect(mcuPowered(m, 2.7)).toBe(true);
    expect(regulatorOut(m.regulator, 3.4)).toBeCloseTo(2.3, 9);
    expect(mcuPowered(m, 2.3)).toBe(false);
  });

  it("powers the MCU from 2.43 V", () => {
    const m = esp32();
    expect([2.42, 2.43, 2.44].map((v) => mcuPowered(m, v))).toEqual([false, true, true]);
  });

  it("refuses a NaN input and returns undefined for an unknown board", () => {
    expect(() => regulatorOut(esp32().regulator, Number.NaN)).toThrow(RangeError);
    expect(() => mcuPowered(esp32(), Number.NaN)).toThrow(RangeError);
    expect(boardPower("board-power:nope@1")).toBeUndefined();
  });

  it("states what is not modelled, sources every number and never says validated", () => {
    const m = esp32();
    expect(m.notModelled.length).toBeGreaterThan(0);
    expect(m.parameterSources.length).toBeGreaterThanOrEqual(16);
    expect(m.parameterSources.every((p) => p.type === "assumption")).toBe(true);
    expect(JSON.stringify(m)).not.toMatch(/validated/i);
  });
});

const model = (id: string): BoardPowerModel => {
  const m = boardPower(`board-power:${id}@1`);
  if (!m) throw new Error(`missing entry ${id}`);
  return m;
};

describe("the robotics boards", () => {
  it.each([
    ["uno-r3", 5, 1.2, 6.2, 2.7],
    ["nano", 5, 1.2, 6.2, 2.7],
    ["esp32-s3-devkitc-1", 3.3, 0.45, 3.75, 2.7],
  ])("%s: an LDO to %f V with %f V dropout, in dropout below %f V", (id, vout, dropout, knee, mcuMin) => {
    const { regulator, mcu } = model(id);
    expect(regulator).toMatchObject({ kind: "linear", voutVolts: vout, dropoutVolts: dropout });
    expect(regulatorOut(regulator, knee)).toBeCloseTo(vout, 9);
    expect(regulatorOut(regulator, knee - 0.5)).toBeCloseTo(vout - 0.5, 9);
    expect(mcu.minV).toBe(mcuMin);
  });

  it("holds 3.3 V on the Pico across the 1.8 to 5.5 V input range of its buck-boost", () => {
    const { regulator, mcu } = model("pico");
    expect(regulator).toEqual({ kind: "buck-boost", voutVolts: 3.3, minInVolts: 1.8, maxInVolts: 5.5 });
    for (const vin of [1.8, 2.5, 3.3, 4.2, 5.5]) expect(regulatorOut(regulator, vin)).toBe(3.3);
    expect(mcuPowered(model("pico"), regulatorOut(regulator, 1.8))).toBe(true);
    expect(mcu.minV).toBe(1.62);
  });

  it("gives nothing from a buck-boost below its minimum input or above its maximum", () => {
    const { regulator } = model("pico");
    for (const vin of [0, 1.5, 1.79]) expect(regulatorOut(regulator, vin)).toBe(0);
    for (const vin of [5.51, 7.4, 12.6]) expect(regulatorOut(regulator, vin)).toBe(0);
  });

  it("cites the buck-boost's input range to the datasheet and carries no dropout", () => {
    const m = model("pico");
    expect(JSON.stringify(m.regulator)).not.toMatch(/dropout/i);
    for (const [param, value] of [["regulator input minimum", 1.8], ["regulator input maximum", 5.5]] as const) {
      expect(m.parameterSources.find((p) => p.param === param), param).toMatchObject({ type: "datasheet", value });
    }
  });

  it("brings the AVR brown-out figures of the Uno and Nano from the ATmega328P datasheet", () => {
    for (const id of ["uno-r3", "nano"]) {
      const m = model(id);
      expect(m.brownout).toMatchObject({ thresholdVolts: 2.7, hysteresisVolts: 0.05, minDwellNs: 2000 });
      expect(m.parameterSources.find((p) => p.param === "brown-out threshold")?.type).toBe("datasheet");
    }
  });

  it("cites the regulator numbers to a datasheet, states what is not modelled and never says validated", () => {
    for (const id of ["uno-r3", "nano", "pico", "esp32-s3-devkitc-1"]) {
      const m = model(id);
      const dropout = m.parameterSources.find((p) => p.param === (m.regulator.kind === "buck-boost" ? "regulator input minimum" : "regulator dropout"));
      expect(dropout, id).toMatchObject({ type: "datasheet", value: m.regulator.kind === "buck-boost" ? m.regulator.minInVolts : m.regulator.dropoutVolts });
      expect(dropout?.ref, id).toMatch(/^[A-Za-z].*https:\/\//);
      expect(m.notModelled.length, id).toBeGreaterThan(0);
      expect(JSON.stringify(m), id).not.toMatch(/validated/i);
    }
  });
});
