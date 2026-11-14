// @vitest-environment node
import { describe, expect, it } from "vitest";
import { servoSg90 } from "./servo-sg90.ts";
import { ctxOf } from "./testing.ts";

const POWER = { VPLUS: 5, GND: 0 };
const NS = 1e6;

describe("servo-sg90 provider", () => {
  it("reads the interpreter's pulse: 544 us is 0 degrees, 2400 us 180, 1472 us the middle", () => {
    const angle = (servoUs: number) => {
      const memory = {};
      servoSg90(ctxOf("core.servo-sg90@1.0.0", { at: 0, volts: POWER, signals: { SIG: { servoUs } }, memory }));
      return servoSg90(ctxOf("core.servo-sg90@1.0.0", { at: 1e9, volts: POWER, signals: { SIG: { servoUs } }, memory }));
    };
    expect(angle(544)).toEqual({ kind: "servo", angle: 0, powered: true });
    expect(angle(1472)).toMatchObject({ angle: 90 });
    expect(angle(2400)).toMatchObject({ angle: 180 });
  });

  it("measures the pulse of a firmware run from its edges", () => {
    const edges = (lastRiseAt: number) => ({ SIG: { highNs: 1936 * 1000, periodNs: 20 * NS, lastRiseAt, lastEdgeAt: lastRiseAt + 2 * NS } });
    const memory = {};
    servoSg90(ctxOf("core.servo-sg90@1.0.0", { at: 41 * NS, volts: POWER, signals: edges(40 * NS), memory }));
    expect(servoSg90(ctxOf("core.servo-sg90@1.0.0", { at: 1e9, volts: POWER, signals: edges(980 * NS), memory }))).toMatchObject({ angle: 135 });
  });

  it("holds its place when the pulses stop", () => {
    const memory = {};
    const live = { SIG: { highNs: 544_000, lastRiseAt: 0 } };
    servoSg90(ctxOf("core.servo-sg90@1.0.0", { at: 0, volts: POWER, signals: live, memory }));
    servoSg90(ctxOf("core.servo-sg90@1.0.0", { at: 0.5e9, volts: POWER, signals: live, memory }));
    const stopped = servoSg90(ctxOf("core.servo-sg90@1.0.0", { at: 2e9, volts: POWER, signals: live, memory }));
    expect(stopped).toMatchObject({ angle: 90, powered: true });
  });

  it("turns at its rated speed and not faster", () => {
    const memory = {};
    const pulse = { SIG: { servoUs: 2400 } };
    servoSg90(ctxOf("core.servo-sg90@1.0.0", { at: 0, volts: POWER, signals: pulse, memory }));
    const early = servoSg90(ctxOf("core.servo-sg90@1.0.0", { at: 0.1e9, volts: POWER, signals: pulse, memory }));
    expect(early).toMatchObject({ angle: 150 });
  });

  it("does not move without a supply across V+ and GND", () => {
    const memory = {};
    const pulse = { SIG: { servoUs: 2400 } };
    for (const at of [0, 1e9]) {
      expect(servoSg90(ctxOf("core.servo-sg90@1.0.0", { at, volts: { VPLUS: 0, GND: 0 }, signals: pulse, memory }))).toEqual({ kind: "servo", angle: 90, powered: false });
    }
    expect(servoSg90(ctxOf("core.servo-sg90@1.0.0", { at: 2e9, volts: { VPLUS: 3, GND: 0 }, signals: pulse, memory }))).toMatchObject({ powered: false });
  });

  it("starts at the angle parameter and ignores a pulse that is not a servo signal", () => {
    const memory = {};
    const wild = { SIG: { servoUs: 50 } };
    for (const at of [0, 1e9]) {
      expect(servoSg90(ctxOf("core.servo-sg90@1.0.0", { at, params: { angle: 30 }, volts: POWER, signals: wild, memory }))).toMatchObject({ angle: 30, powered: true });
    }
  });
});
